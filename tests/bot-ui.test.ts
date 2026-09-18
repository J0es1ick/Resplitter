import assert from 'node:assert/strict';
import test from 'node:test';
import type { CallbackQuery, Message } from 'node-telegram-bot-api';
import type { BotInstance } from '../src/bot/bot';
import { BotScreenService, type ScreenOptions } from '../src/services/bot-screen-service';
import { StateService } from '../src/services/state-service';
import { createReceiptCatalog, catalogCallback, receiptCallback, CATALOG_PAGE_SIZE } from '../src/handlers/receipt-catalog';
import { createStartHandler } from '../src/handlers/start-handlers';
import { createNavigationHandlers } from '../src/handlers/navigation';
import { createReceiptReviewHandlers } from '../src/handlers/receipt-review';
import { demoReceipt } from '../src/domain/demo';
import type { ReceiptSession } from '../src/interfaces';
import { reviewKeyboard } from '../src/utils/send-receipt-with-actions';
import { encodeCallback } from '../src/utils/callback-data';
import { receiptsButton } from '../src/utils/bot-navigation';
import { createMiniAppSender } from '../src/utils/mini-app';

function fakeTelegram() {
  const messages = new Map<number, { text: string; options: Parameters<BotInstance['sendMessage']>[2]; chatId: number }>();
  const edits: number[] = [];
  const disabled: number[] = [];
  const alerts: string[] = [];
  let next = 100;
  let editError: Error | undefined;
  let member = 'member';
  let lookups = 0;
  const bot = {
    async sendMessage(chatId: number, text: string, options?: Parameters<BotInstance['sendMessage']>[2]) {
      messages.set(++next, { chatId, text, options });
      return { message_id: next } as Message;
    },
    async editMessageText(text: string, options: ScreenOptions & { chat_id: number; message_id: number }) {
      edits.push(options.message_id);
      if (editError) throw editError;
      if (!messages.has(options.message_id)) throw new Error('Bad Request: message to edit not found');
      messages.set(options.message_id, { text, chatId: options.chat_id, options });
      return { message_id: options.message_id } as Message;
    },
    async editMessageReplyMarkup(reply_markup: ScreenOptions['reply_markup'], options: { chat_id: number; message_id: number }) {
      const message = messages.get(options.message_id);
      if (!message) throw new Error('Bad Request: message to edit not found');
      disabled.push(options.message_id);
      message.options = { ...message.options, reply_markup };
      return { message_id: options.message_id } as Message;
    },
    async answerCallbackQuery(_id: string, options?: { text?: string }) {
      if (options?.text) alerts.push(options.text);
      return true;
    },
    async getChatMember() {
      lookups++;
      if (member === 'unavailable') throw new Error('Network');
      return { status: member };
    }
  } as unknown as Pick<BotInstance, 'sendMessage' | 'editMessageText' | 'editMessageReplyMarkup' | 'answerCallbackQuery' | 'getChatMember'>;
  return {
    bot,
    messages,
    edits,
    disabled,
    alerts,
    get sends() {
      return next - 100;
    },
    get lookups() {
      return lookups;
    },
    setEditError: (error?: Error) => {
      editError = error;
    },
    setMember: (status: string) => {
      member = status;
    }
  };
}

async function fixture(chatId = 1, store = new StateService()) {
  await store.initialize();
  const telegram = fakeTelegram();
  const screen = new BotScreenService(telegram.bot, store);
  const shown: string[] = [],
    opened: Array<{ session: ReceiptSession; userId: number }> = [];
  const msg = {
    message_id: 1,
    date: 1,
    chat: { id: chatId, type: chatId > 0 ? 'private' : 'group' },
    from: { id: 1, is_bot: false, first_name: 'Автор' }
  } as Message;
  const showReceipt = async (_chat: number, s: ReceiptSession, _messageId?: number, page = 0) => {
    shown.push(s.id);
    await screen.show(chatId, s.ownerUserId, 'Проверка чека ' + s.receipt.receiptNumber, { reply_markup: reviewKeyboard(s) });
    store.setBotUi(chatId, s.ownerUserId, { receipt: { sessionId: s.id, mode: 'review', page } });
  };
  const miniApp = createMiniAppSender({ screen, store, url: 'https://receipts.example', username: () => 'test_bot' });
  const open = async (_chat: number, s: ReceiptSession, text: string, userId: number) => {
    opened.push({ session: s, userId });
    await miniApp(chatId, s, text, userId);
  };
  const catalog = createReceiptCatalog({ bot: telegram.bot, store, screen, lookup: telegram.bot.getChatMember, showReceipt, open });
  const current = () => telegram.messages.get(store.getBotUi(chatId, 1).messageId!)!;
  const buttons = () =>
    (current().options?.reply_markup as { inline_keyboard: { text: string; callback_data: string }[][] }).inline_keyboard.flat();
  const callback = (data: string, userId = 1): CallbackQuery => ({
    id: 'cb',
    from: { ...msg.from!, id: userId },
    chat_instance: '',
    message: { ...msg, message_id: store.getBotUi(chatId, 1).messageId! },
    data
  });
  const add = async (number: string, status: ReceiptSession['status'] = 'draft', ownerId = 1, source = chatId) => {
    const s = await store.createSession(ownerId, source, { ...demoReceipt(), receiptNumber: number });
    return status === 'draft'
      ? s
      : store.updateSession(s.id, (draft) => {
          draft.status = status;
        });
  };
  return { store, screen, telegram, msg, catalog, current, buttons, callback, add, shown, opened, showReceipt, open };
}

test('confirmation screen can be restored from help, nested group help, privacy, home and catalog without mutating the receipt', async () => {
  const f = await fixture();
  try {
    const s = await f.add('Return flow');
    const home = createStartHandler({
      bot: f.telegram.bot,
      store: f.store,
      screen: f.screen,
      catalog: f.catalog.show,
      demoEnabled: true,
      show: f.showReceipt,
      open: async () => {}
    });
    const nav = createNavigationHandlers({
      bot: f.telegram.bot,
      store: f.store,
      screen: f.screen,
      home,
      retentionHours: 24,
      receiptsBack: f.catalog.back,
      currentReceipt: f.catalog.resume
    });
    const review = createReceiptReviewHandlers({
      bot: f.telegram.bot,
      store: f.store,
      screen: f.screen,
      show: f.showReceipt,
      open: (chat, session) => f.open(chat, session, 'Чек подтверждён', 1)
    });
    await f.showReceipt(1, s);
    await review.callback(f.callback(encodeCallback(s.id, 'confirm', undefined, s.version)));
    const confirmed = f.store.getSession(s.id)!;
    assert.equal(confirmed.status, 'open');
    assert.equal(f.store.getBotUi(1, 1).receipt!.mode, 'app');
    for (const action of ['info', 'group', 'privacy', 'home', 'app', 'receipts']) {
      await nav.callback(f.callback('nav:' + action));
      assert.ok(
        f.buttons().some((b) => b.callback_data === 'nav:current'),
        action
      );
      if (action === 'info') {
        await nav.callback(f.callback('nav:group'));
        assert.ok(f.buttons().some((b) => b.callback_data === 'nav:current'));
      }
      await nav.callback(f.callback('nav:current'));
      assert.match(JSON.stringify(f.current().options), new RegExp('session=' + s.id));
      assert.match(JSON.stringify(f.current().options), /web_app/);
      assert.deepEqual(f.store.getSession(s.id), confirmed);
    }
    assert.equal(f.telegram.sends, 1);
    const freshNavigation = createNavigationHandlers({
      bot: f.telegram.bot,
      store: f.store,
      screen: f.screen,
      home,
      retentionHours: 24,
      currentReceipt: f.catalog.resume
    });
    await freshNavigation.callback(f.callback('nav:privacy'));
    await freshNavigation.callback(f.callback('nav:current'));
    assert.match(JSON.stringify(f.current().options), new RegExp('session=' + s.id));
    await f.store.updateSession(s.id, (session) => {
      session.status = 'finalized';
    });
    await nav.callback(f.callback('nav:info'));
    await nav.callback(f.callback('nav:current'));
    assert.match(f.current().text, /Закрытый чек/);
    assert.match(JSON.stringify(f.current().options), /Посмотреть итог/);
  } finally {
    await f.store.close();
  }
});

test('return to current receipt rechecks membership, expiry and per-user context', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const f = await fixture(1, new StateService(undefined, 1000));
  try {
    const s = await f.add('Shared receipt', 'open', 2, -100);
    await f.store.join(s.id, 1, 'Автор');
    await f.catalog.show(f.msg);
    await f.catalog.callback(f.callback(receiptCallback(1, 'open', 0, s.id)));
    const opens = f.opened.length;
    assert.equal(f.store.getBotUi(1, 2).receipt, undefined);
    f.telegram.setMember('left');
    await f.catalog.resume(f.msg);
    assert.match(f.current().text, /Текущий чек недоступен/);
    assert.equal(f.opened.length, opens);
    assert.doesNotMatch(JSON.stringify(f.current().options), /web_app/);
    f.telegram.setMember('member');
    await f.catalog.resume(f.msg);
    assert.equal(f.opened.length, opens + 1);
    t.mock.timers.tick(1001);
    await f.catalog.resume(f.msg);
    assert.match(f.current().text, /Текущий чек недоступен/);
    assert.equal(f.opened.length, opens + 1);
  } finally {
    await f.store.close();
  }
});

test('receipt catalog separates drafts/open from finalized and opens exactly the selected receipt', async () => {
  const f = await fixture();
  try {
    const draft = await f.add('draft');
    const open = await f.add('open', 'open');
    const closed = await f.add('closed', 'finalized');
    await f.add('foreign', 'draft', 2, 2);
    await f.catalog.show(f.msg);
    assert.deepEqual(f.shown, []);
    assert.equal(f.opened.length, 0);
    assert.match(f.current().text, /Открытые — черновики/);
    assert.ok(f.buttons().some((b) => b.text === 'Открытые (2)'));
    assert.ok(f.buttons().some((b) => b.text === 'Закрытые (1)'));
    await f.catalog.callback(f.callback(catalogCallback(1, 'open', 0)));
    assert.equal(f.buttons().filter((b) => b.callback_data.startsWith('pick.')).length, 2);
    await f.catalog.callback(f.callback(receiptCallback(1, 'open', 0, draft.id)));
    assert.deepEqual(f.shown, [draft.id]);
    assert.equal(f.opened.length, 0);
    await f.catalog.back(f.msg);
    assert.match(f.current().text, /^Открытые чеки/);
    await f.catalog.callback(f.callback(receiptCallback(1, 'open', 0, open.id)));
    assert.equal(f.opened.at(-1)!.session.id, open.id);
    assert.equal(f.opened.at(-1)!.userId, 1);
    assert.equal(f.store.getSession(open.id)!.version, open.version, 'view does not mutate receipt');
    await f.catalog.callback(f.callback(catalogCallback(1, 'closed', 0)));
    assert.equal(f.buttons().filter((b) => b.callback_data.startsWith('pick.')).length, 1);
    await f.catalog.callback(f.callback(receiptCallback(1, 'closed', 0, closed.id)));
    assert.match(f.current().text, /Закрытый чек.*только для просмотра/);
    assert.equal(f.opened.at(-1)!.session.status, 'finalized');
    assert.equal(f.store.getSession(closed.id)!.version, closed.version);
    assert.equal(f.telegram.sends, 1, 'all navigation edits one message');
  } finally {
    await f.store.close();
  }
});

test('catalog paginates beyond 50 receipts without duplication and remembers the selected page', async () => {
  const f = await fixture();
  try {
    const ids = new Set<string>();
    for (let i = 0; i < 61; i++) ids.add((await f.add('receipt-' + i)).id);
    const seen = new Set<string>();
    for (let page = 0; page < Math.ceil(ids.size / CATALOG_PAGE_SIZE); page++) {
      await f.catalog.show(f.msg, 'open', page);
      assert.match(f.current().text, new RegExp(`Страница ${page + 1} из 11`));
      const picks = f.buttons().filter((b) => b.callback_data.startsWith('pick.'));
      assert.equal(picks.length, page < 10 ? 6 : 1);
      for (const button of picks) {
        const id = button.callback_data.split('.').at(-1)!;
        assert.ok(!seen.has(id));
        seen.add(id);
        assert.ok(Buffer.byteLength(button.callback_data) <= 64);
      }
    }
    assert.deepEqual(seen, ids);
    await f.catalog.callback(f.callback(f.buttons().find((b) => b.callback_data.startsWith('pick.'))!.callback_data));
    await f.catalog.back(f.msg);
    assert.match(f.current().text, /Страница 11 из 11/);
    await f.catalog.show(f.msg, 'open', 9999);
    assert.match(f.current().text, /Страница 11 из 11/);
    assert.equal(f.telegram.sends, 1);
  } finally {
    await f.store.close();
  }
});

test('catalog buttons cannot expose another user receipt or overwrite their group screen', async () => {
  const f = await fixture(-100);
  try {
    const own = await f.add('Group own');
    const privateReceipt = await f.add('PRIVATE SECRET', 'open', 1, 1);
    const foreign = await f.add('FOREIGN SECRET', 'open', 2, 2);
    const joined = await f.add('Joined group', 'open', 2, -100);
    await f.store.join(joined.id, 1, 'Автор');
    await f.catalog.show(f.msg, 'open');
    const original = JSON.stringify(f.current());
    assert.doesNotMatch(original, /PRIVATE SECRET|FOREIGN SECRET/);
    assert.equal(f.buttons().filter((b) => b.callback_data.startsWith('pick.')).length, 2);
    await f.catalog.callback(f.callback(receiptCallback(1, 'open', 0, own.id), 2));
    assert.deepEqual(f.shown, []);
    assert.equal(JSON.stringify(f.current()), original);
    assert.match(f.telegram.alerts.at(-1)!, /другого участника/);
    for (const id of [privateReceipt.id, foreign.id]) await f.catalog.callback(f.callback(receiptCallback(1, 'open', 0, id)));
    assert.equal(f.opened.length, 0);
    await f.catalog.callback(f.callback(receiptCallback(1, 'open', 0, joined.id)));
    assert.equal(f.opened.at(-1)!.userId, 1);
    assert.equal(f.store.getBotUi(-100, 2).messageId, undefined, 'participant navigation never uses owner screen');
  } finally {
    await f.store.close();
  }
});

test('group membership is checked again for listing and selecting; lookup failures fail closed', async () => {
  const f = await fixture();
  try {
    const sessions = [await f.add('A', 'open', 2, -100), await f.add('B', 'open', 2, -100)];
    for (const s of sessions) await f.store.join(s.id, 1, 'Автор');
    await f.catalog.show(f.msg, 'open');
    assert.equal(f.telegram.lookups, 1, 'one membership request per group per page');
    f.telegram.setMember('left');
    await f.catalog.callback(f.callback(receiptCallback(1, 'open', 0, sessions[0].id)));
    assert.equal(f.opened.length, 0);
    assert.match(f.current().text, /пока нет чеков/);
    f.telegram.setMember('unavailable');
    await f.catalog.show(f.msg);
    assert.match(f.current().text, /Не удалось проверить доступ/);
    assert.ok(f.buttons().some((b) => b.text === 'Открытые (0)'));
  } finally {
    await f.store.close();
  }
});

test('empty, expired and moved catalog pages recover without dead ends', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const f = await fixture(1, new StateService(undefined, 1000));
  try {
    await f.catalog.show(f.msg, 'closed');
    assert.match(f.current().text, /пока нет чеков/);
    assert.ok(f.buttons().some((b) => b.callback_data === 'nav:app'));
    for (let i = 0; i < 7; i++) await f.add(String(i));
    await f.catalog.show(f.msg, 'open', 1);
    const selected = f.buttons().find((b) => b.callback_data.startsWith('pick.'))!.callback_data;
    const id = selected.split('.').at(-1)!;
    await f.store.updateSession(id, (s) => {
      s.status = 'finalized';
    });
    await f.catalog.back(f.msg);
    assert.match(f.current().text, /Страница 1 из 1/);
    const expiredCallback = f.callback(selected);
    t.mock.timers.tick(1001);
    await f.catalog.callback(expiredCallback);
    assert.match(f.current().text, /пока нет чеков/);
    assert.deepEqual(f.shown, []);
    assert.deepEqual(f.opened, []);
  } finally {
    await f.store.close();
  }
});

test('home, help, catalog, review, editor and cancel share one active screen', async () => {
  const f = await fixture();
  try {
    const s = await f.add('Full flow');
    const home = createStartHandler({
      bot: f.telegram.bot,
      store: f.store,
      screen: f.screen,
      catalog: f.catalog.show,
      demoEnabled: true,
      show: f.showReceipt,
      open: async () => {}
    });
    const nav = createNavigationHandlers({
      bot: f.telegram.bot,
      store: f.store,
      screen: f.screen,
      home,
      retentionHours: 24,
      receiptsBack: f.catalog.back
    });
    const review = createReceiptReviewHandlers({
      bot: f.telegram.bot,
      store: f.store,
      screen: f.screen,
      show: f.showReceipt,
      open: async () => {}
    });
    await home({ ...f.msg, text: '/start' });
    const screenId = f.store.getBotUi(1, 1).messageId;
    await nav.callback(f.callback('nav:info'));
    await nav.callback(f.callback('nav:home'));
    await nav.callback(f.callback('nav:app'));
    await f.catalog.callback(f.callback(catalogCallback(1, 'open', 0)));
    await f.catalog.callback(f.callback(receiptCallback(1, 'open', 0, s.id)));
    await review.callback(f.callback(encodeCallback(s.id, 'editMenu', undefined, s.version)));
    await review.callback(f.callback(encodeCallback(s.id, 'editItem', '0', s.version)));
    assert.equal(f.telegram.sends, 2, 'one screen plus a separate ForceReply input request');
    assert.match(JSON.stringify(f.current().options), /отменить ввод/);
    await review.text({ ...f.msg, text: 'Некорректно' });
    assert.equal(f.telegram.sends, 3, 'retry sends a prompt, not another keyboard');
    await review.text({ ...f.msg, text: 'Чай, 580, 2' });
    await nav.callback(f.callback('nav:receipts'));
    assert.match(f.current().text, /Страница 1 из 1/);
    await nav.text({ ...f.msg, text: '/cancel' });
    assert.match(f.current().text, /^Главное меню/);
    assert.equal(f.store.getBotUi(1, 1).messageId, screenId);
    assert.equal(f.store.getFlow(1, 1), undefined);
    const activeKeyboards = [...f.telegram.messages.values()].filter(
      (m) => m.options?.reply_markup && 'inline_keyboard' in m.options.reply_markup && m.options.reply_markup.inline_keyboard.length
    );
    assert.equal(activeKeyboards.length, 1);
    assert.equal(f.store.getSession(s.id)!.receipt.items[0].quantity, 2);
  } finally {
    await f.store.close();
  }
});

test('screen adopts old private messages and disables old keyboards without deleting chat history', async () => {
  const f = await fixture();
  try {
    const old = await f.telegram.bot.sendMessage(1, 'Старое меню', { reply_markup: { inline_keyboard: [[receiptsButton]] } });
    await f.screen.adopt(1, 1, old.message_id);
    await f.screen.show(1, 1, 'Новое меню');
    assert.equal(f.telegram.sends, 1);
    const another = await f.telegram.bot.sendMessage(1, 'Ещё старое меню', { reply_markup: { inline_keyboard: [[receiptsButton]] } });
    await f.screen.adopt(1, 1, another.message_id);
    assert.deepEqual(f.telegram.disabled, [another.message_id]);
    assert.equal(f.telegram.messages.get(another.message_id)!.text, 'Ещё старое меню');
    assert.equal(f.store.getBotUi(1, 1).messageId, old.message_id);
  } finally {
    await f.store.close();
  }
});

test('missing or uneditable screen gets a replacement; unchanged/network errors do not duplicate it', async () => {
  const f = await fixture();
  try {
    const first = await f.screen.show(1, 1, 'Первое');
    f.telegram.setEditError(new Error('Bad Request: message is not modified'));
    await f.screen.show(1, 1, 'Первое');
    assert.equal(f.telegram.sends, 1);
    f.telegram.setEditError(new Error('ETIMEDOUT'));
    await assert.rejects(f.screen.show(1, 1, 'Второе'), /ETIMEDOUT/);
    assert.equal(f.telegram.sends, 1);
    f.telegram.setEditError(new Error("Bad Request: message can't be edited"));
    const second = await f.screen.show(1, 1, 'Замена');
    assert.deepEqual(f.telegram.disabled, [first.message_id]);
    assert.notEqual(second.message_id, first.message_id);
    f.telegram.setEditError();
    f.telegram.messages.delete(second.message_id);
    const third = await f.screen.show(1, 1, 'Восстановлено');
    assert.notEqual(third.message_id, second.message_id);
    assert.equal(f.store.getBotUi(1, 1).messageId, third.message_id);
  } finally {
    await f.store.close();
  }
});

test('group screens and catalog cursors remain isolated per participant', async () => {
  const f = await fixture(-100);
  try {
    const one = await f.screen.show(-100, 1, 'Первый');
    f.store.setBotUi(-100, 1, { catalog: { section: 'open', page: 3 } });
    await f.screen.adopt(-100, 2, one.message_id, true);
    const two = await f.screen.show(-100, 2, 'Второй');
    await f.screen.adopt(-100, 2, one.message_id, true);
    assert.notEqual(one.message_id, two.message_id);
    assert.equal(f.telegram.messages.get(one.message_id)!.text, 'Первый');
    assert.deepEqual(f.telegram.disabled, []);
    assert.equal(f.store.getBotUi(-100, 2).catalog, undefined);
    const afterRestart = new BotScreenService(f.telegram.bot, f.store);
    await afterRestart.show(-100, 1, 'Первый после перезапуска');
    assert.equal(f.telegram.sends, 2);
    assert.deepEqual(f.store.getBotUi(-100, 1).catalog, { section: 'open', page: 3 });
  } finally {
    await f.store.close();
  }
});
