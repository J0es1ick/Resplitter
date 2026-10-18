import { randomBytes, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Update } from 'node-telegram-bot-api';
import { config } from '../config';
import type { ParsedReceipt, ReceiptSession, UserFlow } from '../interfaces';
import { sessionSchema } from '../domain/schema';
import { calculateSettlement } from '../domain/settlement';
import { quantityUnits } from '../domain/quantity';
import { formatMoney } from '../utils/money';
import { samePrintedReceipt, assertSafeDuplicateDraft } from '../domain/receipt-identity';
import type { NotificationOutcome } from './notification-delivery';

type Row = { body: string };
export interface BotUiState {
  messageId?: number;
  catalog?: { section: 'open' | 'closed'; page: number };
  receipt?: { sessionId: string; mode: 'app' | 'review'; page?: number };
}
export class StateService {
  private db?: DatabaseSync;
  public constructor(
    private readonly stateFile?: string,
    private readonly sessionTtlMs = 86400000
  ) {}
  public async initialize(): Promise<void> {
    if (this.stateFile) mkdirSync(path.dirname(this.stateFile), { recursive: true });
    this.db = new DatabaseSync(this.stateFile || ':memory:');
    this.db.exec(
      'PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA secure_delete=ON;'
    );
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, version INTEGER NOT NULL, expires INTEGER NOT NULL, body TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS session_expiry ON sessions(expires);
      CREATE TABLE IF NOT EXISTS flows(key TEXT PRIMARY KEY, session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE, expires INTEGER, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS inbox(id INTEGER PRIMARY KEY, body TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY, session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE, chat_id INTEGER NOT NULL, body TEXT NOT NULL, sent INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL DEFAULT 'pending', next_attempt INTEGER NOT NULL DEFAULT 0, last_error TEXT);
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS outbox_chat_limits(chat_id INTEGER PRIMARY KEY, next_attempt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS bot_ui(key TEXT PRIMARY KEY, expires INTEGER NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS session_aliases(alias_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
        target_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, CHECK(alias_id != target_id));
      PRAGMA user_version=1;
    `);
    const outboxColumns = new Set(
      (this.database.prepare('PRAGMA table_info(outbox)').all() as Array<{ name: string }>).map((row) => row.name)
    );
    if (!outboxColumns.has('state')) this.database.exec("ALTER TABLE outbox ADD COLUMN state TEXT NOT NULL DEFAULT 'pending'");
    if (!outboxColumns.has('next_attempt')) this.database.exec('ALTER TABLE outbox ADD COLUMN next_attempt INTEGER NOT NULL DEFAULT 0');
    if (!outboxColumns.has('last_error')) this.database.exec('ALTER TABLE outbox ADD COLUMN last_error TEXT');
    this.database.exec('CREATE INDEX IF NOT EXISTS outbox_ready ON outbox(state,next_attempt)');
    this.database
      .prepare(
        "UPDATE outbox SET state=CASE WHEN sent=1 THEN 'sent' WHEN attempts>=10 THEN 'failed' ELSE 'pending' END WHERE state='pending'"
      )
      .run();
    this.database.prepare("UPDATE outbox SET state='pending' WHERE state='processing'").run();
    this.database.prepare("UPDATE inbox SET state='pending' WHERE state='processing'").run();
    await this.cleanupExpired();
  }
  private get database(): DatabaseSync {
    if (!this.db) throw new Error('STORE_NOT_READY');
    return this.db;
  }
  public async close(): Promise<void> {
    this.db?.close();
    this.db = undefined;
  }
  public healthy(): boolean {
    try {
      return !!this.database.prepare('SELECT 1').get();
    } catch {
      return false;
    }
  }
  public importLegacy(file: string): void {
    if (this.database.prepare("SELECT value FROM meta WHERE key='legacy_imported'").get() || !existsSync(file)) return;
    const snapshot = JSON.parse(readFileSync(file, 'utf8')) as { sessions: unknown[] };
    if (!Array.isArray(snapshot.sessions)) throw new Error('INVALID_LEGACY_STORE');
    this.database.exec('BEGIN IMMEDIATE');
    try {
      for (const raw of snapshot.sessions) {
        const s = sessionSchema.parse(raw);
        if (Date.parse(s.expiresAt) > Date.now()) this.insert(s);
      }
      this.database.prepare("INSERT INTO meta(key,value) VALUES ('legacy_imported','1')").run();
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
  private insert(s: ReceiptSession): void {
    this.database.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(s.id, s.version, Date.parse(s.expiresAt), JSON.stringify(s));
  }
  public async createSession(
    ownerUserId: number,
    sourceChatId: number,
    receipt: ParsedReceipt,
    sourceKey?: string,
    photo?: { fileUniqueId?: string }
  ): Promise<ReceiptSession> {
    if (sourceKey) {
      const prior = this.database.prepare('SELECT value FROM meta WHERE key=?').get('photo:' + sourceKey) as { value: string } | undefined;
      if (prior) {
        const s = this.getSession(prior.value);
        if (s) return s;
      }
    }
    if (photo) {
      const existing =
        this.findPhotoSource(ownerUserId, sourceChatId, photo.fileUniqueId) ||
        this.findReceiptDuplicate(ownerUserId, sourceChatId, receipt);
      if (existing) {
        this.bindPhotoSource(existing, sourceKey, photo.fileUniqueId);
        return existing;
      }
    }
    const now = new Date().toISOString();
    const s = sessionSchema.parse({
      id: randomBytes(16).toString('base64url'),
      ownerUserId,
      sourceChatId,
      receipt,
      participants: {},
      version: 1,
      status: 'draft',
      splitMode: 'items',
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(Date.now() + this.sessionTtlMs).toISOString()
    });
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.insert(s);
      if (sourceKey) this.database.prepare('INSERT OR REPLACE INTO meta VALUES (?,?)').run('photo:' + sourceKey, s.id);
      if (photo) this.bindPhotoSource(s, sourceKey, photo.fileUniqueId);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    return s;
  }
  public getSession(id: string): ReceiptSession | undefined {
    const alias = this.database.prepare('SELECT target_id FROM session_aliases WHERE alias_id=?').get(id) as
      { target_id: string } | undefined;
    if (alias) id = alias.target_id;
    const row = this.database.prepare('SELECT body FROM sessions WHERE id=? AND expires>?').get(id, Date.now()) as Row | undefined;
    return row ? sessionSchema.parse(JSON.parse(row.body)) : undefined;
  }
  private photoKey(ownerUserId: number, chatId: number, fileUniqueId: string): string {
    return 'image:' + ownerUserId + ':' + chatId + ':' + createHash('sha256').update(fileUniqueId).digest('hex');
  }
  public findPhotoSource(ownerUserId: number, chatId: number, fileUniqueId?: string): ReceiptSession | undefined {
    if (!fileUniqueId) return undefined;
    const row = this.database.prepare('SELECT value FROM meta WHERE key=?').get(this.photoKey(ownerUserId, chatId, fileUniqueId)) as
      { value: string } | undefined;
    const session = row ? this.getSession(row.value) : undefined;
    return session?.ownerUserId === ownerUserId && session.sourceChatId === chatId ? session : undefined;
  }
  public bindPhotoSource(session: ReceiptSession, sourceKey?: string, fileUniqueId?: string): void {
    if (sourceKey) this.database.prepare('INSERT OR REPLACE INTO meta VALUES (?,?)').run('photo:' + sourceKey, session.id);
    if (fileUniqueId)
      this.database
        .prepare('INSERT OR REPLACE INTO meta VALUES (?,?)')
        .run(this.photoKey(session.ownerUserId, session.sourceChatId, fileUniqueId), session.id);
  }
  private findReceiptDuplicate(ownerUserId: number, chatId: number, receipt: ParsedReceipt): ReceiptSession | undefined {
    const candidates = this.listCatalogSessions(ownerUserId, chatId).filter(
      (s) => s.ownerUserId === ownerUserId && samePrintedReceipt(s.receipt, receipt)
    );
    return candidates.length === 1 ? candidates[0] : undefined;
  }
  public linkDuplicateDraft(draftId: string, targetId: string): void {
    const draft = this.getSession(draftId),
      target = this.getSession(targetId);
    assertSafeDuplicateDraft(draft, target);
    if (draft!.id !== draftId || target!.id !== targetId) throw new Error('UNSAFE_DUPLICATE_LINK');
    if (this.database.prepare('SELECT 1 FROM session_aliases WHERE target_id=?').get(draftId)) throw new Error('UNSAFE_DUPLICATE_LINK');
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare('INSERT INTO session_aliases VALUES (?,?)').run(draftId, targetId);
      this.database.prepare("UPDATE meta SET value=? WHERE value=? AND (key LIKE 'photo:%' OR key LIKE 'image:%')").run(targetId, draftId);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
  public findSource(key: string): ReceiptSession | undefined {
    const row = this.database.prepare('SELECT value FROM meta WHERE key=?').get('photo:' + key) as { value: string } | undefined;
    return row ? this.getSession(row.value) : undefined;
  }
  public listSessions(userId: number): ReceiptSession[] {
    return (
      this.database
        .prepare(
          "SELECT body FROM sessions WHERE expires>? AND id NOT IN (SELECT alias_id FROM session_aliases) AND (json_extract(body,'$.ownerUserId')=? OR json_extract(body,?) IS NOT NULL) ORDER BY expires DESC LIMIT 50"
        )
        .all(Date.now(), userId, '$.participants."' + userId + '"') as Row[]
    ).map((r) => sessionSchema.parse(JSON.parse(r.body)));
  }
  public listCatalogSessions(userId: number, sourceChatId?: number): ReceiptSession[] {
    return (
      this.database
        .prepare(
          `SELECT body FROM sessions WHERE expires>? AND id NOT IN (SELECT alias_id FROM session_aliases)
      AND (json_extract(body,'$.ownerUserId')=? OR json_extract(body,?) IS NOT NULL)
      AND (json_extract(body,'$.status')!='draft' OR json_extract(body,'$.ownerUserId')=?)
      AND (? IS NULL OR json_extract(body,'$.sourceChatId')=?)
      ORDER BY json_extract(body,'$.createdAt') DESC, id DESC`
        )
        .all(Date.now(), userId, '$.participants."' + userId + '"', userId, sourceChatId ?? null, sourceChatId ?? null) as Row[]
    ).map((row) => sessionSchema.parse(JSON.parse(row.body)));
  }
  public getBotUi(chatId: number, userId: number): BotUiState {
    const row = this.database.prepare('SELECT body FROM bot_ui WHERE key=? AND expires>?').get(chatId + ':' + userId, Date.now()) as
      Row | undefined;
    return row ? (JSON.parse(row.body) as BotUiState) : {};
  }
  public botUiOwner(chatId: number, messageId: number): number | undefined {
    const row = this.database
      .prepare("SELECT key FROM bot_ui WHERE key LIKE ? AND expires>? AND json_extract(body,'$.messageId')=?")
      .get(chatId + ':%', Date.now(), messageId) as { key: string } | undefined;
    return row ? Number(row.key.split(':')[1]) : undefined;
  }
  public setBotUi(chatId: number, userId: number, update: Partial<BotUiState>): void {
    this.database
      .prepare('INSERT OR REPLACE INTO bot_ui VALUES (?,?,?)')
      .run(chatId + ':' + userId, Date.now() + this.sessionTtlMs, JSON.stringify({ ...this.getBotUi(chatId, userId), ...update }));
  }
  public findInvitation(token: string): ReceiptSession | undefined {
    const row = this.database
      .prepare("SELECT body FROM sessions WHERE expires>? AND json_extract(body,'$.inviteToken')=?")
      .get(Date.now(), token) as Row | undefined;
    return row ? sessionSchema.parse(JSON.parse(row.body)) : undefined;
  }
  public async updateSession(
    id: string,
    update: (s: ReceiptSession) => void | Promise<void>,
    options: { actorUserId?: number; ownerOnly?: boolean; expectedVersion?: number } = {}
  ): Promise<ReceiptSession> {
    const s = this.getSession(id);
    if (!s) throw new Error('SESSION_NOT_FOUND');
    if (s.id !== id) throw new Error('SESSION_CONFLICT');
    if (options.ownerOnly && options.actorUserId !== s.ownerUserId) throw new Error('SESSION_FORBIDDEN');
    if (s.status === 'finalized') throw new Error('SESSION_FINALIZED');
    if (options.expectedVersion !== undefined && s.version !== options.expectedVersion) throw new Error('SESSION_CONFLICT');
    const version = s.version;
    const pending = update(s);
    if (pending) await pending;
    s.version = version + 1;
    s.updatedAt = new Date().toISOString();
    const valid = sessionSchema.parse(s);
    const result = this.database
      .prepare('UPDATE sessions SET version=?,body=? WHERE id=? AND version=? AND expires>?')
      .run(valid.version, JSON.stringify(valid), id, version, Date.now());
    if (!result.changes) throw new Error('SESSION_CONFLICT');
    return valid;
  }
  public async join(id: string, userId: number, displayName: string): Promise<ReceiptSession> {
    const s = this.getSession(id);
    if (!s) throw new Error('SESSION_NOT_FOUND');
    if (s.status === 'draft') throw new Error('RECEIPT_NOT_CONFIRMED');
    if (s.participants[String(userId)] || s.status === 'finalized') return s;
    return this.updateSession(id, (draft) => {
      if (Object.keys(draft.participants).length >= 100) throw new Error('PARTICIPANT_LIMIT');
      draft.participants[String(userId)] = {
        userId,
        displayName: displayName.slice(0, 120),
        itemIds: [],
        updatedAt: new Date().toISOString()
      };
    });
  }
  public async saveSelection(
    id: string,
    userId: number,
    name: string,
    itemIds: string[],
    version: number,
    itemQuantities: Record<string, number> = {}
  ): Promise<ReceiptSession> {
    return this.updateSession(
      id,
      (s) => {
        if (s.status !== 'open') throw new Error('RECEIPT_NOT_CONFIRMED');
        if (!s.participants[String(userId)]) throw new Error('SESSION_FORBIDDEN');
        if (itemIds.some((id) => !s.receipt.items.some((i) => i.id === id))) throw new Error('ITEM_NOT_FOUND');
        if (Object.keys(itemQuantities).some((id) => !itemIds.includes(id))) throw new Error('INVALID_QUANTITY');
        Object.values(itemQuantities).forEach(quantityUnits);
        s.participants[String(userId)] = {
          userId,
          displayName: name.slice(0, 120),
          itemIds: [...new Set(itemIds)],
          itemQuantities: { ...itemQuantities },
          updatedAt: new Date().toISOString()
        };
        if (calculateSettlement({ ...s, splitMode: 'items' }).overallocatedItemIds.length) throw new Error('QUANTITY_EXCEEDED');
      },
      { expectedVersion: version }
    );
  }
  public async toggleSelection(id: string, userId: number, name: string, itemId: string): Promise<ReceiptSession> {
    const s = this.getSession(id);
    if (!s) throw new Error('SESSION_NOT_FOUND');
    const selected = s.participants[String(userId)]?.itemIds || [];
    return this.saveSelection(
      id,
      userId,
      name,
      selected.includes(itemId) ? selected.filter((i) => i !== itemId) : [...selected, itemId],
      s.version,
      Object.fromEntries(Object.entries(s.participants[String(userId)]?.itemQuantities || {}).filter(([id]) => id !== itemId))
    );
  }
  public async finalize(id: string, userId: number, version: number): Promise<ReceiptSession> {
    const s = this.getSession(id);
    if (!s) throw new Error('SESSION_NOT_FOUND');
    if (s.id !== id) throw new Error('SESSION_CONFLICT');
    if (s.ownerUserId !== userId) throw new Error('SESSION_FORBIDDEN');
    if (s.status === 'finalized') return s;
    if (version !== s.version) throw new Error('SESSION_CONFLICT');
    const result = calculateSettlement(s);
    if (!result.canFinalize) throw new Error('UNASSIGNED_ITEMS');
    s.status = 'finalized';
    s.version++;
    s.updatedAt = new Date().toISOString();
    const text = [
      'Итог разделения чека № ' + (s.receipt.receiptNumber || '—'),
      ...result.participants.map((p) => p.displayName + ': ' + formatMoney(p.totalMinor, s.receipt.currency)),
      'Всего: ' + formatMoney(s.receipt.totalMinor, s.receipt.currency)
    ].join('\n');
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const changed = this.database
        .prepare('UPDATE sessions SET body=?,version=? WHERE id=? AND version=?')
        .run(JSON.stringify(s), s.version, id, version);
      if (!changed.changes) throw new Error('SESSION_CONFLICT');
      for (let i = 0; i < text.length; i += 3800)
        this.database
          .prepare('INSERT OR IGNORE INTO outbox(id,session_id,chat_id,body) VALUES (?,?,?,?)')
          .run(id + ':final:' + i, id, s.sourceChatId, text.slice(i, i + 3800));
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    return s;
  }
  public getFlow(chatId: number, userId: number): UserFlow | undefined {
    const row = this.database.prepare('SELECT body FROM flows WHERE key=? AND expires>?').get(chatId + ':' + userId, Date.now()) as
      Row | undefined;
    return row ? (JSON.parse(row.body) as UserFlow) : undefined;
  }
  public async setFlow(chatId: number, userId: number, flow: Omit<UserFlow, 'updatedAt'>): Promise<void> {
    this.database
      .prepare('INSERT OR REPLACE INTO flows VALUES (?,?,?,?)')
      .run(chatId + ':' + userId, flow.sessionId, Date.now() + 900000, JSON.stringify({ ...flow, updatedAt: new Date().toISOString() }));
  }
  public async clearFlow(chatId: number, userId: number): Promise<void> {
    this.database.prepare('DELETE FROM flows WHERE key=?').run(chatId + ':' + userId);
  }
  public async cleanupExpired(): Promise<number> {
    this.database.prepare('DELETE FROM bot_ui WHERE expires<=?').run(Date.now());
    this.database.prepare('DELETE FROM flows WHERE expires<=?').run(Date.now());
    this.database.prepare('DELETE FROM inbox WHERE created<?').run(Date.now() - 86400000);
    this.database.prepare('DELETE FROM outbox_chat_limits WHERE next_attempt<=?').run(Date.now());
    const result = this.database.prepare('DELETE FROM sessions WHERE expires<=?').run(Date.now());
    this.database
      .prepare("DELETE FROM meta WHERE (key LIKE 'photo:%' OR key LIKE 'image:%') AND value NOT IN (SELECT id FROM sessions)")
      .run();
    this.database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    return Number(result.changes);
  }
  public queueMetrics(): string {
    const counts = this.database.prepare('SELECT state,count(*) AS count FROM inbox GROUP BY state').all() as Array<{
      state: string;
      count: number;
    }>;
    const outbox = this.database.prepare('SELECT state,count(*) AS count FROM outbox GROUP BY state').all() as Array<{
      state: string;
      count: number;
    }>;
    return (
      counts.map((r) => `resplitter_inbox{state="${r.state}"} ${r.count}`).join('\n') +
      '\n' +
      outbox.map((r) => `resplitter_outbox{state="${r.state}"} ${r.count}`).join('\n') +
      '\nresplitter_outbox_pending ' +
      outbox.filter((r) => r.state === 'pending').reduce((total, r) => total + r.count, 0) +
      '\n'
    );
  }
  public enqueue(update: Update): void {
    if (!Number.isSafeInteger(update.update_id)) throw new Error('INVALID_UPDATE');
    if (this.database.prepare('SELECT id FROM inbox WHERE id=?').get(update.update_id)) return;
    const count = this.database.prepare("SELECT count(*) AS n FROM inbox WHERE state='pending'").get() as { n: number };
    if (count.n >= 1000) throw new Error('QUEUE_FULL');
    this.database.prepare('INSERT INTO inbox(id,body,created) VALUES (?,?,?)').run(update.update_id, JSON.stringify(update), Date.now());
  }
  public nextUpdate(): { id: number; update: Update; attempts: number } | undefined {
    const row = this.database.prepare("SELECT id,body,attempts FROM inbox WHERE state='pending' ORDER BY id LIMIT 1").get() as
      (Row & { id: number; attempts: number }) | undefined;
    if (!row) return;
    this.database.prepare("UPDATE inbox SET state='processing',attempts=attempts+1 WHERE id=?").run(row.id);
    return { id: row.id, update: JSON.parse(row.body) as Update, attempts: row.attempts + 1 };
  }
  public finishUpdate(id: number, retry = false): void {
    this.database
      .prepare(
        "UPDATE inbox SET state=CASE WHEN ?=1 AND attempts<3 THEN 'pending' WHEN ?=1 THEN 'failed' ELSE 'done' END, body=CASE WHEN ?=1 AND attempts<3 THEN body ELSE '{}' END WHERE id=?"
      )
      .run(Number(retry), Number(retry), Number(retry), id);
  }
  public getOffset(): number {
    return Number((this.database.prepare("SELECT value FROM meta WHERE key='offset'").get() as { value: string } | undefined)?.value || 0);
  }
  public setOffset(value: number): void {
    this.database.prepare("INSERT OR REPLACE INTO meta VALUES ('offset',?)").run(String(value));
  }
  public nextNotification(now = Date.now()): { id: string; chat_id: number; body: string } | undefined {
    const limit = this.database.prepare("SELECT value FROM meta WHERE key='outbox:next_global'").get() as { value: string } | undefined;
    if (limit && Number(limit.value) > now) return undefined;
    const entry = this.database
      .prepare(
        `SELECT o.id,o.chat_id,o.body FROM outbox o LEFT JOIN outbox_chat_limits c ON c.chat_id=o.chat_id
        WHERE o.state='pending' AND o.next_attempt<=? AND (c.next_attempt IS NULL OR c.next_attempt<=?)
        ORDER BY o.next_attempt,o.id LIMIT 1`
      )
      .get(now, now) as { id: string; chat_id: number; body: string } | undefined;
    if (!entry) return undefined;
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const claim = this.database.prepare("UPDATE outbox SET state='processing' WHERE id=? AND state='pending'").run(entry.id);
      if (!claim.changes) {
        this.database.exec('ROLLBACK');
        return undefined;
      }
      this.database.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES ('outbox:next_global',?)").run(String(now + 34));
      this.database
        .prepare('INSERT OR REPLACE INTO outbox_chat_limits(chat_id,next_attempt) VALUES (?,?)')
        .run(entry.chat_id, now + (entry.chat_id < 0 ? 3000 : 1000));
      this.database.exec('COMMIT');
      return entry;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
  public notificationAttempt(id: string, outcome: NotificationOutcome, now = Date.now()): void {
    const entry = this.database.prepare('SELECT attempts,state FROM outbox WHERE id=?').get(id) as
      { attempts: number; state: string } | undefined;
    if (!entry || entry.state !== 'processing') return;
    const attempts = entry.attempts + 1;
    if (outcome.status === 'sent') {
      this.database
        .prepare("UPDATE outbox SET attempts=?,sent=1,state='sent',next_attempt=?,last_error=NULL WHERE id=?")
        .run(attempts, now, id);
      return;
    }
    const failed = outcome.status === 'failed' || attempts >= 10;
    const requestedDelay = outcome.status === 'retry' ? outcome.retryAfterMs : undefined;
    const retryAfterMs =
      requestedDelay && Number.isFinite(requestedDelay) && requestedDelay > 0
        ? Math.min(Math.max(1000, Math.ceil(requestedDelay)), Number.MAX_SAFE_INTEGER - now)
        : 1000 * 2 ** Math.min(attempts, 10);
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database
        .prepare('UPDATE outbox SET attempts=?,sent=0,state=?,next_attempt=?,last_error=? WHERE id=?')
        .run(attempts, failed ? 'failed' : 'pending', failed ? now : now + retryAfterMs, outcome.error?.slice(0, 500) || null, id);
      if (outcome.status === 'retry' && outcome.rateLimited) {
        const previous = this.database.prepare("SELECT value FROM meta WHERE key='outbox:next_global'").get() as
          { value: string } | undefined;
        this.database
          .prepare("INSERT OR REPLACE INTO meta(key,value) VALUES ('outbox:next_global',?)")
          .run(String(Math.max(Number(previous?.value || 0), now + retryAfterMs)));
      }
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}
export const stateService = new StateService(config.storage.databaseFile, config.storage.sessionTtlMs);
