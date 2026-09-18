import assert from 'node:assert/strict';
import test from 'node:test';
import { authenticateInitData } from '../src/security/telegram-auth';
import { RateLimit } from '../src/security/rate-limit';
import { initData, testToken } from './helpers';

test('auth verifies Telegram HMAC including signature and escaped Unicode', () => {
  assert.equal(
    authenticateInitData(
      initData(42, undefined, { signature: 'signed-telegram-field', user: JSON.stringify({ id: 42, first_name: 'Юля & Анна' }) }),
      testToken
    ).first_name,
    'Юля & Анна'
  );
});
test('auth rejects forged, duplicated, expired and future initData', () => {
  const signed = initData(42);
  for (const raw of [
    '',
    signed.replace('User', 'Admin'),
    signed + '&user={}',
    signed + '&hash=00',
    initData(42, 1),
    initData(42, Math.floor(Date.now() / 1000) + 90)
  ]) {
    assert.throws(() => authenticateInitData(raw, testToken), /UNAUTHORIZED|AUTH_EXPIRED/);
  }
  assert.throws(() => authenticateInitData(signed, 'wrong-token'), /UNAUTHORIZED/);
});
test('rate limiter bounds bursts per identity', () => {
  const limit = new RateLimit(2, 60000);
  assert.equal(limit.allow('a'), true);
  assert.equal(limit.allow('a'), true);
  assert.equal(limit.allow('a'), false);
  assert.equal(limit.allow('b'), true);
});
