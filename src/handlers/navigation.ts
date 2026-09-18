import type { CallbackQuery, Message } from 'node-telegram-bot-api';
import type { BotInstance } from '../bot/bot';
import type { StateService } from '../services/state-service';
import { backKeyboard, groupHelp, helpKeyboard, withReceiptReturn } from '../utils/bot-navigation';
import type { Screen, ScreenOptions } from '../services/bot-screen-service';

export function createNavigationHandlers(deps: {
  bot: Pick<BotInstance, 'sendMessage' | 'answerCallbackQuery'>;
  store: StateService;
  home: (msg: Message) => Promise<void>;
  retentionHours: number;
  screen?: Screen;
  receiptsBack?: (msg: Message) => Promise<void>;
  currentReceipt?: (msg: Message) => Promise<void>;
}) {
  async function text(msg: Message): Promise<boolean> {
    if (!msg.from) return false;
    const send = (text: string, options: ScreenOptions) =>
      deps.screen ? deps.screen.show(msg.chat.id, msg.from!.id, text, options) : deps.bot.sendMessage(msg.chat.id, text, options);
    const command = /^\/(info|group|privacy|cancel|back)(?:@\w+)?\s*$/i.exec(msg.text || '')?.[1]?.toLowerCase();
    if (!command) return false;
    await deps.store.clearFlow(msg.chat.id, msg.from.id);
    const context = deps.store.getBotUi(msg.chat.id, msg.from.id).receipt;
    const hasReceipt = !!context && !!deps.store.getSession(context.sessionId);
    const back = withReceiptReturn(backKeyboard, hasReceipt),
      help = withReceiptReturn(helpKeyboard, hasReceipt);
    if (command === 'cancel' || command === 'back') {
      await deps.home({ ...msg, text: '/start' });
    } else if (command === 'group') {
      await send(groupHelp, { reply_markup: back });
    } else if (command === 'info') {
      await send(
        'Фото → проверка всех страниц и исправления в боте → подтверждение → Mini App → приглашение друзей → количество и сохранение выбора → итог.\n\nВ чате чек разбит на страницы: «Далее» и «Предыдущая» показывают остальные позиции. Итог на каждой странице относится ко ВСЕМУ чеку.\n\n/app — ваши чеки и черновики\n/group — как разделить компанией\n/demo — тестовый чек\n/privacy — хранение данных\n/back или /cancel — выйти из ввода в главное меню',
        { reply_markup: help }
      );
    } else {
      await send(
        `Фото передаётся Yandex OCR и удаляется с нашего сервера после распознавания. Чеки и выбор участников доступны ${deps.retentionHours} ч. (точный срок указан в Mini App), затем удаляются из рабочей базы. Резервные копии могут иметь отдельный срок хранения. Логи не содержат фото и OCR-текста. Данные не отправляются в платёжные системы.`,
        { reply_markup: back }
      );
    }
    return true;
  }
  return {
    text,
    async callback(query: CallbackQuery): Promise<boolean> {
      const action = /^nav:(home|info|group|privacy|app|demo|receipts|current)$/.exec(query.data || '')?.[1];
      if (!action) return false;
      await deps.bot.answerCallbackQuery(query.id).catch(() => undefined);
      if (!query.message) return true;
      const msg = { ...query.message, from: query.from, text: '/' + (action === 'home' ? 'start' : action) } as Message;
      await deps.screen?.adopt(msg.chat.id, query.from.id, msg.message_id);
      await deps.store.clearFlow(msg.chat.id, query.from.id);
      if (action === 'current' && deps.currentReceipt) await deps.currentReceipt(msg);
      else if (action === 'receipts' && deps.receiptsBack) await deps.receiptsBack(msg);
      else if (['home', 'app', 'demo'].includes(action)) await deps.home(msg);
      else await text(msg);
      return true;
    }
  };
}
