import { bot } from '../../bot/bot';
import { ParsedReceipt } from '../../interfaces';
import { sendReceiptWithActions } from '../../utils';

export const back = async (chatId: number, messageId: number, receipt: ParsedReceipt) => {
  await sendReceiptWithActions(chatId, receipt, messageId);
};
