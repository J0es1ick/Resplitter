import assert from 'node:assert/strict';
import test from 'node:test';

import { parseReceiptText } from '../src/utils/receipt-parser';

test('total on following line, fractional quantity and duplicate dish names', () => {
  const receipt = parseReceiptText('Кафе\nЧай 100,00\nЧай 100,00\nЯблоки\n0,5 x 300,00 = 150,00\nИТОГО\n350,00');
  assert.equal(receipt.items.length, 3);
  assert.equal(receipt.items[0].name, 'Чай');
  assert.equal(new Set(receipt.items.map((i) => i.id)).size, 3);
  assert.equal(receipt.items[2].quantity, 0.5);
  assert.equal(receipt.totalMinor, 35000);
});
test('explicit payable total wins over subtotal and tendered cash', () => {
  const receipt = parseReceiptText('Салат 1000.00\nSubtotal 1000.00\nСкидка 100.00\nК оплате 900.00\nНаличные 2000.00\nСдача 1100.00');
  assert.equal(receipt.items.length, 1);
  assert.equal(receipt.totalMinor, 90000);
});

test('parses a table with quantity, unit price and line total', () => {
  const receipt = parseReceiptText(`
РЕСТОРАН ТЕСТ
Чек № 12345
03.08.2026 14:35
Наименование Кол-во Цена Сумма
Пицца Маргарита 2 650,00 1 300,00
Чай 1 180,00 180,00
ИТОГО К ОПЛАТЕ 1 480,00
`);

  assert.equal(receipt.receiptNumber, '12345');
  assert.equal(receipt.items.length, 2);
  assert.deepEqual(
    receipt.items[0] && {
      name: receipt.items[0].name,
      quantity: receipt.items[0].quantity,
      unitPriceMinor: receipt.items[0].unitPriceMinor,
      lineTotalMinor: receipt.items[0].lineTotalMinor
    },
    { name: 'Пицца Маргарита', quantity: 2, unitPriceMinor: 65000, lineTotalMinor: 130000 }
  );
  assert.equal(receipt.totalMinor, 148000);
  assert.equal(receipt.warnings.length, 0);
});

test('joins multiline item names and parses equations', () => {
  const receipt = parseReceiptText(`
КАФЕ
Заказ #7788
Борщ со сметаной
2 x 350.50 = 701.00
Хлеб 50,00
Всего: 751,00
`);

  assert.equal(receipt.items.length, 2);
  assert.equal(receipt.items[0]?.name, 'Борщ со сметаной');
  assert.equal(receipt.items[0]?.lineTotalMinor, 70100);
  assert.equal(receipt.items[1]?.name, 'Хлеб');
  assert.equal(receipt.totalMinor, 75100);
});

test('does not accept receipt metadata as a product', () => {
  const receipt = parseReceiptText('Receipt No 12345\n2026-08-03 14:35\nTOTAL 1000.00');
  assert.equal(receipt.items.length, 0);
  assert.equal(receipt.totalMinor, 100000);
});

test('keeps service charges out of items and reports reconciliation difference', () => {
  const receipt = parseReceiptText(`
Гостевой счёт № 42
1) Салат Цезарь 2 x 450,00 = 900,00
Сервисный сбор 10% 90,00
К ОПЛАТЕ 990,00
`);
  assert.equal(receipt.items.length, 1);
  assert.equal(receipt.items[0]?.lineTotalMinor, 90000);
  assert.equal(receipt.totalMinor, 99000);
  assert.match(receipt.warnings.join(' '), /отличается от итога/);
});
