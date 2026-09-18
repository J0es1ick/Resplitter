export interface ReceiptItem {
  id: string;
  name: string;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  confidence?: number;
}
