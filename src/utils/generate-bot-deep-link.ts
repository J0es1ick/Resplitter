import { receiptStorage } from '../constants/receipt-storage';
import { ParsedReceipt } from '../interfaces';

export function generateBotDeepLink(chatId: number, receipt: ParsedReceipt, botUsername: string): string {
  receiptStorage.set(chatId, receipt);
  return `https://t.me/${botUsername}?start=receipt_${chatId}`;
}
