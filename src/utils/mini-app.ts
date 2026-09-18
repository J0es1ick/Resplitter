import type { ReceiptSession } from '../interfaces';
import { getBotUsername } from '../bot/bot';
import { screens } from '../bot/screens';
import { config } from '../config';
import { mainKeyboardRows } from './bot-navigation';
import { stateService, type StateService } from '../services/state-service';
import type { Screen, ScreenOptions } from '../services/bot-screen-service';

export function createMiniAppSender(deps: { screen: Screen; store: StateService; url: string; username: () => string }) {
  return async function sendMiniApp(
    chatId: number,
    session?: ReceiptSession,
    text = 'Открыть чек',
    userId = session?.ownerUserId ?? chatId
  ) {
    const show = async (text: string, options: ScreenOptions) => {
      await deps.screen.show(chatId, userId, text, options);
      if (session) deps.store.setBotUi(chatId, userId, { receipt: { sessionId: session.id, mode: 'app' } });
    };
    if (session?.status === 'draft') throw new Error('RECEIPT_NOT_CONFIRMED');
    if (!deps.url) {
      await show(text + '\n\nMini App временно недоступен: требуется HTTPS-адрес сервиса.', {
        reply_markup: { inline_keyboard: mainKeyboardRows }
      });
      return;
    }
    if (chatId < 0) {
      const url = 'https://t.me/' + deps.username() + (session ? '?start=receipt_' + session.id : '?start');
      await show(text, {
        reply_markup: {
          inline_keyboard: [[{ text: session?.status === 'finalized' ? 'Посмотреть итог' : 'Разделить чек', url }], ...mainKeyboardRows]
        }
      });
      return;
    }
    const url = new URL(deps.url + '/app/');
    if (session) url.searchParams.set('session', session.id);
    await show(text, {
      reply_markup: {
        inline_keyboard: [
          [{ text: session?.status === 'finalized' ? 'Посмотреть итог в Mini App' : 'Открыть Mini App', web_app: { url: url.toString() } }],
          ...mainKeyboardRows
        ]
      }
    });
  };
}
export const sendMiniApp = createMiniAppSender({ screen: screens, store: stateService, url: config.miniAppUrl, username: getBotUsername });
