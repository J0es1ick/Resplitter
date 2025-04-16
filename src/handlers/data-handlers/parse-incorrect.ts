import { bot } from '../../bot/bot';
import { ParsedReceipt } from '../../interfaces';
import { formatReceipt } from '../../utils';

export const parseIncorrect = async (chatId: number, messageId: number, receipt: ParsedReceipt) => {
  const text = formatReceipt(receipt);
  const keyboard = {
    inline_keyboard: [
      [{ text: 'Редактировать', callback_data: 'edit_receipt' }],
      [
        { text: 'Добавить блюдо', callback_data: 'add_dish' },
        { text: 'Удалить блюдо', callback_data: 'remove_dish' }
      ],
      [{ text: 'Изменить сумму', callback_data: 'change_total' }],
      [{ text: 'Назад', callback_data: 'back' }]
    ]
  };

  await bot.editMessageText(text, {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: keyboard
  });
};
