import { isIP } from 'node:net';
import type { IncomingMessage } from 'node:http';

function normalize(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(trimmed);
  const address = bracketed ? bracketed[1] : trimmed;
  const version = isIP(address);
  if (version === 4) return address;
  if (version !== 6 || address.includes('%')) return undefined;
  const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(canonical);
  if (!mapped) return canonical;
  const first = parseInt(mapped[1], 16);
  const second = parseInt(mapped[2], 16);
  return [first >> 8, first & 255, second >> 8, second & 255].join('.');
}

export function clientAddress(req: IncomingMessage, trustedProxyIps: readonly string[] = []): string {
  const remote = normalize(req.socket.remoteAddress) || 'unknown';
  const trusted = new Set(trustedProxyIps.map(normalize).filter((value): value is string => !!value));
  if (!trusted.has(remote)) return remote;
  const value = req.headers['x-forwarded-for'];
  if (!value) return remote;
  const chain = (Array.isArray(value) ? value.join(',') : value).split(',');
  let current = remote;
  for (let i = chain.length - 1; i >= 0 && trusted.has(current); i--) {
    const next = normalize(chain[i]);
    if (!next) return remote;
    current = next;
  }
  return current;
}
