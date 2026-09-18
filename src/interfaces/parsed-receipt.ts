import type { ReceiptItem } from './receipt-item';
import type { Currency } from '../domain/currency';

export interface ParsedReceipt {
  receiptNumber: string;
  date: string;
  time: string;
  waiter: string;
  currency: Currency;
  items: ReceiptItem[];
  subtotalMinor: number;
  totalMinor: number;
  confidence: number;
  warnings: string[];
}
