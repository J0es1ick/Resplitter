import type { Message } from 'node-telegram-bot-api';
import { bot, type BotInstance } from '../bot/bot';
import { config } from '../config';
import { stateService, type StateService } from '../services/state-service';
import { requireAccess } from '../services/access-service';
import { sendMiniApp } from '../utils/mini-app';
import { demoReceipt } from '../domain/demo';
import { RateLimit } from '../security/rate-limit';
import { sendReceiptWithActions } from '../utils/send-receipt-with-actions';
import { helpKeyboard, homeKeyboard, withReceiptReturn } from '../utils/bot-navigation';
import { screens } from '../bot/screens';
import type { Screen, ScreenOptions } from '../services/bot-screen-service';
import { createReceiptCatalog } from './receipt-catalog';

export function createStartHandler(deps: {
  bot: Pick<BotInstance, 'sendMessage' | 'getChatMember'>;
  store: StateService;
  show: typeof sendReceiptWithActions;
  open: typeof sendMiniApp;
  demoEnabled: boolean;
  catalog: (msg: Message) => Promise<void>;
  screen?: Screen;
}) {
  const { bot, store, show, open, demoEnabled } = deps;
  const demos = new RateLimit(2, 60000);
  return async function handleStart(msg: Message): Promise<void> {
    if (!msg.from) return;
    const send = (text: string, options: ScreenOptions) =>
      deps.screen ? deps.screen.show(msg.chat.id, msg.from!.id, text, options) : bot.sendMessage(msg.chat.id, text, options);
    const [, matchedCommand, token] = /^\/(start|app|demo)(?:@\w+)?(?:\s+(.+))?$/i.exec((msg.text || '').trim()) || [];
    const command = matchedCommand?.toLowerCase();
    if (!command) return;
    await store.clearFlow(msg.chat.id, msg.from.id);
    if (command === 'start' && !token) {
      const context = store.getBotUi(msg.chat.id, msg.from.id).receipt;
      await send(
        'Главное меню\n\nОтправьте фото нового чека — я покажу позиции здесь, в боте. Проверьте все страницы, исправьте ошибки и подтвердите чек. Затем Mini App поможет разделить его с друзьями.\n\nСохранённые чеки и черновики — в «Мои чеки». Возврат в меню отменяет только текущий ввод: сами чеки остаются.\nДля совместного разделения откройте «Как разделить компанией?».' +
          (demoEnabled ? '\nДля теста без фотографии: /demo' : ''),
        { reply_markup: withReceiptReturn(homeKeyboard, !!context && !!store.getSession(context.sessionId)) }
      );
      return;
    }
    if (command === 'demo') {
      if (!demoEnabled || !demos.allow(String(msg.from.id))) {
        await send('Демо сейчас недоступно. Отправьте фотографию чека.', { reply_markup: helpKeyboard });
        return;
      }
      const session = await store.createSession(msg.from.id, msg.chat.id, demoReceipt(), msg.chat.id + ':' + msg.message_id);
      await show(msg.chat.id, session);
      return;
    }
    if (!token) {
      await deps.catalog(msg);
      return;
    }
    if (msg.chat.type !== 'private') {
      await send('Откройте ссылку в личном чате с ботом.', { reply_markup: helpKeyboard });
      return;
    }
    const invite = token.startsWith('join_');
    const s = invite ? store.findInvitation(token.slice(5)) : store.getSession(token.replace(/^(?:receipt|review)_/, ''));
    if (!s) {
      await send('Ссылка истекла или чек не найден.', { reply_markup: helpKeyboard });
      return;
    }
    if (!invite || s.sourceChatId < 0) await requireAccess(s, msg.from.id, (chat, user) => bot.getChatMember(chat, user));
    if (s.status === 'draft' || token.startsWith('review_')) {
      if (s.ownerUserId === msg.from.id) await show(msg.chat.id, s);
      else
        await send('Владелец ещё проверяет чек в боте. Дождитесь подтверждения и откройте приглашение повторно.', {
          reply_markup: helpKeyboard
        });
      return;
    }
    await store.join(s.id, msg.from.id, msg.from.first_name);
    await open(
      msg.chat.id,
      s,
      s.status === 'finalized'
        ? 'Закрытый чек. Расчёт завершён; в Mini App доступен только просмотр.'
        : 'Откройте чек, отметьте свои блюда и укажите количество. Для общей еды есть «Делим вместе». Нажмите «Сохранить выбор» — участники увидят ваш результат.',
      msg.from.id
    );
  };
}

export const receiptCatalog = createReceiptCatalog({
  bot,
  store: stateService,
  screen: screens,
  lookup: (chatId, userId) => bot.getChatMember(chatId, userId),
  showReceipt: sendReceiptWithActions,
  open: sendMiniApp
});

export const handleStart = createStartHandler({
  bot,
  store: stateService,
  show: sendReceiptWithActions,
  open: sendMiniApp,
  demoEnabled: config.demoEnabled,
  catalog: receiptCatalog.show,
  screen: screens
});
