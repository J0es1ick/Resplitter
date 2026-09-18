import { createHmac } from 'node:crypto';
export const testToken = '100000:test-only-token-never-used-on-telegram';
export function initData(id: number, date = Math.floor(Date.now() / 1000), extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({
    auth_date: String(date),
    user: JSON.stringify({ id, first_name: 'User ' + id }),
    query_id: 'test',
    ...extra
  });
  params.sort();
  const secret = createHmac('sha256', 'WebAppData').update(testToken).digest();
  params.set(
    'hash',
    createHmac('sha256', secret)
      .update([...params].map(([k, v]) => k + '=' + v).join('\n'))
      .digest('hex')
  );
  return params.toString();
}
