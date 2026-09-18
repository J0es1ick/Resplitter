import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { OCRResponse } from '../src/interfaces';
import { extractTextFromOcrResponse } from '../src/utils/handle';
import { parseReceiptText } from '../src/utils/receipt-parser';
import { combineOcrCandidates, needsOcrRetry } from '../src/utils/ocr-candidates';
import { receiptSchema } from '../src/domain/schema';

function read(name: string) {
  const response = JSON.parse(readFileSync(path.resolve('tests/fixtures/ocr/' + name + '.json'), 'utf8')) as OCRResponse;
  return parseReceiptText(extractTextFromOcrResponse(response));
}
const amounts = [
  [840, 900, 700, 120, 400, 650, 630, 330, 300, 100],
  [690, 750, 690, 580],
  [0, 390, 980, 100, 980, 390],
  [2250, 1160, 2250, 1410, 1540, 1200, 500, 650, 710, 900, 530, 700, 580, 700, 2200, 300, 888, 660, 1300, 1410, 450, 530],
  [8000, 28000, 70000, 21000, 50000, 1000, 6000, 6500, 4500, 19000, 4000, 36000, 30000],
  [760, 1350, 390, 80, 450, 980, 640, 390, 590, 240, 720, 360, 360, 24, 320]
];
const totals = [4970, 2710, 2840, 22818, 312400, 7654];
for (let i = 0; i < 6; i++)
  test('real OCR regression: receipt photo ' + (i + 1), () => {
    const r = read('sample-' + (i + 1));
    assert.deepEqual(
      r.items.map((item) => item.lineTotalMinor),
      amounts[i].map((n) => n * 100)
    );
    assert.equal(r.totalMinor, totals[i] * 100);
    assert.equal(r.subtotalMinor, amounts[i].reduce((a, b) => a + b, 0) * 100);
    assert.ok(receiptSchema.safeParse(r).success);
  });
test('portion multipliers, multiline names, free items, barcodes and service currency survive OCR', () => {
  const pub = read('sample-1');
  assert.deepEqual(
    pub.items.map((i) => i.quantity),
    [3, 3, 2, 2, 1, 1, 1, 1, 1, 1]
  );
  assert.match(pub.items[4].name, /Чизбургер с картофельными чипсами/);
  assert.match(pub.items[1].name, /светлое 0.5л/);
  assert.ok(!pub.items.some((i) => /Место|Кружка|БОНУС/.test(i.name)));
  assert.ok(pub.warnings.some((w) => /бесплатные дополнения/.test(w)));
  const breakfast = read('sample-3');
  assert.equal(breakfast.items[0].quantity, 2);
  assert.equal(breakfast.items[0].lineTotalMinor, 0);
  assert.match(breakfast.items[1].name, /индейкой, сыром/);
  assert.match(breakfast.items[5].name, /450мл/);
  const uz = read('sample-5');
  assert.equal(uz.currency, 'UZS');
  assert.equal(uz.totalMinor - uz.subtotalMinor, 2840000);
  const cafe = read('sample-6');
  assert.equal(cafe.items[1].quantity, 15);
  assert.equal(cafe.items[4].quantity, 5);
  assert.equal(cafe.items[13].lineTotalMinor, 2400);
  assert.ok(cafe.items.every((i) => !/046[0-9]+/.test(i.name)));
});
test('folded receipt has monotonic name/amount correspondence, missing quantities remain explicit', () => {
  const r = read('sample-4');
  assert.deepEqual(
    r.items.slice(11).map((i) => i.name),
    [
      'Дормамму',
      'Красная Жара',
      'Корбен-бургер',
      'Кокосовый Грут',
      'Картофель "Фрай"',
      'Кхорндоги',
      'Зомби',
      'Арториас NG+',
      'ШТУРМОВИК',
      'Сур кешский сидр 0,5',
      'Анабиоз'
    ]
  );
  assert.ok(r.warnings.some((w) => /Недостающие количества/.test(w)));
  assert.ok(needsOcrRetry(r));
});
test('enhanced OCR supplements known-aligned quantities without overwriting reliable first pass', () => {
  const pizza = combineOcrCandidates(read('sample-2'), read('sample-2-enhanced'));
  assert.equal(pizza.items[3].quantity, 2);
  assert.ok(pizza.warnings.some((w) => /1, 2, 3\./.test(w)));
  const folded = combineOcrCandidates(read('sample-4'), read('sample-4-enhanced'));
  assert.equal(folded.items[0].quantity, 5);
  assert.equal(folded.items[14].quantity, 4);
  assert.ok(folded.warnings.length > 0);
  const corrupted = read('sample-2-enhanced');
  corrupted.items[0].lineTotalMinor++;
  assert.deepEqual(combineOcrCandidates(pizza, corrupted), pizza);
});
test('column separators prevent thousands and volumes from becoming quantities', () => {
  const r = parseReceiptText('Наименование Кол-во Сумма\nПиво 0,5\t\t1 410.00\nБлюдо\t2\t1 160.00\nИтого 2570.00');
  assert.equal(r.items[0].name, 'Пиво 0,5');
  assert.equal(r.items[0].lineTotalMinor, 141000);
  assert.equal(r.items[0].quantity, 1);
  assert.equal(r.items[1].quantity, 2);
  assert.ok(r.warnings.length > 0);
});
