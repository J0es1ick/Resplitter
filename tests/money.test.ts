import assert from 'node:assert/strict';
import test from 'node:test';

import { allocateEvenly, parseMoneyToMinor } from '../src/utils/money';

test('parseMoneyToMinor handles Russian and international separators', () => {
  assert.equal(parseMoneyToMinor('1 234,56 ₽'), 123456);
  assert.equal(parseMoneyToMinor('1.234,56'), 123456);
  assert.equal(parseMoneyToMinor('1,234.56'), 123456);
  assert.equal(parseMoneyToMinor('650'), 65000);
  assert.equal(parseMoneyToMinor('-1'), undefined);
  for (const input of ['abc12', '12abc', '1..2', '1,2,3', '12 34', '1.2345', 'NaN', 'Infinity'])
    assert.equal(parseMoneyToMinor(input), undefined);
});

test('allocateEvenly preserves every kopek', () => {
  const shares = allocateEvenly(10000, 3);
  assert.deepEqual(shares, [3334, 3333, 3333]);
  assert.equal(
    shares.reduce((sum, share) => sum + share, 0),
    10000
  );
});
