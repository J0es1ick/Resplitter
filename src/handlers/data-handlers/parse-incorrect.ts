import { bot } from '../../bot/bot';

export const parseIncorrect = async (chatId: number, messageId: number) => {
  await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: messageId });

  bot.sendMessage(chatId, 'Пожалуйста, укажите что не так с распознанным чеком:', {
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Редактировать', callback_data: 'edit_receipt' }],
        [
          { text: 'Добавить блюдо', callback_data: 'add_dish' },
          { text: 'Удалить блюдо', callback_data: 'remove_dish' }
        ],
        [{ text: 'Изменить сумму', callback_data: 'change_total' }]
      ]
    }
  });
};
