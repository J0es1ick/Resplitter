import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const userSchema = z.object({
  id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  first_name: z.string().min(1).max(120),
  last_name: z.string().max(120).optional(),
  username: z.string().max(64).optional()
});
export type MiniAppUser = z.infer<typeof userSchema>;

export function authenticateInitData(raw: string, token: string, now = Date.now(), maxAgeSeconds = 3600): MiniAppUser {
  if (!raw || Buffer.byteLength(raw) > 16384) throw new Error('UNAUTHORIZED');
  const values = new URLSearchParams(raw);
  if ([...values.keys()].length !== new Set(values.keys()).size) throw new Error('UNAUTHORIZED');
  const hash = values.get('hash') || '';
  if (!/^[0-9a-f]{64}$/i.test(hash)) throw new Error('UNAUTHORIZED');
  values.delete('hash');
  const data = [...values]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => k + '=' + v)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const expected = createHmac('sha256', secret).update(data).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, 'hex'))) throw new Error('UNAUTHORIZED');
  const authDate = Number(values.get('auth_date'));
  if (!Number.isSafeInteger(authDate) || authDate > now / 1000 + 30 || now / 1000 - authDate > maxAgeSeconds)
    throw new Error('AUTH_EXPIRED');
  try {
    return userSchema.parse(JSON.parse(values.get('user') || ''));
  } catch {
    throw new Error('UNAUTHORIZED');
  }
}
