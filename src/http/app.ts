import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Update } from 'node-telegram-bot-api';
import { z } from 'zod';
import type { StateService } from '../services/state-service';
import { authenticateInitData } from '../security/telegram-auth';
import { RateLimit } from '../security/rate-limit';
import { requireAccess } from '../services/access-service';
import type { MemberLookup } from '../services/access-service';
import { selectionSchema, versionSchema } from '../domain/schema';
import { calculateSettlement } from '../domain/settlement';
import type { ReceiptSession } from '../interfaces';
import { logger } from '../utils/logger';

export interface HttpDependencies {
  store: StateService;
  token: string;
  botUsername: () => string;
  lookup: MemberLookup;
  miniAppUrl: string;
  webDir: string;
  webhookSecret: string;
  webhookEnabled: boolean;
  ready: () => boolean;
  metrics: () => string;
  metricsToken: string;
}
function sessionView(s: ReceiptSession, userId: number, botUsername: string) {
  return {
    id: s.id,
    receipt: s.receipt,
    version: s.version,
    status: s.status,
    splitMode: s.splitMode,
    participants: s.participants,
    ownerUserId: s.ownerUserId,
    expiresAt: s.expiresAt,
    userId,
    reviewUrl: s.ownerUserId === userId ? 'https://t.me/' + botUsername + '?start=review_' + s.id : '',
    settlement: calculateSettlement(s)
  };
}
export type SessionView = ReturnType<typeof sessionView>;

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}
function equals(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
async function body(req: IncomingMessage, max = 65536): Promise<unknown> {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new Error('UNSUPPORTED_MEDIA');
  if (Number(req.headers['content-length'] || 0) > max) throw new Error('REQUEST_TOO_LARGE');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    const b = Buffer.isBuffer(c) ? c : Buffer.from(c);
    size += b.length;
    if (size > max) throw new Error('REQUEST_TOO_LARGE');
    chunks.push(b);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('INVALID_JSON');
  }
}
const statusCodes: Record<string, number> = {
  UNAUTHORIZED: 401,
  AUTH_EXPIRED: 401,
  SESSION_FORBIDDEN: 403,
  SESSION_NOT_FOUND: 404,
  SESSION_CONFLICT: 409,
  SESSION_FINALIZED: 409,
  UNASSIGNED_ITEMS: 422,
  RECEIPT_NOT_CONFIRMED: 409,
  REQUEST_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA: 415,
  ITEM_NOT_FOUND: 422,
  INVALID_QUANTITY: 422,
  QUANTITY_EXCEEDED: 409,
  RATE_LIMIT: 429,
  INVALID_JSON: 400,
  MEMBERSHIP_UNAVAILABLE: 503,
  QUEUE_FULL: 503,
  PARTICIPANT_LIMIT: 422
};
export function createHttpHandler(deps: HttpDependencies) {
  const perUser = new RateLimit(120, 60000);
  const ingress = new RateLimit(600, 60000);
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const requestId = randomBytes(8).toString('hex');
    res.setHeader('x-request-id', requestId);
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader(
      'content-security-policy',
      "default-src 'self'; script-src 'self' https://telegram.org; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors https://web.telegram.org https://*.telegram.org"
    );
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/health/live') return json(res, 200, { status: 'ok' });
      if (req.method === 'GET' && url.pathname === '/health/ready') {
        const ready = deps.ready() && deps.store.healthy();
        return json(res, ready ? 200 : 503, { status: ready ? 'ready' : 'starting' });
      }
      if (url.pathname === '/metrics') {
        if (!deps.metricsToken || !equals(req.headers.authorization || '', 'Bearer ' + deps.metricsToken))
          return json(res, 404, { error: 'NOT_FOUND' });
        res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' });
        res.end(deps.metrics());
        return;
      }
      if (req.method === 'POST' && url.pathname === '/telegram/webhook' && deps.webhookEnabled) {
        if (!deps.webhookSecret || !equals(String(req.headers['x-telegram-bot-api-secret-token'] || ''), deps.webhookSecret))
          throw new Error('UNAUTHORIZED');
        const update = z
          .object({
            update_id: z.number().int().nonnegative(),
            message: z.object({}).passthrough().optional(),
            callback_query: z.object({}).passthrough().optional()
          })
          .passthrough()
          .parse(await body(req, 1048576));
        deps.store.enqueue(update as Update);
        return json(res, 200, { ok: true });
      }
      if (url.pathname.startsWith('/api/')) {
        if (!ingress.allow(req.socket.remoteAddress || 'unknown')) throw new Error('RATE_LIMIT');
        const origin = req.headers.origin;
        if (origin && origin !== new URL(deps.miniAppUrl || 'http://127.0.0.1:43127').origin) throw new Error('SESSION_FORBIDDEN');
        const auth = req.headers.authorization || '';
        const user = authenticateInitData(auth.startsWith('tma ') ? auth.slice(4) : '', deps.token);
        if (!perUser.allow(String(user.id))) throw new Error('RATE_LIMIT');
        const name = [user.first_name, user.last_name].filter(Boolean).join(' ').slice(0, 120);
        if (url.pathname === '/api/sessions' && req.method === 'GET') {
          const candidates = deps.store.listSessions(user.id).filter((s) => s.status !== 'draft');
          const visible = await Promise.all(
            candidates.map(async (s) => {
              try {
                await requireAccess(s, user.id, deps.lookup);
                return s;
              } catch {
                return undefined;
              }
            })
          );
          return json(res, 200, {
            userId: user.id,
            sessions: visible
              .filter((s): s is ReceiptSession => s !== undefined)
              .map((s) => ({
                id: s.id,
                number: s.receipt.receiptNumber,
                totalMinor: s.receipt.totalMinor,
                currency: s.receipt.currency,
                status: s.status,
                expiresAt: s.expiresAt
              }))
          });
        }
        const match = /^\/api\/sessions\/([A-Za-z0-9_-]{22})(?:\/([a-z]+))?$/.exec(url.pathname);
        if (!match) return json(res, 404, { error: 'NOT_FOUND' });
        const [, id, action] = match;
        let s = deps.store.getSession(id);
        if (!s) throw new Error('SESSION_NOT_FOUND');
        await requireAccess(s, user.id, deps.lookup);
        if (s.status === 'draft') throw new Error('RECEIPT_NOT_CONFIRMED');
        if (req.method === 'GET' && !action) return json(res, 200, sessionView(s, user.id, deps.botUsername()));
        if (req.method !== 'POST') return json(res, 405, { error: 'METHOD_NOT_ALLOWED' });
        const input = await body(req);
        if (action === 'join') {
          z.object({}).strict().parse(input);
          s = await deps.store.join(id, user.id, name);
        } else if (action === 'selection') {
          const data = selectionSchema.parse(input);
          s = await deps.store.saveSelection(id, user.id, name, data.itemIds, data.version, data.itemQuantities);
        } else {
          if (s.ownerUserId !== user.id) throw new Error('SESSION_FORBIDDEN');
          if (action === 'mode') {
            const data = z
              .object({ version: z.number().int().positive(), mode: z.enum(['items', 'equal']) })
              .strict()
              .parse(input);
            s = await deps.store.updateSession(
              id,
              (d) => {
                d.splitMode = data.mode;
              },
              { expectedVersion: data.version }
            );
          } else if (action === 'share') {
            const data = versionSchema.parse(input);
            if (!s.inviteToken)
              s = await deps.store.updateSession(
                id,
                (d) => {
                  d.inviteToken = randomBytes(24).toString('base64url');
                },
                { expectedVersion: data.version }
              );
            return json(res, 200, {
              url: 'https://t.me/' + deps.botUsername() + '?start=join_' + s.inviteToken,
              session: sessionView(s, user.id, deps.botUsername())
            });
          } else if (action === 'finalize') {
            const data = versionSchema.parse(input);
            s = await deps.store.finalize(id, user.id, data.version);
          } else return json(res, 404, { error: 'NOT_FOUND' });
        }
        return json(res, 200, sessionView(s, user.id, deps.botUsername()));
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'METHOD_NOT_ALLOWED' });
      if (url.pathname === '/') {
        res.writeHead(302, { location: '/app/' });
        res.end();
        return;
      }
      const asset = /^\/app\/assets\/([a-zA-Z0-9_.-]+)$/.exec(url.pathname);
      const file = asset
        ? path.join(deps.webDir, 'assets', asset[1])
        : ['/app', '/app/'].includes(url.pathname)
          ? path.join(deps.webDir, 'index.html')
          : undefined;
      if (!file) return json(res, 404, { error: 'NOT_FOUND' });
      let bytes;
      try {
        bytes = await readFile(file);
      } catch {
        return json(res, 404, { error: 'BUILD_WEB_FIRST' });
      }
      const types: Record<string, string> = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.svg': 'image/svg+xml'
      };
      res.writeHead(200, {
        'content-type': types[path.extname(file)] || 'application/octet-stream',
        'cache-control': asset ? 'public, max-age=31536000, immutable' : 'no-store'
      });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch (error) {
      const code = error instanceof z.ZodError ? 'INVALID_INPUT' : error instanceof Error ? error.message : 'INTERNAL_ERROR';
      const status = code === 'INVALID_INPUT' ? 422 : statusCodes[code] || 500;
      if (status === 500) logger.error('HTTP failure', { requestId, error });
      if (!res.headersSent) json(res, status, { error: status === 500 ? 'INTERNAL_ERROR' : code, requestId });
    }
  };
}
