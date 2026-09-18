import assert from 'node:assert/strict';
import test from 'node:test';
import type { CallbackQuery, Message } from 'node-telegram-bot-api';
import type { BotInstance } from '../src/bot/bot';
import { demoReceipt } from '../src/domain/demo';
import { createReceiptReviewHandlers } from '../src/handlers/receipt-review';
import { createNavigationHandlers } from '../src/handlers/navigation';
import { StateService } from '../src/services/state-service';
import { parseReviewItem } from '../src/services/receipt-review-service';
import { encodeCallback, type CallbackAction } from '../src/utils/callback-data';

test('item edits accept mobile separators and retain the whole-row amount', () => {
  for (const input of [
    'Иван чай, 580, 2',
    'Иван чай. 580. 2',
    'Иван чай 580 2',
    'Иван чай,580,2',
    'Иван чай.580.2',
    'Иван чай; 580; 2',
    'Иван чай | 580 | 2',
    'Иван чай\n580\n2',
    'Иван чай\r\n580\r\n2'
  ]) {
    const item = parseReviewItem(input, 'same-id');
    assert.deepEqual(
      item,
      { id: 'same-id', name: 'Иван чай', quantity: 2, lineTotalMinor: 58000, unitPriceMinor: 29000, confidence: 1 },
      input
    );
  }
});

test('decimal numbers, thousands groups and punctuation in names are not confused with field separators', () => {
  for (const input of ['Чай, 580,50, 1,5', 'Чай. 580.50. 1.5', 'Чай 580,50 1,5', 'Чай; 580,50; 1,5']) {
    const item = parseReviewItem(input);
    assert.equal(item.name, 'Чай', input);
    assert.equal(item.lineTotalMinor, 58050, input);
    assert.equal(item.quantity, 1.5, input);
  }
  for (const input of ['Чай, 1 580,50, 2', 'Чай. 1.580,50. 2', 'Чай, 1,580.50, 2', 'Чай, 1\u00a0580,50, 2']) {
    assert.equal(parseReviewItem(input).lineTotalMinor, 158050, input);
  }
  for (const name of ['Пиво 0,5 л', 'Пиво 0.5 л', 'Чай, зелёный', 'Пицца 4 сыра', '7UP', 'Хинк. с говядиной']) {
    assert.equal(parseReviewItem(name + ', 580, 2').name, name);
    assert.equal(parseReviewItem(name + ' 580 2').name, name);
  }
  assert.equal(parseReviewItem('Подарок, 0, 2').lineTotalMinor, 0);
  assert.equal(parseReviewItem('Вес. 10. 0.125').quantity, 0.125);
});

test('invalid or ambiguous mobile input cannot silently change a price or quantity', () => {
  for (const input of [
    'Чай',
    'Чай, 580',
    'Чай, -580, 2',
    'Чай. 580. 0',
    'Чай 580 -1',
    'Чай, 580, 10001',
    'Чай, 580, 1e2',
    'Чай, 580, 0,0001',
    'Чай, 1000001, 1',
    'Чай 1 580 2',
    'Чай, 580, 2, 3',
    'Чай,580,50,2',
    'Чай.580.50.2',
    'Чай | 580 || 2',
    'Чай | 580 | 2 | 3',
    ', 580, 2',
    'a'.repeat(513)
  ]) {
    assert.throws(() => parseReviewItem(input), /INVALID_ITEM_INPUT/, input);
  }
});

async function fixture(chatId: number) {
  const store = new StateService();
  await store.initialize();
  const session = await store.createSession(1, chatId, demoReceipt());
  const sent: Array<{ text: string; options?: Parameters<BotInstance['sendMessage']>[2] }> = [];
  const shown: string[] = [];
  const bot = {
    async sendMessage(_chat: number, text: string, options?: Parameters<BotInstance['sendMessage']>[2]) {
      sent.push({ text, options });
      return { message_id: 100 + sent.length } as Message;
    },
    async answerCallbackQuery() {
      return true;
    }
  } as Pick<BotInstance, 'sendMessage' | 'answerCallbackQuery'>;
  const handlers = createReceiptReviewHandlers({
    bot,
    store,
    show: async (_chat, s) => {
      shown.push(s.id);
    },
    open: async () => {}
  });
  const from = { id: 1, is_bot: false, first_name: 'Автор' };
  const msg = { message_id: 500, date: 1, chat: { id: chatId, type: chatId > 0 ? 'private' : 'group' }, from } as Message;
  const current = () => store.getSession(session.id)!;
  const callback = (action: CallbackAction) =>
    handlers.callback({
      id: action,
      chat_instance: '',
      from,
      message: msg,
      data: encodeCallback(session.id, action, action === 'editItem' ? '0' : undefined, current().version)
    } as CallbackQuery);
  const text = (value: string, replyTo?: number, userId = 1) =>
    handlers.text({
      ...msg,
      from: { ...from, id: userId },
      text: value,
      reply_to_message: replyTo ? { ...msg, message_id: replyTo } : undefined
    });
  return { store, session, sent, shown, handlers, bot, msg, current, callback, text, flow: () => store.getFlow(chatId, 1)! };
}

test('private edit keeps waiting after multiple errors and accepts correction without Reply', async () => {
  const f = await fixture(1);
  try {
    await f.callback('editItem');
    const originalPrompt = f.flow().promptMessageId!;
    assert.match(f.sent.at(-1)!.text, /название, сумма ВСЕЙ позиции, количество/);
    for (const invalid of ['не получилось', 'Иван чай, -580, 2']) {
      assert.equal(await f.text(invalid, originalPrompt), true);
      assert.match(f.sent.at(-1)!.text, /Продолжаю ждать исправление/);
      assert.match(JSON.stringify(f.sent.at(-1)!.options), /force_reply/);
      assert.match(JSON.stringify(f.sent.at(-2)!.options), /nav:home/);
      assert.notEqual(f.flow().promptMessageId, originalPrompt);
      assert.ok(f.flow().promptMessageIds!.includes(originalPrompt));
      assert.equal(f.current().version, 1);
      assert.deepEqual(f.shown, []);
    }
    assert.equal(await f.text('Иван чай 580 2', undefined, 2), false);
    assert.equal(await f.text('Иван чай 580 2', 99999), false);
    assert.equal(await f.text('Иван чай 580 2'), true);
    assert.equal(f.current().receipt.items[0].quantity, 2);
    assert.equal(f.current().receipt.items[0].lineTotalMinor, 58000);
    assert.equal(f.current().receipt.totalMinor, f.session.receipt.totalMinor);
    assert.equal(f.current().version, 2);
    assert.equal(f.flow(), undefined);
    assert.equal(await f.text('Иван чай 580 3'), false);
    assert.deepEqual(f.shown, [f.session.id]);
  } finally {
    await f.store.close();
  }
});

test('private edits accept a plain first response; total validation also allows retries', async () => {
  const f = await fixture(1);
  try {
    await f.callback('editItem');
    assert.equal(await f.text('Иван чай. 580. 2'), true);
    await f.callback('change');
    for (const invalid of ['не сумма', '0', '-1']) {
      assert.equal(await f.text(invalid), true);
      assert.equal(f.flow().waitingFor, 'changeTotal');
      assert.match(f.sent.at(-1)!.text, /Введите только итоговую сумму/);
      assert.equal(f.current().version, 2);
    }
    assert.equal(await f.text('2840,50'), true);
    assert.equal(f.current().receipt.totalMinor, 284050);
    assert.equal(f.flow(), undefined);
  } finally {
    await f.store.close();
  }
});

test('group retries remain tied to the author and any current edit prompt, never to ordinary chat', async () => {
  const f = await fixture(-100);
  try {
    for (const replyToOriginal of [false, true]) {
      await f.callback('editItem');
      const originalPrompt = f.flow().promptMessageId!;
      await f.text('Ошибка', originalPrompt);
      const retryPrompt = f.flow().promptMessageId!;
      assert.notEqual(retryPrompt, originalPrompt);
      assert.equal(await f.text('Чай, 580, 2'), false);
      assert.equal(await f.text('Чай, 580, 2', retryPrompt, 2), false);
      assert.equal(await f.text('Чай, 580, 2', 99999), false);
      assert.equal(await f.text('Чай, 580, 2', replyToOriginal ? originalPrompt : retryPrompt), true);
      assert.equal(f.flow(), undefined);
    }
    assert.equal(f.current().receipt.items[0].quantity, 2);
    assert.equal(f.current().version, 3);
  } finally {
    await f.store.close();
  }
});

test('cancel, back and home end retries; a stale receipt cannot be overwritten', async () => {
  const f = await fixture(1);
  const navigation = createNavigationHandlers({ bot: f.bot, store: f.store, home: async () => {}, retentionHours: 24 });
  try {
    for (const exit of [
      () => navigation.text({ ...f.msg, text: '/cancel' }),
      () => navigation.callback({ id: 'home', chat_instance: '', from: f.msg.from!, message: f.msg, data: 'nav:home' }),
      () => f.callback('cancel')
    ]) {
      await f.callback('editItem');
      await f.text('Ошибка');
      const prompt = f.flow().promptMessageId!;
      await exit();
      assert.equal(f.flow(), undefined);
      assert.equal(await f.text('Чай, 580, 2', prompt), false);
      assert.equal(f.current().version, 1);
    }
    await f.callback('editItem');
    await f.text('Ошибка');
    await f.store.updateSession(f.session.id, (s) => {
      s.receipt.items[0].name = 'Другая правка';
    });
    await f.text('Чай, 580, 2');
    assert.equal(f.flow(), undefined);
    assert.equal(f.current().receipt.items[0].name, 'Другая правка');
    assert.match(f.sent.at(-1)!.text, /Чек уже изменился/);
  } finally {
    await f.store.close();
  }
});
