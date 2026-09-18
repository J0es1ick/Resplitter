import type { CallbackQuery, Message, InlineKeyboardButton } from 'node-telegram-bot-api';
import type { ReceiptSession } from '../interfaces';
import type { StateService } from '../services/state-service';
import type { BotInstance } from '../bot/bot';
import type { Screen } from '../services/bot-screen-service';
import { requireAccess, type MemberLookup } from '../services/access-service';
import { menuButton, withReceiptReturn } from '../utils/bot-navigation';
import { formatMoney } from '../utils/money';

export const CATALOG_PAGE_SIZE = 6;
type Section = 'open' | 'closed';
const code = (section: Section) => (section === 'open' ? 'o' : 'c');
export const catalogCallback = (userId: number, section: Section, page: number) =>
  `cat.${userId.toString(36)}.${code(section)}.${page.toString(36)}`;
export const receiptCallback = (userId: number, section: Section, page: number, id: string) =>
  `pick.${userId.toString(36)}.${code(section)}.${page.toString(36)}.${id}`;
const compact = (value: string) => value.replace(/\s+/g, ' ').trim();
const title = (s: ReceiptSession) => '№ ' + compact(s.receipt.receiptNumber || s.id.slice(-6)).slice(0, 24);
const date = (s: ReceiptSession) =>
  compact([s.receipt.date, s.receipt.time].filter(Boolean).join(' ')) || s.createdAt.slice(0, 16).replace('T', ' ');

export function createReceiptCatalog(deps: {
  bot: Pick<BotInstance, 'answerCallbackQuery'>;
  store: StateService;
  screen: Screen;
  lookup: MemberLookup;
  showReceipt: (chatId: number, session: ReceiptSession, messageId?: number, page?: number) => Promise<void>;
  open: (chatId: number, session: ReceiptSession, text: string, userId: number) => Promise<unknown>;
}) {
  const { bot, store, screen } = deps;
  async function visible(msg: Message): Promise<{ sessions: ReceiptSession[]; incomplete: boolean }> {
    const membership = new Map<number, ReturnType<MemberLookup>>();
    const lookup: MemberLookup = (chatId, userId) => {
      if (!membership.has(chatId)) membership.set(chatId, deps.lookup(chatId, userId));
      return membership.get(chatId)!;
    };
    const sessions: ReceiptSession[] = [];
    let incomplete = false;
    for (const session of store.listCatalogSessions(msg.from!.id, msg.chat.type === 'private' ? undefined : msg.chat.id)) {
      try {
        await requireAccess(session, msg.from!.id, lookup);
        sessions.push(session);
      } catch (error) {
        if (!(error instanceof Error) || !['SESSION_FORBIDDEN', 'MEMBERSHIP_UNAVAILABLE'].includes(error.message)) throw error;
        incomplete ||= error.message === 'MEMBERSHIP_UNAVAILABLE';
      }
    }
    return { sessions, incomplete };
  }
  async function show(msg: Message, section?: Section, requestedPage = 0): Promise<void> {
    if (!msg.from) return;
    await store.clearFlow(msg.chat.id, msg.from.id);
    const context = store.getBotUi(msg.chat.id, msg.from.id).receipt;
    const hasReceipt = !!context && !!store.getSession(context.sessionId);
    const { sessions, incomplete } = await visible(msg);
    const note = incomplete ? '\nНе удалось проверить доступ к некоторым групповым чекам. Попробуйте обновить список позже.' : '';
    const scope =
      msg.chat.type === 'private' ? '' : '\nВ группе показаны только ваши чеки из этого чата. Полный список — в личном чате с ботом.';
    if (!section) {
      const closed = sessions.filter((s) => s.status === 'finalized').length;
      await screen.show(
        msg.chat.id,
        msg.from.id,
        'Мои чеки\n\nОткрытые — черновики на проверке и незавершённые расчёты.\nЗакрытые — расчёты, завершённые владельцем; доступны только для просмотра.\n\nВыберите раздел. Чеки доступны до окончания срока хранения; истёкшие автоматически удаляются.' +
          scope +
          note,
        {
          reply_markup: withReceiptReturn(
            {
              inline_keyboard: [
                [{ text: `Открытые (${sessions.length - closed})`, callback_data: catalogCallback(msg.from.id, 'open', 0) }],
                [{ text: `Закрытые (${closed})`, callback_data: catalogCallback(msg.from.id, 'closed', 0) }],
                [menuButton]
              ]
            },
            hasReceipt
          )
        }
      );
      return;
    }
    const filtered = sessions.filter((s) => (s.status === 'finalized') === (section === 'closed'));
    const pages = Math.max(1, Math.ceil(filtered.length / CATALOG_PAGE_SIZE));
    const page = Math.max(0, Math.min(Number.isSafeInteger(requestedPage) ? requestedPage : 0, pages - 1));
    store.setBotUi(msg.chat.id, msg.from.id, { catalog: { section, page } });
    const buttons: InlineKeyboardButton[][] = filtered.slice(page * CATALOG_PAGE_SIZE, (page + 1) * CATALOG_PAGE_SIZE).map((s) => [
      {
        text: `${s.status === 'draft' ? '📝' : s.status === 'finalized' ? '✓' : '🍽'} ${title(s)} · ${date(s).slice(0, 16)} · ${formatMoney(s.receipt.totalMinor, s.receipt.currency)}`,
        callback_data: receiptCallback(msg.from!.id, section, page, s.id)
      }
    ]);
    if (pages > 1)
      buttons.push([
        ...(page > 0 ? [{ text: '← Предыдущая', callback_data: catalogCallback(msg.from.id, section, page - 1) }] : []),
        ...(page + 1 < pages ? [{ text: 'Далее →', callback_data: catalogCallback(msg.from.id, section, page + 1) }] : [])
      ]);
    buttons.push([{ text: '← Разделы чеков', callback_data: 'nav:app' }], [menuButton]);
    await screen.show(
      msg.chat.id,
      msg.from.id,
      (section === 'open' ? 'Открытые чеки' : 'Закрытые чеки') +
        '\n\n' +
        (filtered.length
          ? `Страница ${page + 1} из ${pages} · чеки ${page * CATALOG_PAGE_SIZE + 1}–${Math.min((page + 1) * CATALOG_PAGE_SIZE, filtered.length)} из ${filtered.length}\nНажмите на нужный чек.`
          : 'В этом разделе пока нет чеков.') +
        (section === 'open' ? '\n📝 — ещё на проверке; 🍽 — идёт разделение.' : '\n✓ — расчёт завершён, только просмотр.') +
        note,
      { reply_markup: withReceiptReturn({ inline_keyboard: buttons }, hasReceipt) }
    );
  }
  async function present(msg: Message, s: ReceiptSession, mode: 'app' | 'review' = 'app', page = 0): Promise<void> {
    const userId = msg.from!.id;
    if (s.status === 'draft' || (mode === 'review' && s.status !== 'finalized' && s.ownerUserId === userId)) {
      await deps.showReceipt(msg.chat.id, s, undefined, page);
      store.setBotUi(msg.chat.id, userId, { receipt: { sessionId: s.id, mode: 'review', page } });
    } else {
      await deps.open(
        msg.chat.id,
        s,
        `${title(s)}\n${date(s)}\nК оплате: ${formatMoney(s.receipt.totalMinor, s.receipt.currency)}\n\n` +
          (s.status === 'finalized'
            ? 'Закрытый чек. Расчёт завершён; позиции и итог доступны только для просмотра в Mini App.'
            : 'Открытый чек. Выберите свои позиции и количество в Mini App.'),
        userId
      );
      store.setBotUi(msg.chat.id, userId, { receipt: { sessionId: s.id, mode: 'app' } });
    }
  }
  function belongs(msg: Message, s: ReceiptSession | undefined): s is ReceiptSession {
    return (
      !!s &&
      (s.ownerUserId === msg.from!.id || !!s.participants[String(msg.from!.id)]) &&
      (msg.chat.type === 'private' || s.sourceChatId === msg.chat.id) &&
      (s.status !== 'draft' || s.ownerUserId === msg.from!.id)
    );
  }
  return {
    show,
    async resume(msg: Message): Promise<void> {
      if (!msg.from) return;
      await store.clearFlow(msg.chat.id, msg.from.id);
      const context = store.getBotUi(msg.chat.id, msg.from.id).receipt;
      const session = context && store.getSession(context.sessionId);
      let allowed = belongs(msg, session);
      if (allowed) {
        try {
          await requireAccess(session!, msg.from.id, deps.lookup);
        } catch (error) {
          if (!(error instanceof Error) || !['SESSION_FORBIDDEN', 'MEMBERSHIP_UNAVAILABLE'].includes(error.message)) throw error;
          allowed = false;
        }
      }
      if (allowed && session) {
        await present(msg, session, context!.mode, context!.page);
        return;
      }
      await screen.show(
        msg.chat.id,
        msg.from.id,
        'Текущий чек недоступен: возможно, истёк срок хранения или изменились права доступа. Откройте список чеков.',
        {
          reply_markup: { inline_keyboard: [[{ text: 'Мои чеки', callback_data: 'nav:app' }], [menuButton]] }
        }
      );
    },
    async back(msg: Message): Promise<void> {
      if (!msg.from) return;
      const last = store.getBotUi(msg.chat.id, msg.from.id).catalog;
      await show(msg, last?.section, last?.page);
    },
    async callback(query: CallbackQuery): Promise<boolean> {
      if (!/^(cat|pick)\./.test(query.data || '')) return false;
      const match = /^(cat|pick)\.([0-9a-z]{1,11})\.([oc])\.([0-9a-z]{1,7})(?:\.([A-Za-z0-9_-]{22}))?$/.exec(query.data || '');
      if (!match || (match[1] === 'pick') !== !!match[5] || parseInt(match[2], 36) !== query.from.id) {
        await bot
          .answerCallbackQuery(query.id, { text: 'Это меню другого участника или устаревшая кнопка. Откройте /app.', show_alert: true })
          .catch(() => undefined);
        return true;
      }
      await bot.answerCallbackQuery(query.id).catch(() => undefined);
      if (!query.message) return true;
      const msg = { ...query.message, from: query.from } as Message;
      await screen.adopt(msg.chat.id, query.from.id, msg.message_id, true);
      const section: Section = match[3] === 'o' ? 'open' : 'closed';
      const page = parseInt(match[4], 36);
      if (match[1] === 'cat') {
        await show(msg, section, page);
        return true;
      }
      await store.clearFlow(msg.chat.id, query.from.id);
      const s = store.getSession(match[5]);
      if (!belongs(msg, s)) {
        await show(msg, section, page);
        return true;
      }
      try {
        await requireAccess(s, query.from.id, deps.lookup);
      } catch (error) {
        if (!(error instanceof Error) || !['SESSION_FORBIDDEN', 'MEMBERSHIP_UNAVAILABLE'].includes(error.message)) throw error;
        await show(msg, section, page);
        return true;
      }
      store.setBotUi(msg.chat.id, query.from.id, { catalog: { section, page } });
      await present(msg, s);
      return true;
    }
  };
}
