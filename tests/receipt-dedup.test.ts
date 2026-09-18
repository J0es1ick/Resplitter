import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Message, CallbackQuery } from 'node-telegram-bot-api';
import type { BotInstance } from '../src/bot/bot';
import { StateService } from '../src/services/state-service';
import { ReceiptReviewService } from '../src/services/receipt-review-service';
import { samePrintedReceipt } from '../src/domain/receipt-identity';
import { demoReceipt } from '../src/domain/demo';
import { createPhotoHandler } from '../src/handlers/photo-handler';
import { createReceiptReviewHandlers } from '../src/handlers/receipt-review';
import { encodeCallback } from '../src/utils/callback-data';
import type { ParsedReceipt } from '../src/interfaces';

const receipt = (): ParsedReceipt => ({ ...demoReceipt(), receiptNumber: '43839', date: '12.04.2025', time: '14:24' });

test('photo reuploads reuse the same session, preserving confirmation, edits, selections and version', async () => {
  const store = new StateService();
  await store.initialize();
  try {
    let s = await store.createSession(1, 1, receipt(), '1:1', { fileUniqueId: 'photo-A' });
    const review = new ReceiptReviewService(store);
    s = await review.confirm(s.id, 1, s.version);
    s = await store.join(s.id, 1, 'Автор');
    s = await store.saveSelection(s.id, 1, 'Автор', [s.receipt.items[0].id], s.version);
    const snapshot = structuredClone(s);
    const anotherOcr = receipt();
    anotherOcr.items[0].quantity += 1;
    const copied = await store.createSession(1, 1, anotherOcr, '1:2', { fileUniqueId: 'photo-B' });
    assert.deepEqual(copied, snapshot);
    assert.equal(store.findSource('1:2')!.id, s.id);
    assert.equal(store.findPhotoSource(1, 1, 'photo-B')!.id, s.id);
    s = await review.revise(s.id, 1, s.version, (r) => {
      r.receiptNumber = 'Исправленный номер';
      r.items[0].name = 'Ручное исправление';
    });
    const reuploaded = await store.createSession(1, 1, receipt(), '1:3', { fileUniqueId: 'photo-A' });
    assert.deepEqual(reuploaded, s, 'immutable image identity survives all receipt edits');
    assert.equal(store.listCatalogSessions(1).length, 1);
  } finally {
    await store.close();
  }
});

test('receipt identity requires full metadata and matching contents, not just identical labels', async () => {
  const base = receipt();
  for (const alter of [
    (r: ParsedReceipt) => {
      r.date = '13.04.2025';
    },
    (r: ParsedReceipt) => {
      r.time = '15:24';
    },
    (r: ParsedReceipt) => {
      r.receiptNumber = '43840';
    },
    (r: ParsedReceipt) => {
      r.currency = 'UZS';
    },
    (r: ParsedReceipt) => {
      r.totalMinor++;
    },
    (r: ParsedReceipt) => {
      r.date = '';
    },
    (r: ParsedReceipt) => {
      r.time = '';
    },
    (r: ParsedReceipt) => {
      r.items.forEach((item) => {
        item.name = 'Совершенно другое';
      });
    }
  ]) {
    const other = receipt();
    alter(other);
    assert.equal(samePrintedReceipt(base, other), false);
  }
  assert.equal(samePrintedReceipt(demoReceipt(), demoReceipt()), false, 'a demo is not a physical receipt identity');
  const wrapped = receipt();
  wrapped.items[0].quantity++;
  wrapped.items[0].name += ' 200 2 х 1порц.';
  assert.equal(samePrintedReceipt(base, wrapped), true);
  const store = new StateService();
  await store.initialize();
  try {
    const a = await store.createSession(1, 1, base, '1:1', { fileUniqueId: 'same-photo' });
    const b = await store.createSession(2, 2, base, '2:1', { fileUniqueId: 'same-photo' });
    const c = await store.createSession(1, -100, base, '-100:1', { fileUniqueId: 'same-photo' });
    assert.equal(new Set([a.id, b.id, c.id]).size, 3, 'owners and chats are independent tables');
    assert.equal(store.findPhotoSource(3, 1, 'same-photo'), undefined);
  } finally {
    await store.close();
  }
});

test('concurrent duplicate photo creation is idempotent and expired photos can create a new session', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const store = new StateService(undefined, 1000);
  await store.initialize();
  try {
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => store.createSession(1, 1, receipt(), '1:' + i, { fileUniqueId: 'photo' }))
    );
    assert.equal(new Set(results.map((s) => s.id)).size, 1);
    t.mock.timers.tick(1001);
    const afterExpiry = await store.createSession(1, 1, receipt(), '1:6', { fileUniqueId: 'photo' });
    assert.notEqual(afterExpiry.id, results[0].id);
    assert.equal(store.listCatalogSessions(1).length, 1);
  } finally {
    await store.close();
  }
});

test('legacy duplicate drafts can redirect without altering canonical data or allowing stale mutations', async () => {
  const store = new StateService();
  await store.initialize();
  try {
    const draft = await store.createSession(1, 1, receipt(), '1:old');
    let canonical = await store.createSession(1, 1, receipt(), '1:new');
    canonical = await new ReceiptReviewService(store).confirm(canonical.id, 1, canonical.version);
    const snapshot = structuredClone(canonical);
    store.linkDuplicateDraft(draft.id, canonical.id);
    assert.equal(store.getSession(draft.id)!.id, canonical.id);
    assert.deepEqual(store.getSession(canonical.id), snapshot);
    assert.deepEqual(
      store.listCatalogSessions(1).map((s) => s.id),
      [canonical.id]
    );
    assert.equal(store.listSessions(1).length, 1);
    assert.equal(store.findSource('1:old')!.id, canonical.id);
    await assert.rejects(
      store.updateSession(draft.id, (s) => {
        s.receipt.totalMinor = 1;
      }),
      /SESSION_CONFLICT/
    );
    await assert.rejects(store.finalize(draft.id, 1, canonical.version), /SESSION_CONFLICT/);
    const reupload = await store.createSession(1, 1, receipt(), '1:again', { fileUniqueId: 'photo' });
    assert.equal(reupload.id, canonical.id);
  } finally {
    await store.close();
  }
});

test('duplicate repair refuses shared/selected drafts, different owners, and different receipts', async () => {
  const store = new StateService();
  await store.initialize();
  try {
    let canonical = await store.createSession(1, 1, receipt());
    canonical = await new ReceiptReviewService(store).confirm(canonical.id, 1, canonical.version);
    for (const unsafe of ['other-owner', 'invited', 'selected', 'member', 'different']) {
      const draft = await store.createSession(unsafe === 'other-owner' ? 2 : 1, 1, receipt());
      await store.updateSession(draft.id, (s) => {
        s.expiresAt = canonical.expiresAt;
        if (unsafe === 'invited') s.inviteToken = 'invite';
        if (unsafe === 'different') s.receipt.receiptNumber = 'not-the-same';
        if (unsafe === 'member' || unsafe === 'selected')
          s.participants['2'] = {
            userId: unsafe === 'member' ? 2 : 1,
            displayName: 'Участник',
            itemIds: unsafe === 'selected' ? [s.receipt.items[0].id] : [],
            updatedAt: s.createdAt
          };
      });
      assert.throws(() => store.linkDuplicateDraft(draft.id, canonical.id), /UNSAFE_DUPLICATE_LINK/);
    }
  } finally {
    await store.close();
  }
});

test('old duplicate buttons cannot mutate the canonical receipt even when versions happen to match', async () => {
  const store = new StateService();
  await store.initialize();
  try {
    let draft = await store.createSession(1, 1, receipt());
    draft = await store.updateSession(draft.id, () => {});
    let canonical = await store.createSession(1, 1, receipt());
    canonical = await new ReceiptReviewService(store).confirm(canonical.id, 1, canonical.version);
    assert.equal(draft.version, canonical.version);
    store.linkDuplicateDraft(draft.id, canonical.id);
    const messages: string[] = [];
    const bot = {
      sendMessage: async (_chat: number, text: string) => {
        messages.push(text);
        return { message_id: 1 } as Message;
      },
      answerCallbackQuery: async () => true
    } as Pick<BotInstance, 'sendMessage' | 'answerCallbackQuery'>;
    const review = createReceiptReviewHandlers({ bot, store, show: async () => {}, open: async () => {} });
    await review.callback({
      id: 'old',
      chat_instance: '',
      from: { id: 1, is_bot: false, first_name: 'Автор' },
      message: { message_id: 1, date: 1, chat: { id: 1, type: 'private' } },
      data: encodeCallback(draft.id, 'deleteItem', '0', draft.version)
    } as CallbackQuery);
    assert.match(messages.at(-1)!, /Чек уже изменился/);
    assert.deepEqual(store.getSession(canonical.id), canonical);
  } finally {
    await store.close();
  }
});

test('photo handler skips OCR for the same image and never turns an existing confirmed receipt into a draft', async () => {
  const store = new StateService();
  await store.initialize();
  let ocrCalls = 0;
  const drafts: string[] = [],
    opened: string[] = [];
  const handler = createPhotoHandler({
    store,
    screen: { adopt: async () => {}, show: async () => ({ message_id: 1 }) as Message },
    process: async () => {
      ocrCalls++;
      return receipt();
    },
    show: async (_chat, s) => {
      drafts.push(s.id);
    },
    open: async (_chat, s) => {
      opened.push(s!.id);
    }
  });
  const photo = (id: number, file = 'photo'): Message => ({
    message_id: id,
    date: 1,
    chat: { id: 1, type: 'private' },
    from: { id: 1, is_bot: false, first_name: 'Автор' },
    photo: [{ file_id: file, file_unique_id: file, width: 100, height: 100 }]
  });
  try {
    await handler(photo(1));
    const draft = store.listCatalogSessions(1)[0];
    const confirmed = await new ReceiptReviewService(store).confirm(draft.id, 1, draft.version);
    await handler(photo(2));
    assert.equal(ocrCalls, 1);
    await handler(photo(3, 'another-copy'));
    assert.equal(ocrCalls, 2);
    assert.deepEqual(drafts, [confirmed.id]);
    assert.deepEqual(opened, [confirmed.id, confirmed.id]);
    assert.deepEqual(store.getSession(confirmed.id), confirmed);
    assert.equal(store.listCatalogSessions(1).length, 1);
  } finally {
    await store.close();
  }
});

test('repair CLI is transactional, idempotent and leaves both source snapshots intact', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'resplitter-dedup-'));
  const file = path.join(directory, 'test.sqlite');
  const store = new StateService(file);
  await store.initialize();
  try {
    const draft = await store.createSession(1, 1, receipt());
    let canonical = await store.createSession(1, 1, receipt());
    canonical = await new ReceiptReviewService(store).confirm(canonical.id, 1, canonical.version);
    const read = new DatabaseSync(file, { readOnly: true });
    const before = read.prepare('SELECT id,body FROM sessions ORDER BY id').all();
    const run = (...pairs: string[]) =>
      spawnSync(process.execPath, ['scripts/link-duplicate-drafts.cjs', file, ...pairs], { encoding: 'utf8' });
    try {
      assert.notEqual(run(draft.id, canonical.id, canonical.id, draft.id).status, 0);
      assert.equal(read.prepare('SELECT count(*) AS n FROM session_aliases').get()!.n, 0, 'failed batch rolls back completely');
      assert.equal(run(draft.id, canonical.id).status, 0);
      assert.equal(run(draft.id, canonical.id).status, 0);
      assert.equal(read.prepare('SELECT count(*) AS n FROM session_aliases').get()!.n, 1);
      assert.deepEqual(read.prepare('SELECT id,body FROM sessions ORDER BY id').all(), before);
    } finally {
      read.close();
    }
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
