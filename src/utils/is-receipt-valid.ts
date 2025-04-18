import { ParsedReceipt } from '../interfaces';

export const isReceiptValid = (receipt: ParsedReceipt): boolean => {
  return (receipt.items?.length ?? 0) > 0 || (receipt.total ?? 0) > 0 || !!receipt.receiptNumber || !!receipt.date;
};
