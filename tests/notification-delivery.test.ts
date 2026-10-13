import assert from 'node:assert/strict';
import test from 'node:test';
import { notificationOutcome } from '../src/services/notification-delivery';
import { StateService } from '../src/services/state-service';
import { demoReceipt } from '../src/domain/demo';
import { ReceiptReviewService } from '../src/services/receipt-review-service';

async function finalized(store: StateService, chatId: number) {
  let session = await store.createSession(1, chatId, demoReceipt());
  session = await new ReceiptReviewService(store).confirm(session.id, 1, session.version);
  session = await store.join(session.id, 1, 'Owner');
  session = await store.saveSelection(session.id, 1, 'Owner', session.receipt.items.map((item) => item.id), session.version);
  return store.finalize(session.id, 1, session.version);
}

test('notification delivery identifies permanent Telegram failures and honors retry hints', () => {
  assert.deepEqual(notificationOutcome({ response: { statusCode: 403 }, message: 'bot was blocked' }), {
    status: 'failed',
    error: 'bot was blocked'
  });
  assert.deepEqual(notificationOutcome({ response: { statusCode: 429, body: { parameters: { retry_after: 7 } } }, message: 'slow down' }), {
    status: 'retry',
    retryAfterMs: 7000,
    error: 'slow down'
  });
});

test('a deferred or permanently failed notification does not block other recipients', async () => {
  const store = new StateService();
  await store.initialize();
  try {
    await finalized(store, 101);
    await finalized(store, 102);
    const now = 1_000_000;
    const first = store.nextNotification(now);
    assert.ok(first);
    store.notificationAttempt(first.id, { status: 'retry', retryAfterMs: 60000, error: 'temporary' }, now);
    const second = store.nextNotification(now);
    assert.ok(second);
    assert.notEqual(second.id, first.id);
    store.notificationAttempt(second.id, { status: 'failed', error: 'blocked' }, now);
    assert.equal(store.nextNotification(now), undefined);
    assert.match(store.queueMetrics(), /resplitter_outbox\{state="failed"} 1/);
    assert.match(store.queueMetrics(), /resplitter_outbox\{state="pending"} 1/);
    assert.equal(store.nextNotification(now + 60000)?.id, first.id);
  } finally {
    await store.close();
  }
});