import { ReceiptItem } from './ReceiptItem';

export interface ParsedReceipt {
  receiptNumber: string;
  date: string;
  time: string;
  waiter: string;
  items: ReceiptItem[];
  total: number;
}
