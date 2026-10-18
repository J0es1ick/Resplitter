import assert from 'node:assert/strict';
import test from 'node:test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { notificationOutcome } from '../src/services/notification-delivery';
import { StateService } from '../src/services/state-service';
import { demoReceipt } from '../src/domain/demo';
import { ReceiptReviewService } from '../src/services/receipt-review-service';
import { createOutboxBot } from '../src/bot/outbox-bot';

async function finalized(store: StateService, chatId: number) {
  let session = await store.createSession(1, chatId, demoReceipt());
  session = await new ReceiptReviewService(store).confirm(session.id, 1, session.version);
  session = await store.join(session.id, 1, 'Owner');
  session = await store.saveSelection(
    session.id,
    1,
    'Owner',
    session.receipt.items.map((item) => item.id),
    session.version
  );
  return store.finalize(session.id, 1, session.version);
}

test('real Telegram client errors are classified and 429 is not retried inside the client', { timeout: 2000 }, async () => {
  for (const status of [403, 429]) {
    let calls = 0;
    const fetch: typeof globalThis.fetch = async () => {
      calls++;
      return new Response(
        JSON.stringify({
          ok: false,
          error_code: status,
          description: status === 403 ? 'bot was blocked' : 'slow down',
          parameters: { retry_after: 7 }
        }),
        { status }
      );
    };
    const bot = createOutboxBot('123:test', fetch);
    let received: unknown;
    try {
      await bot.sendMessage(42, 'test');
      assert.fail('Expected a Telegram error');
    } catch (error) {
      received = error;
    }
    assert.equal(calls, 1);
    const outcome = notificationOutcome(received);
    if (status === 403) assert.equal(outcome.status, 'failed');
    else {
      assert.equal(outcome.status, 'retry');
      if (outcome.status === 'retry') {
        assert.equal(outcome.retryAfterMs, 7000);
        assert.equal(outcome.rateLimited, true);
      }
    }
  }
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
    const second = store.nextNotification(now + 34);
    assert.ok(second);
    assert.notEqual(second.id, first.id);
    store.notificationAttempt(second.id, { status: 'failed', error: 'blocked' }, now + 34);
    assert.equal(store.nextNotification(now), undefined);
    assert.match(store.queueMetrics(), /resplitter_outbox\{state="failed"} 1/);
    assert.match(store.queueMetrics(), /resplitter_outbox\{state="pending"} 1/);
    assert.equal(store.nextNotification(now + 60000)?.id, first.id);
  } finally {
    await store.close();
  }
});

test('a Telegram 429 defers the whole outbox until the advertised deadline', async () => {
  const store = new StateService();
  await store.initialize();
  try {
    await finalized(store, 101);
    await finalized(store, 102);
    const now = 2_000_000;
    const first = store.nextNotification(now);
    assert.ok(first);
    store.notificationAttempt(first.id, { status: 'retry', rateLimited: true, retryAfterMs: 3_601_000 }, now);
    assert.equal(store.nextNotification(now + 34), undefined);
    assert.equal(store.nextNotification(now + 3_600_999), undefined);
    const second = store.nextNotification(now + 3_601_000);
    assert.ok(second);
    assert.notEqual(second.id, first.id);
  } finally {
    await store.close();
  }
});

test('outbox paces different chats and applies a separate interval for each chat', async () => {
  const store = new StateService();
  await store.initialize();
  try {
    await finalized(store, -101);
    await finalized(store, -101);
    await finalized(store, -102);
    const now = 3_000_000;
    const first = store.nextNotification(now);
    assert.ok(first);
    store.notificationAttempt(first.id, { status: 'sent' }, now);
    assert.equal(store.nextNotification(now + 33), undefined);
    const second = store.nextNotification(now + 34);
    assert.ok(second);
    assert.notEqual(second.chat_id, first.chat_id);
    store.notificationAttempt(second.id, { status: 'sent' }, now + 34);
    assert.equal(store.nextNotification(now + 2999), undefined);
    assert.ok(store.nextNotification(now + 3034));
  } finally {
    await store.close();
  }
});

test('global 429 cooldown remains in force after restart', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'resplitter-outbox-'));
  const database = path.join(directory, 'state.sqlite');
  try {
    const first = new StateService(database);
    await first.initialize();
    await finalized(first, 101);
    await finalized(first, 102);
    const now = Date.now();
    const notice = first.nextNotification(now);
    assert.ok(notice);
    first.notificationAttempt(notice.id, { status: 'retry', rateLimited: true, retryAfterMs: 7000 }, now);
    await first.close();

    const second = new StateService(database);
    await second.initialize();
    try {
      assert.equal(second.nextNotification(now + 6999), undefined);
      const next = second.nextNotification(now + 7000);
      assert.ok(next);
      assert.notEqual(next.id, notice.id);
    } finally {
      await second.close();
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
