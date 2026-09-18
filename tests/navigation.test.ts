import assert from 'node:assert/strict';
import test from 'node:test';
import type { CallbackQuery, Message } from 'node-telegram-bot-api';
import type { BotInstance } from '../src/bot/bot';
import { createNavigationHandlers } from '../src/handlers/navigation';
import { createReceiptReviewHandlers } from '../src/handlers/receipt-review';
import { createStartHandler } from '../src/handlers/start-handlers';
import { StateService } from '../src/services/state-service';
import { demoReceipt } from '../src/domain/demo';
import { groupHelp } from '../src/utils/bot-navigation';
import { formatReceipt } from '../src/utils/format-receipt';
import { encodeCallback, type CallbackAction } from '../src/utils/callback-data';
type SendMessageOptions = Parameters<BotInstance['sendMessage']>[2];

test('all command screens have a menu exit, cancel only the caller flow and keep receipts', async () => {
  const store = new StateService();
  await store.initialize();
  const sent: Array<{ text: string; options?: SendMessageOptions }> = [];
  const homeUsers: number[] = [];
  const bot = {
    async sendMessage(_chat: number, text: string, options?: SendMessageOptions) {
      sent.push({ text, options });
      return { message_id: sent.length } as Message;
    },
    async answerCallbackQuery() {
      return true;
    }
  } as Pick<BotInstance, 'sendMessage' | 'answerCallbackQuery'>;
  const navigation = createNavigationHandlers({
    bot,
    store,
    home: async (msg) => {
      homeUsers.push(msg.from!.id);
    },
    retentionHours: 24
  });
  const msg = { message_id: 10, date: 1, chat: { id: -100, type: 'group' }, from: { id: 1, is_bot: false, first_name: 'Один' } } as Message;
  try {
    const s = await store.createSession(1, -100, demoReceipt());
    for (const user of [1, 2]) await store.setFlow(-100, user, { sessionId: s.id, waitingFor: 'newItem' });
    for (const command of ['/info', '/group', '/privacy']) {
      assert.equal(await navigation.text({ ...msg, text: command }), true);
      assert.ok(JSON.stringify(sent.at(-1)!.options).includes('nav:home'));
    }
    assert.equal(store.getFlow(-100, 1), undefined);
    assert.ok(store.getFlow(-100, 2));
    assert.equal(await navigation.text({ ...msg, text: '/cancel' }), true);
    assert.equal(await navigation.text({ ...msg, text: '/back@test_bot' }), true);
    assert.equal(
      await navigation.callback({
        id: '1',
        from: { id: 2, is_bot: false, first_name: 'Два' },
        message: msg,
        chat_instance: '',
        data: 'nav:home'
      } as CallbackQuery),
      true
    );
    assert.deepEqual(homeUsers, [1, 1, 2]);
    assert.equal(store.getFlow(-100, 2), undefined);
    assert.ok(store.getSession(s.id));
    assert.equal(await navigation.text({ ...msg, text: 'не команда' }), false);
    assert.ok(groupHelp.length < 4096);
    assert.match(groupHelp, /своего Telegram-аккаунта/);
    assert.match(groupHelp, /2, другой — 1/);
  } finally {
    await store.close();
  }
});

test('currency, item pages and input prompts always offer a way back', async () => {
  const store = new StateService();
  await store.initialize();
  const sent: Array<{ text: string; options?: SendMessageOptions }> = [];
  const bot = {
    async sendMessage(_chat: number, text: string, options?: SendMessageOptions) {
      sent.push({ text, options });
      return { message_id: sent.length } as Message;
    },
    async answerCallbackQuery() {
      return true;
    }
  } as Pick<BotInstance, 'sendMessage' | 'answerCallbackQuery'>;
  const handlers = createReceiptReviewHandlers({ bot, store, show: async () => {}, open: async () => {} });
  try {
    const receipt = demoReceipt();
    receipt.items = Array.from({ length: 22 }, (_, index) => ({ ...receipt.items[0], id: 'i' + index }));
    receipt.subtotalMinor = receipt.totalMinor = receipt.items.reduce((sum, i) => sum + i.lineTotalMinor, 0);
    const s = await store.createSession(1, -100, receipt);
    for (const action of ['editMenu', 'currency', 'edit', 'remove', 'add', 'change', 'editItem'] as CallbackAction[]) {
      const previousCount = sent.length;
      await handlers.callback({
        id: '1',
        from: { id: 1, is_bot: false, first_name: 'Один' },
        chat_instance: '',
        message: { message_id: 10, date: 1, chat: { id: -100, type: 'group' } },
        data: encodeCallback(s.id, action, action === 'editItem' ? '0' : undefined, s.version)
      } as CallbackQuery);
      assert.ok(
        sent.slice(previousCount).some((message) => JSON.stringify(message.options).includes('nav:home')),
        action
      );
    }
    const prompt = store.getFlow(-100, 1)!.promptMessageId!;
    assert.ok(JSON.stringify(sent[prompt - 1].options).includes('force_reply'));
    assert.match(formatReceipt(receipt), /Страница 1 из 4 · позиции 1–6 из 22/);
    assert.match(formatReceipt(receipt), /Это часть чека/);
    assert.match(formatReceipt(receipt, 3), /Страница 4 из 4 · позиции 19–22 из 22/);
    assert.match(formatReceipt(receipt, 3), /за ВЕСЬ чек/);
  } finally {
    await store.close();
  }
});

test('home, start and cancel show only the main menu; receipts open only on explicit request', async () => {
  const store = new StateService();
  await store.initialize();
  const sent: Array<{ text: string; options?: SendMessageOptions }> = [];
  const shown: string[] = [];
  const opened: Array<string | undefined> = [];
  let catalogOpened = 0;
  const bot = {
    async sendMessage(_chat: number, text: string, options?: SendMessageOptions) {
      sent.push({ text, options });
      return { message_id: sent.length } as Message;
    },
    async answerCallbackQuery() {
      return true;
    },
    async getChatMember() {
      throw new Error('Unexpected network call');
    }
  } as Pick<BotInstance, 'sendMessage' | 'answerCallbackQuery' | 'getChatMember'>;
  const home = createStartHandler({
    bot,
    store,
    demoEnabled: true,
    catalog: async () => {
      catalogOpened++;
    },
    show: async (_chat, session) => {
      shown.push(session.id);
    },
    open: async (_chat, session) => {
      opened.push(session?.id);
    }
  });
  const navigation = createNavigationHandlers({ bot, store, home, retentionHours: 24 });
  const msg = { message_id: 10, date: 1, chat: { id: 1, type: 'private' }, from: { id: 1, is_bot: false, first_name: 'Автор' } } as Message;
  const callback = (action: string) =>
    navigation.callback({
      id: action,
      from: msg.from!,
      chat_instance: '',
      message: { ...msg, from: { id: 999, is_bot: true, first_name: 'Бот' } },
      data: 'nav:' + action
    } as CallbackQuery);
  try {
    const s = await store.createSession(1, 1, demoReceipt());
    await store.createSession(2, 2, demoReceipt());
    for (const enterHome of [
      () => home({ ...msg, text: '/start' }),
      () => callback('home'),
      () => navigation.text({ ...msg, text: '/cancel' }),
      () => navigation.text({ ...msg, text: '/back' })
    ]) {
      await store.setFlow(1, 1, { sessionId: s.id, waitingFor: 'newItem' });
      const count = sent.length;
      await enterHome();
      assert.equal(sent.length, count + 1, 'no receipt or extra exit message');
      assert.match(sent.at(-1)!.text, /^Главное меню/);
      assert.match(JSON.stringify(sent.at(-1)!.options), /Мои чеки/);
      assert.doesNotMatch(JSON.stringify(sent.at(-1)!.options), /nav:home/);
      assert.equal(store.getFlow(1, 1), undefined);
      assert.equal(store.getSession(s.id)!.version, 1);
      assert.deepEqual(shown, []);
      assert.deepEqual(opened, []);
    }
    await callback('app');
    assert.equal(catalogOpened, 1);
    assert.deepEqual(shown, []);
    assert.deepEqual(opened, []);
    await home({ ...msg, text: '/start review_' + s.id });
    assert.deepEqual(shown, [s.id], 'explicit receipt links still work');
    assert.deepEqual(opened, [], 'draft cannot bypass confirmation');
  } finally {
    await store.close();
  }
});
