import type { CallbackQuery, Message } from 'node-telegram-bot-api';
import type { BotInstance } from '../bot/bot';
import type { ReceiptSession, UserFlow } from '../interfaces';
import type { StateService } from '../services/state-service';
import { parseReviewItem, ReceiptReviewService } from '../services/receipt-review-service';
import { decodeCallback } from '../utils/callback-data';
import { editKeyboard, reviewButton } from '../utils/send-receipt-with-actions';
import { currencies, currencyLabels, type Currency } from '../domain/currency';
import { parseMoneyToMinor } from '../utils/money';
import { backKeyboard, menuButton } from '../utils/bot-navigation';
import type { Screen, ScreenOptions } from '../services/bot-screen-service';

interface Dependencies {
  bot: Pick<BotInstance, 'sendMessage' | 'answerCallbackQuery'>;
  store: StateService;
  show: (chatId: number, session: ReceiptSession, messageId?: number, page?: number) => Promise<void>;
  open: (chatId: number, session: ReceiptSession) => Promise<unknown>;
  screen?: Screen;
}
const errors: Record<string, string> = {
  SESSION_FORBIDDEN: 'Только автор чека может его исправить или подтвердить.',
  SESSION_CONFLICT: 'Чек уже изменился. Откройте актуальную версию и повторите действие.',
  SESSION_FINALIZED: 'Расчёт завершён: изменять чек нельзя.',
  EMPTY_RECEIPT: 'Добавьте хотя бы одну позицию и положительный итог.',
  ITEM_NOT_FOUND: 'Позиция больше не существует. Выберите её заново.',
  INVALID_ITEM_INPUT:
    'Не удалось принять правку. Напишите: Иван чай, 580, 2\nПорядок: название, сумма ВСЕЙ позиции, количество. Можно также: Иван чай. 580. 2 или Иван чай 580 2.\nДробные значения: Чай, 580,50, 1,5 (после разделителей ставьте пробел). Сумма — от 0 до 1 000 000, количество — больше 0, до 10 000 и до 3 знаков после запятой.',
  INVALID_TOTAL: 'Введите только итоговую сумму, например 2840,50 (больше нуля, не более 1 000 000).'
};
export function createReceiptReviewHandlers({ bot, store, show, open, screen }: Dependencies) {
  const service = new ReceiptReviewService(store);
  const send = (chatId: number, userId: number, text: string, options: ScreenOptions) =>
    screen ? screen.show(chatId, userId, text, options) : bot.sendMessage(chatId, text, options);
  async function requestInput(
    chatId: number,
    user: CallbackQuery['from'],
    session: ReceiptSession,
    flow: Omit<UserFlow, 'updatedAt'>,
    promptText: string
  ) {
    await send(chatId, user.id, 'Ожидаю правки. Чтобы выйти без сохранения, используйте кнопки ниже или /cancel.', {
      reply_markup: { inline_keyboard: [[reviewButton(session, '← Назад к чеку / отменить ввод', 'cancel')], [menuButton]] }
    });
    const recipient = user.first_name.slice(0, 120);
    const prompt = await bot.sendMessage(chatId, recipient + ', ' + promptText, {
      entities: [{ type: 'text_mention', offset: 0, length: recipient.length, user }],
      reply_markup: { force_reply: true, selective: true }
    });
    const previous = flow.promptMessageIds || (flow.promptMessageId ? [flow.promptMessageId] : []);
    await store.setFlow(chatId, user.id, {
      ...flow,
      promptMessageId: prompt.message_id,
      promptMessageIds: [...new Set([...previous, prompt.message_id])].slice(-8)
    });
  }
  async function report(chatId: number, userId: number, id: string, error: unknown) {
    const code = error instanceof Error ? error.message : '';
    if (!errors[code]) throw error;
    const latest = store.getSession(id);
    await send(chatId, userId, errors[code], {
      reply_markup:
        latest && code === 'SESSION_CONFLICT'
          ? { inline_keyboard: [[reviewButton(latest, 'Открыть актуальный чек', 'back')], [menuButton]] }
          : backKeyboard
    });
    if (!screen && latest && code === 'SESSION_CONFLICT') await show(chatId, latest);
  }
  return {
    async callback(query: CallbackQuery): Promise<void> {
      const data = query.data ? decodeCallback(query.data) : undefined;
      await bot.answerCallbackQuery(query.id).catch(() => undefined);
      if (!query.message || !data) return;
      const chatId = query.message.chat.id;
      const s = store.getSession(data.sessionId);
      if (!s) {
        await send(chatId, query.from.id, 'Чек истёк. Отправьте фото заново.', { reply_markup: backKeyboard });
        return;
      }
      try {
        if (s.ownerUserId !== query.from.id) throw new Error('SESSION_FORBIDDEN');
        if (chatId !== s.sourceChatId && chatId !== s.ownerUserId) throw new Error('SESSION_FORBIDDEN');
        if (s.id !== data.sessionId) throw new Error('SESSION_CONFLICT');
        await screen?.adopt(chatId, query.from.id, query.message.message_id, true);
        if (s.status === 'finalized') throw new Error('SESSION_FINALIZED');
        if (data.version !== s.version) throw new Error('SESSION_CONFLICT');
        const action = data.action;
        const value = data.value || '';
        if (action === 'confirm') {
          const confirmed = s.status === 'draft' ? await service.confirm(s.id, query.from.id, s.version) : s;
          await store.clearFlow(chatId, query.from.id);
          await open(chatId, confirmed);
        } else if (action === 'back' || action === 'page' || action === 'cancel') {
          await store.clearFlow(chatId, query.from.id);
          await show(chatId, s, query.message.message_id, /^\d+$/.test(value) ? Number(value) : 0);
        } else if (action === 'editMenu') {
          await store.clearFlow(chatId, query.from.id);
          await send(chatId, query.from.id, 'Что исправим? После правок нужно снова подтвердить чек. Выбор участников сбросится.', {
            reply_markup: editKeyboard(s)
          });
        } else if (action === 'edit' || action === 'remove') {
          const page = /^\d+$/.test(value) ? Math.min(12, Number(value)) : 0;
          const buttons = s.receipt.items
            .slice(page * 8, page * 8 + 8)
            .map((item, index) => [
              reviewButton(
                s,
                page * 8 + index + 1 + '. ' + item.name.slice(0, 45),
                action === 'edit' ? 'editItem' : 'removeItem',
                (page * 8 + index).toString(36)
              )
            ]);
          if (page > 0 || (page + 1) * 8 < s.receipt.items.length)
            buttons.push([
              ...(page > 0 ? [reviewButton(s, '←', action, page - 1)] : []),
              ...((page + 1) * 8 < s.receipt.items.length ? [reviewButton(s, 'Далее →', action, page + 1)] : [])
            ]);
          buttons.push([reviewButton(s, '← Назад', 'editMenu')], [menuButton]);
          await send(
            chatId,
            query.from.id,
            'Выберите позицию. Страница ' +
              (page + 1) +
              ' из ' +
              Math.max(1, Math.ceil(s.receipt.items.length / 8)) +
              '. Всего позиций: ' +
              s.receipt.items.length +
              '.\nЕсли нужной позиции нет здесь — нажмите «Далее».',
            { reply_markup: { inline_keyboard: buttons } }
          );
        } else if (action === 'currency') {
          if (currencies.includes(value as Currency)) {
            const changed = await service.revise(s.id, query.from.id, s.version, (r) => {
              r.currency = value as Currency;
            });
            await show(chatId, changed);
          } else
            await send(chatId, query.from.id, 'Валюта чека (без пересчёта сумм):', {
              reply_markup: {
                inline_keyboard: [
                  ...currencies.map((c) => [reviewButton(s, c + ' · ' + currencyLabels[c], 'currency', c)]),
                  [reviewButton(s, '← Назад', 'editMenu')],
                  [menuButton]
                ]
              }
            });
        } else if (['editItem', 'removeItem', 'deleteItem', 'add', 'change'].includes(action)) {
          const index = /^[0-9a-z]+$/.test(value) ? parseInt(value, 36) : -1;
          const item = s.receipt.items[index];
          if (['editItem', 'removeItem', 'deleteItem'].includes(action) && !item) throw new Error('ITEM_NOT_FOUND');
          if (action === 'removeItem') {
            await send(chatId, query.from.id, 'Удалить «' + item.name + '»? Итог по чеку останется прежним.', {
              reply_markup: { inline_keyboard: [[reviewButton(s, 'Да, удалить', 'deleteItem', value), reviewButton(s, 'Отмена', 'back')]] }
            });
          } else if (action === 'deleteItem') {
            const changed = await service.revise(s.id, query.from.id, s.version, (r) => {
              r.items = r.items.filter((i) => i.id !== item.id);
            });
            await store.clearFlow(chatId, query.from.id);
            await show(chatId, changed);
          } else {
            if (action === 'add' && s.receipt.items.length >= 100) {
              await send(chatId, query.from.id, 'В чеке уже 100 позиций.', {
                reply_markup: { inline_keyboard: [[reviewButton(s, '← Назад', 'editMenu')], [menuButton]] }
              });
              return;
            }
            const promptText =
              action === 'change'
                ? 'Ответьте на это сообщение новой итоговой суммой (без валюты). /cancel — отмена.'
                : 'Введите: название, сумма ВСЕЙ позиции, количество\n' +
                  (item
                    ? item.name +
                      ', ' +
                      (item.lineTotalMinor / 100).toFixed(2).replace('.', ',') +
                      ', ' +
                      String(item.quantity).replace('.', ',')
                    : 'Иван чай, 580, 2') +
                  '\nМожно также: Иван чай. 580. 2 или Иван чай 580 2. После разделителей ставьте пробел; дробные суммы и количества допустимы.\nИтог чека не изменится автоматически. /cancel — отмена.';
            await requestInput(
              chatId,
              query.from,
              s,
              {
                sessionId: s.id,
                waitingFor: action === 'change' ? 'changeTotal' : action === 'add' ? 'newItem' : 'editItem',
                editingItemId: item?.id,
                expectedVersion: s.version
              },
              promptText +
                (chatId > 0
                  ? '\nВ личном чате можно отправить обычным сообщением, без «Ответить».'
                  : '\nВ группе ответьте на этот запрос бота.')
            );
          }
        } else await show(chatId, s);
      } catch (error) {
        await report(chatId, query.from.id, s.id, error);
      }
    },
    async text(msg: Message): Promise<boolean> {
      if (!msg.from || !msg.text || msg.text.startsWith('/')) return false;
      const flow = store.getFlow(msg.chat.id, msg.from.id);
      if (!flow) return false;
      if (!flow.expectedVersion || !flow.promptMessageId) {
        await store.clearFlow(msg.chat.id, msg.from.id);
        return false;
      }
      const promptIds = flow.promptMessageIds || [flow.promptMessageId];
      const plainPrivateMessage = msg.chat.type === 'private' && !msg.reply_to_message;
      if (!plainPrivateMessage && !promptIds.includes(msg.reply_to_message?.message_id ?? -1)) return false;
      try {
        const changed = await service.revise(flow.sessionId, msg.from.id, flow.expectedVersion, (r) => {
          if (flow.waitingFor === 'changeTotal') {
            const amount = parseMoneyToMinor(msg.text!);
            if (!amount) throw new Error('INVALID_TOTAL');
            r.totalMinor = amount;
          } else if (flow.waitingFor === 'newItem') {
            if (r.items.length >= 100) throw new Error('INVALID_ITEM_INPUT');
            r.items.push(parseReviewItem(msg.text!));
          } else if (flow.waitingFor === 'editItem') {
            const index = r.items.findIndex((i) => i.id === flow.editingItemId);
            if (index < 0) throw new Error('ITEM_NOT_FOUND');
            r.items[index] = parseReviewItem(msg.text!, r.items[index].id);
          } else throw new Error('INVALID_ITEM_INPUT');
        });
        await store.clearFlow(msg.chat.id, msg.from.id);
        await show(msg.chat.id, changed);
      } catch (error) {
        if (error instanceof Error && ['INVALID_ITEM_INPUT', 'INVALID_TOTAL'].includes(error.message)) {
          const session = store.getSession(flow.sessionId);
          if (session) {
            await requestInput(
              msg.chat.id,
              msg.from,
              session,
              flow,
              errors[error.message] +
                '\n\nПродолжаю ждать исправление. Попробуйте ещё раз.' +
                (msg.chat.type === 'private'
                  ? ' Можно отправить обычным сообщением, без «Ответить».'
                  : ' В группе ответьте на этот запрос.')
            );
            return true;
          }
        }
        if (error instanceof Error && ['SESSION_CONFLICT', 'SESSION_FINALIZED', 'SESSION_FORBIDDEN'].includes(error.message))
          await store.clearFlow(msg.chat.id, msg.from.id);
        if (error instanceof Error && error.message === 'SESSION_NOT_FOUND') {
          await store.clearFlow(msg.chat.id, msg.from.id);
          await send(msg.chat.id, msg.from.id, 'Чек истёк. Отправьте фото заново.', { reply_markup: backKeyboard });
        } else await report(msg.chat.id, msg.from.id, flow.sessionId, error);
      }
      return true;
    }
  };
}
