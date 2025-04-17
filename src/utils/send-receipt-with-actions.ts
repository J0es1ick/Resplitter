import { bot } from '../bot/bot';
import { ParsedReceipt } from '../interfaces';
import { formatReceipt } from './format-receipt';
import { isReceiptValid } from './is-receipt-valid';

export const sendReceiptWithActions = async (chatId: number, receipt: ParsedReceipt, messageId?: number) => {
  const text = formatReceipt(receipt);
  const isValid = isReceiptValid(receipt);

  const keyboard = {
    inline_keyboard: isValid
      ? [
          [
            { text: 'Подтвердить', callback_data: 'parse_correct' },
            { text: 'Редактировать', callback_data: 'parse_incorrect' }
          ]
        ]
      : []
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
