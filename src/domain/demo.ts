import type { ParsedReceipt } from '../interfaces/parsed-receipt';
export function demoReceipt(): ParsedReceipt {
  return {
    receiptNumber: 'DEMO-2048',
    date: 'Тестовый чек',
    time: '',
    waiter: '',
    currency: 'RUB',
    items: [
      { id: 'burrata', name: 'Буррата с томатами', quantity: 1, unitPriceMinor: 69000, lineTotalMinor: 69000 },
      { id: 'pasta', name: 'Паста с белыми грибами', quantity: 2, unitPriceMinor: 85000, lineTotalMinor: 170000 },
      { id: 'pizza', name: 'Пицца Маргарита', quantity: 1, unitPriceMinor: 74000, lineTotalMinor: 74000 },
      { id: 'lemonade', name: 'Домашний лимонад', quantity: 2, unitPriceMinor: 29000, lineTotalMinor: 58000 },
      { id: 'dessert', name: 'Тирамису', quantity: 1, unitPriceMinor: 42000, lineTotalMinor: 42000 }
    ],
    subtotalMinor: 413000,
    totalMinor: 413000,
    confidence: 1,
    warnings: []
  };
}
