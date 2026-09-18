import type { ParsedReceipt } from '../interfaces';
import { receiptSchema } from '../domain/schema';

export const isReceiptValid = (receipt: ParsedReceipt): boolean =>
  receipt.items.length > 0 && receipt.totalMinor > 0 && receipt.confidence >= 0.45 && receiptSchema.safeParse(receipt).success;
