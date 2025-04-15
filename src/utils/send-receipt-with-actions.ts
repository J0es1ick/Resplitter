import { bot } from '../bot/bot';
import { ParsedReceipt } from '../interfaces';
import { formatReceipt } from './format-receipt';

export const sendReceiptWithActions = async (chatId: number, receipt: ParsedReceipt, messageId?: number) => {
  const text = formatReceipt(receipt);
  const keyboard = {
    inline_keyboard: [
      [
        { text: 'Подтвердить', callback_data: 'parse_correct' },
        { text: 'Редактировать', callback_data: 'parse_incorrect' }
      ]
    ]
  };

  if (messageId) {
    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: keyboard
    });
  } else {
    await bot.sendMessage(chatId, text, { reply_markup: keyboard });
  }
};
