import { isIP } from 'node:net';
import type { IncomingMessage } from 'node:http';

function normalize(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim().replace(/^"|"$/g, '');
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(trimmed);
  const address = (bracketed ? bracketed[1] : trimmed).replace(/^::ffff:/i, '');
  return isIP(address) ? address : undefined;
}

function forwardedAddress(value: string | string[] | undefined): string | undefined {
  const entries = (Array.isArray(value) ? value.join(',') : value || '').split(',');
  for (const entry of entries) {
    for (const parameter of entry.split(';')) {
      const match = /^\s*for\s*=\s*(.+?)\s*$/i.exec(parameter);
      const address = normalize(match?.[1]);
      if (address) return address;
    }
  }
  return undefined;
}

function forwardedFor(value: string | string[] | undefined): string | undefined {
  const first = (Array.isArray(value) ? value[0] : value || '').split(',')[0];
  return normalize(first);
}

export function clientAddress(req: IncomingMessage, trustedProxyIps: readonly string[] = []): string {
  const remote = normalize(req.socket.remoteAddress) || 'unknown';
  const trusted = new Set(trustedProxyIps.map(normalize).filter((value): value is string => !!value));
  if (!trusted.has(remote)) return remote;
  return forwardedAddress(req.headers.forwarded) || forwardedFor(req.headers['x-forwarded-for']) || remote;
}