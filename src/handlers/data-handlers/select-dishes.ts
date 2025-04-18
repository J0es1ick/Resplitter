import { bot } from '../../bot/bot';
import { ChatState } from '../../interfaces';
import { generateWebAppUrl } from '../../utils';

export const selectDishes = async (chatId: number, messageId: number, state: ChatState) => {
  if (!state.receipt) {
    await bot.sendMessage(chatId, 'Чек не найден. Пожалуйста, начните заново.');
    return;
  }

  await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: messageId });
  const webAppUrl = generateWebAppUrl(state.receipt, chatId);
  bot.sendMessage(chatId, 'Перейдите в мини-приложение для выбора блюд:', {
    reply_markup: {
      inline_keyboard: [[{ text: 'Выбрать свои позиции', web_app: { url: webAppUrl } }]]
    }
  });
};
