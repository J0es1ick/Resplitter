import assert from 'node:assert/strict';
import test from 'node:test';
import type { CallbackQuery, Message } from 'node-telegram-bot-api';
import { StateService } from '../src/services/state-service';
import { ReceiptReviewService, parseReviewItem } from '../src/services/receipt-review-service';
import { demoReceipt } from '../src/domain/demo';
import { createReceiptReviewHandlers } from '../src/handlers/receipt-review';
import { encodeCallback, decodeCallback, type CallbackAction } from '../src/utils/callback-data';
import { formatReceipt, REVIEW_PAGE_SIZE } from '../src/utils/format-receipt';
import { reviewKeyboard } from '../src/utils/send-receipt-with-actions';
import { calculateSettlement } from '../src/domain/settlement';
import type { ReceiptSession } from '../src/interfaces';
import type { BotInstance } from '../src/bot/bot';

test('native bot review: edit, add, remove, total, currency, stale versions and explicit confirmation', async () => {
  const store = new StateService();
  await store.initialize();
  const messages: Array<{ text: string; id: number }> = [];
  const opened: ReceiptSession[] = [];
  const shown: ReceiptSession[] = [];
  let nextMessage = 10;
  const fake = {
    async sendMessage(_chat: number, text: string) {
      const id = nextMessage++;
      messages.push({ text, id });
      return { message_id: id } as Message;
    },
    async answerCallbackQuery() {
      return true;
    }
  } as Pick<BotInstance, 'sendMessage' | 'answerCallbackQuery'>;
  const handlers = createReceiptReviewHandlers({
    bot: fake,
    store,
    show: async (_chat, s) => {
      shown.push(s);
    },
    open: async (_chat, s) => {
      opened.push(s);
    }
  });
  try {
    const created = await store.createSession(1, -100, demoReceipt());
    const current = () => store.getSession(created.id)!;
    const callback = async (action: CallbackAction, value?: string, userId = 1, version = current().version) => {
      await handlers.callback({
        id: 'query',
        from: { id: userId, is_bot: false, first_name: 'Автор' },
        chat_instance: 'chat',
        message: { message_id: 9, date: 1, chat: { id: -100, type: 'group' } },
        data: encodeCallback(created.id, action, value, version)
      } as CallbackQuery);
    };
    const reply = (text: string, promptId?: number) =>
      handlers.text({
        message_id: 30,
        date: 1,
        chat: { id: -100, type: 'group' },
        from: { id: 1, is_bot: false, first_name: 'Автор' },
        text,
        reply_to_message: promptId ? ({ message_id: promptId } as Message) : undefined
      } as Message);
    await callback('confirm', undefined, 2);
    assert.equal(current().status, 'draft');
    assert.equal(opened.length, 0);
    assert.match(messages.at(-1)!.text, /Только автор/);
    await callback('editItem', '0');
    const flow = store.getFlow(-100, 1)!;
    assert.equal(await reply('Не про чек'), false);
    assert.equal(await reply('Чай | 580 | 2', flow.promptMessageId! + 1), false);
    await reply('Чай | -1 | 2', flow.promptMessageId);
    assert.ok(store.getFlow(-100, 1));
    assert.equal(current().version, 1);
    await reply('Чай <&> | 580 | 2', flow.promptMessageId);
    assert.equal(current().receipt.items[0].quantity, 2);
    assert.equal(current().receipt.items[0].lineTotalMinor, 58000);
    assert.equal(current().receipt.totalMinor, created.receipt.totalMinor);
    assert.equal(store.getFlow(-100, 1), undefined);
    await callback('confirm', undefined, 1, 1);
    assert.equal(opened.length, 0);
    assert.match(messages.at(-1)!.text, /уже изменился/);
    await callback('add');
    await reply('Комплимент | 0 | 2', store.getFlow(-100, 1)!.promptMessageId);
    assert.equal(current().receipt.items.at(-1)!.lineTotalMinor, 0);
    await callback('removeItem', '0');
    assert.equal(current().receipt.items.length, 6);
    await callback('deleteItem', '0');
    assert.equal(current().receipt.items.length, 5);
    await callback('change');
    await reply('312400', store.getFlow(-100, 1)!.promptMessageId);
    await callback('currency', 'UZS');
    assert.equal(current().receipt.currency, 'UZS');
    assert.equal(current().receipt.totalMinor, 31240000);
    await callback('confirm');
    assert.equal(current().status, 'open');
    assert.equal(opened.length, 1);
    await store.join(created.id, 1, 'Автор');
    await store.saveSelection(created.id, 1, 'Автор', [current().receipt.items[0].id], current().version);
    await callback('editItem', '0');
    await reply('Исправлено | 100 | 1', store.getFlow(-100, 1)!.promptMessageId);
    assert.equal(current().status, 'draft');
    assert.deepEqual(current().participants['1'].itemIds, []);
    assert.ok(shown.length > 0);
  } finally {
    await store.close();
  }
});

test('strict money and quantities, finalized receipt protection and owner checks', async () => {
  for (const text of ['Блюдо | 10 | 0', 'Блюдо | -10 | 1', 'Блюдо | 10 | 1e2', '| 10 | 1', 'Блюдо | 1000001 | 1'])
    assert.throws(() => parseReviewItem(text), /INVALID_ITEM_INPUT/);
  assert.equal(parseReviewItem('Вес | 300 | 0,5').quantity, 0.5);
  assert.equal(parseReviewItem('Подарок | 0 | 1').lineTotalMinor, 0);
  const store = new StateService();
  await store.initialize();
  try {
    let s = await store.createSession(1, 1, demoReceipt());
    const review = new ReceiptReviewService(store);
    await assert.rejects(
      review.revise(s.id, 2, s.version, () => {}),
      /SESSION_FORBIDDEN/
    );
    s = await review.confirm(s.id, 1, s.version);
    s = await store.join(s.id, 1, 'Автор');
    s = await store.saveSelection(
      s.id,
      1,
      'Автор',
      s.receipt.items.map((i) => i.id),
      s.version
    );
    s = await store.finalize(s.id, 1, s.version);
    await assert.rejects(
      review.revise(s.id, 1, s.version, () => {}),
      /SESSION_FINALIZED/
    );
    await assert.rejects(review.confirm(s.id, 1, s.version), /SESSION_FINALIZED/);
  } finally {
    await store.close();
  }
});

test('all native receipt pages are reachable, HTML is escaped, callbacks are compact and versioned', async () => {
  const store = new StateService();
  await store.initialize();
  try {
    const r = demoReceipt();
    r.items = Array.from({ length: 100 }, (_, i) => ({
      id: String(i),
      name: 'Блюдо <' + i + '> & кофе',
      quantity: 1,
      unitPriceMinor: 100,
      lineTotalMinor: 100
    }));
    r.subtotalMinor = r.totalMinor = 10000;
    const s = await store.createSession(1, 1, r);
    const pages = Array.from({ length: Math.ceil(r.items.length / REVIEW_PAGE_SIZE) }, (_, i) => formatReceipt(r, i));
    assert.ok(pages.every((p) => p.length < 4096 && !p.includes('<0>')));
    for (let i = 0; i < 100; i++) assert.equal(pages.filter((p) => p.includes('Блюдо &lt;' + i + '&gt;')).length, 1);
    for (const row of reviewKeyboard(s).inline_keyboard)
      for (const button of row) {
        assert.ok(Buffer.byteLength(button.callback_data) <= 64);
        if (button.callback_data.startsWith('nav:')) continue;
        assert.equal(decodeCallback(button.callback_data)?.version, 1);
      }
    assert.equal(decodeCallback(encodeCallback(s.id, 'confirm', undefined, 1) + '.garbage'), undefined);
  } finally {
    await store.close();
  }
});

test('a free unselected compliment does not block paid receipt settlement', () => {
  const receipt = demoReceipt();
  const now = new Date().toISOString();
  const itemIds = receipt.items.map((i) => i.id);
  receipt.items.push({ id: 'free', name: 'Комплимент', quantity: 2, unitPriceMinor: 0, lineTotalMinor: 0 });
  const result = calculateSettlement({
    receipt,
    status: 'open',
    splitMode: 'items',
    participants: { '1': { userId: 1, displayName: 'Автор', itemIds, updatedAt: now } }
  });
  assert.equal(result.canFinalize, true);
  assert.deepEqual(result.unassignedItemIds, []);
});
