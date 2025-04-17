import { bot } from '../../bot/bot';
import { config } from '../../config';

export const selectDishes = async (chatId: number, messageId: number) => {
  await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: messageId });
  bot.sendMessage(chatId, 'Перейдите в мини-приложение для выбора блюд:', {
    reply_markup: {
      inline_keyboard: [[{ text: 'Выбрать свои позиции', web_app: { url: config.telegram.webAppUrl } }]]
    }
  });
};
