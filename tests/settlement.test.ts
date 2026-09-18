import assert from 'node:assert/strict';
import test from 'node:test';
import { allocateWeighted, calculateSettlement } from '../src/domain/settlement';
import { demoReceipt } from '../src/domain/demo';
import type { ReceiptSession } from '../src/interfaces';

function fixture(): ReceiptSession {
  const now = new Date().toISOString();
  return {
    id: 'fixture',
    sourceChatId: 1,
    ownerUserId: 1,
    receipt: demoReceipt(),
    status: 'open',
    splitMode: 'items',
    version: 1,
    createdAt: now,
    updatedAt: now,
    expiresAt: now,
    participants: {
      '1': { userId: 1, displayName: 'A', itemIds: ['burrata', 'pasta', 'pizza', 'lemonade', 'dessert'], updatedAt: now },
      '2': { userId: 2, displayName: 'B', itemIds: ['pizza'], updatedAt: now }
    }
  };
}
test('shared items are charged only once', () => {
  const s = fixture();
  const result = calculateSettlement(s);
  assert.deepEqual(result.itemShares.pizza, { '1': 37000, '2': 37000 });
  assert.equal(
    result.participants.reduce((a, p) => a + p.totalMinor, 0),
    413000
  );
  assert.equal(result.canFinalize, true);
});
test('discounts, fees and odd kopeks reconcile exactly', () => {
  for (const total of [1, 10000, 412999, 413001, 470157]) {
    const s = fixture();
    s.receipt.totalMinor = total;
    const result = calculateSettlement(s);
    assert.equal(
      result.participants.reduce((a, p) => a + p.totalMinor, 0),
      total
    );
    assert.ok(result.participants.every((p) => p.totalMinor >= 0 && Number.isSafeInteger(p.totalMinor)));
  }
  for (let count = 1; count < 50; count++)
    for (let total = 0; total < 100; total++) {
      const weights = Array.from({ length: count }, (_, i) => i + 1);
      assert.equal(
        allocateWeighted(total, weights).reduce((a, b) => a + b, 0),
        total
      );
    }
});
test('unassigned items block finalization and equal mode includes all joined users', () => {
  const s = fixture();
  s.participants['1'].itemIds = [];
  assert.equal(calculateSettlement(s).canFinalize, false);
  s.splitMode = 'equal';
  s.receipt.totalMinor = 101;
  const result = calculateSettlement(s);
  assert.deepEqual(
    result.participants.map((p) => p.totalMinor),
    [51, 50]
  );
  assert.equal(result.canFinalize, true);
  s.status = 'draft';
  assert.equal(calculateSettlement(s).canFinalize, false);
});
