import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateSettlement } from '../src/domain/settlement';
import { quantityUnits } from '../src/domain/quantity';
import { demoReceipt } from '../src/domain/demo';
import { StateService } from '../src/services/state-service';
import { ReceiptReviewService } from '../src/services/receipt-review-service';
import { selectionSchema } from '../src/domain/schema';
import type { ReceiptSession } from '../src/interfaces';

function fixture(quantity = 3, totalMinor = 90000): ReceiptSession {
  const now = new Date().toISOString();
  const receipt = demoReceipt();
  receipt.items = [{ id: 'beer', name: 'Пиво', quantity, unitPriceMinor: Math.round(totalMinor / quantity), lineTotalMinor: totalMinor }];
  receipt.totalMinor = receipt.subtotalMinor = totalMinor;
  return {
    id: 'test',
    sourceChatId: -100,
    ownerUserId: 1,
    receipt,
    status: 'open',
    splitMode: 'items',
    version: 1,
    createdAt: now,
    updatedAt: now,
    expiresAt: now,
    participants: {
      '1': { userId: 1, displayName: 'Первый', itemIds: ['beer'], itemQuantities: { beer: 2 }, updatedAt: now },
      '2': { userId: 2, displayName: 'Второй', itemIds: ['beer'], itemQuantities: { beer: 1 }, updatedAt: now }
    }
  };
}

test('three beers are allocated as two and one, not equally', () => {
  const result = calculateSettlement(fixture());
  assert.deepEqual(result.itemShares.beer, { '1': 60000, '2': 30000 });
  assert.equal(result.canFinalize, true);
  assert.equal(result.remainingQuantities.beer, 0);
  assert.equal(result.unassignedMinor, 0);
});

test('partly assigned rows leave proportional unpaid remainder and cannot finalize', () => {
  const s = fixture();
  s.participants['1'].itemQuantities = { beer: 1 };
  s.participants['2'].itemIds = [];
  s.participants['2'].itemQuantities = {};
  const result = calculateSettlement(s);
  assert.equal(result.participants[0].totalMinor, 30000);
  assert.equal(result.unassignedMinor, 60000);
  assert.equal(result.remainingQuantities.beer, 2);
  assert.deepEqual(result.unassignedItemIds, ['beer']);
  assert.equal(result.canFinalize, false);
  s.receipt.items[0].lineTotalMinor = s.receipt.totalMinor = s.receipt.subtotalMinor = 1;
  s.participants['1'].itemQuantities = { beer: 2.999 };
  assert.equal(calculateSettlement(s).canFinalize, false, 'Even a zero-kopeck remainder still has unassigned units');
});

test('fractional units, fees, discounts and odd kopecks reconcile', () => {
  const s = fixture(0.75, 10001);
  s.participants['1'].itemQuantities = { beer: 0.5 };
  s.participants['2'].itemQuantities = { beer: 0.25 };
  for (const total of [1, 8001, 11001]) {
    s.receipt.totalMinor = total;
    const result = calculateSettlement(s);
    assert.equal(result.canFinalize, true);
    assert.equal(
      result.participants.reduce((sum, p) => sum + p.totalMinor, 0),
      total
    );
    assert.equal(
      Object.values(result.itemShares.beer).reduce((a, b) => a + b, 0),
      10001
    );
  }
  for (const quantity of [0, -1, Infinity, NaN, 0.0001, 10001]) assert.throws(() => quantityUnits(quantity), /INVALID_QUANTITY/);
  assert.equal(quantityUnits(1.001), 1001);
});

test('shared portions split the remainder and legacy choices keep equal semantics', () => {
  const s = fixture(3, 10001);
  s.participants['1'].itemQuantities = { beer: 1 };
  s.participants['2'].itemQuantities = {};
  s.participants['3'] = { ...s.participants['2'], userId: 3 };
  s.participants['4'] = { ...s.participants['2'], userId: 4 };
  const result = calculateSettlement(s);
  assert.equal(result.canFinalize, true);
  assert.equal(result.itemShares.beer['1'], 3334);
  assert.deepEqual([result.itemShares.beer['2'], result.itemShares.beer['3'], result.itemShares.beer['4']], [2223, 2222, 2222]);
  for (const p of Object.values(s.participants)) delete p.itemQuantities;
  assert.deepEqual(Object.values(calculateSettlement(s).itemShares.beer), [2501, 2500, 2500, 2500]);
});

test('over-allocation cannot finalize, while equal mode still includes everyone', () => {
  const s = fixture();
  s.participants['2'].itemQuantities = { beer: 2 };
  assert.deepEqual(calculateSettlement(s).overallocatedItemIds, ['beer']);
  assert.equal(calculateSettlement(s).canFinalize, false);
  s.splitMode = 'equal';
  assert.deepEqual(
    calculateSettlement(s).participants.map((p) => p.totalMinor),
    [45000, 45000]
  );
});

test('selection schema rejects malformed or excessively precise quantities', () => {
  for (const value of [0, -2, '2', null, 0.0001, 10001])
    assert.equal(selectionSchema.safeParse({ version: 1, itemIds: ['beer'], itemQuantities: { beer: value } }).success, false);
  assert.equal(selectionSchema.safeParse({ version: 1, itemIds: ['beer'], itemQuantities: { beer: 1.001 } }).success, true);
  assert.equal(selectionSchema.safeParse({ version: 1, itemIds: ['beer'] }).success, true);
});

test('concurrent participants cannot overwrite each other or overbook; receipt edits clear quantities', async () => {
  const store = new StateService();
  await store.initialize();
  try {
    let s = await store.createSession(1, -100, fixture().receipt);
    const review = new ReceiptReviewService(store);
    s = await review.confirm(s.id, 1, s.version);
    await Promise.all([store.join(s.id, 1, 'Первый'), store.join(s.id, 2, 'Второй'), store.join(s.id, 3, 'Третий')]);
    s = store.getSession(s.id)!;
    assert.equal(Object.keys(s.participants).length, 3);
    const results = await Promise.allSettled([
      store.saveSelection(s.id, 1, 'Первый', ['beer'], s.version, { beer: 2 }),
      store.saveSelection(s.id, 2, 'Второй', ['beer'], s.version, { beer: 1 })
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.match((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason.message, /SESSION_CONFLICT/);
    s = store.getSession(s.id)!;
    s = await store.saveSelection(s.id, 2, 'Второй', ['beer'], s.version, { beer: 1 });
    assert.deepEqual(s.participants['1'].itemQuantities, { beer: 2 });
    const before = s.version;
    await assert.rejects(store.saveSelection(s.id, 3, 'Третий', ['beer'], s.version, { beer: 1 }), /QUANTITY_EXCEEDED/);
    await assert.rejects(store.saveSelection(s.id, 3, 'Третий', [], s.version, { beer: 1 }), /INVALID_QUANTITY/);
    assert.equal(store.getSession(s.id)!.version, before);
    s = await review.revise(s.id, 1, s.version, (r) => {
      r.items[0].name = 'Напиток';
    });
    assert.ok(Object.values(s.participants).every((p) => !p.itemIds.length && !Object.keys(p.itemQuantities || {}).length));
    assert.equal(s.status, 'draft');
  } finally {
    await store.close();
  }
});
