import { parseIncorrect } from '.';
import { ParsedReceipt } from '../../interfaces';

export const backTo = async (chatId: number, messageId: number, receipt: ParsedReceipt) => {
  await parseIncorrect(chatId, messageId, receipt);
};
