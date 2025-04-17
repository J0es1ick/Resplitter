import { ReceiptItem } from './receipt-item';

export interface ParsedReceipt {
  receiptNumber: string;
  date: string;
  time: string;
  waiter: string;
  items: ReceiptItem[];
  total: number;
}
