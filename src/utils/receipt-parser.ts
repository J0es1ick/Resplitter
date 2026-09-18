import { createHash } from 'node:crypto';
import type { ParsedReceipt, ReceiptItem } from '../interfaces';
import { calculateSubtotal, parseMoneyToMinor, formatMoney } from './money';

const MONEY = String.raw`(?:\d{1,3}(?:[ \u00a0\u202f]\d{3})+|\d+)(?:[.,]\d{1,2})?`;
const NUMBER = String.raw`\d+(?:[.,]\d{1,3})?`;
const UNIT = String.raw`(?:порц\.?|шт\.?|кг|гр?\.?|мл|л|бут\.?)`;
const QUANTITY = String.raw`(${NUMBER})(?:\s*[xх*]\s*${NUMBER}\s*${UNIT}|\s*${UNIT})?`;
const TOTAL = /^(?:итого|всего|к\s+оплате|total|amount\s+due|сумма\s+заказов)(?:\s|:|$)/i;
const FEES = /^(?:обслуживание|сервисный\s+сбор|сервис|скидка|наценка|service|discount)(?:\s|:|$)/i;
const META =
  /^(?:(?:пре)?чек|гостевой\s+сч[её]т|сч[её]т|кассир|официант|сотрудник|место|стол|зал|гостей|заказ|открыт|закрыт|дата|печать|инн|фн|фд|фп|ккм|смена|receipt|order|наличные|безналичные|сдача|оплата|банковская|ндс|налог|подытог|subtotal|рубли|сум|uzs|rub|спасибо|добро\s+пожаловать)(?:\s|[:#№.]|$)/i;
const HEADER = /^(?:(?:наименование|блюдо|товар|name|кол[- ]?во|количество|qty|цена|price|сумма|sum|amount)[.:]?\s*)+$/i;
type Layout = 'price-qty' | 'qty-price' | 'qty-total' | 'unknown';
type Candidate = Omit<ReceiptItem, 'id'>;

export const normalizeReceiptText = (text: string): string =>
  (text || '')
    .normalize('NFKC')
    .replace(/[\u00a0\u202f]/g, ' ')
    .replace(/[‐‑‒–—]/g, '-')
    .replace(/[×хХ](?=\s*\d)/g, 'x')
    .replace(/[|¦]/g, ' ')
    .replace(/\r/g, '')
    .split('\n')
    .map((l) =>
      l
        .split('\t')
        .map((c) => c.replace(/\s+/g, ' ').trim())
        .join('\t')
        .trim()
    )
    .filter(Boolean)
    .join('\n');

export function parseReceiptText(raw: string): ParsedReceipt {
  const lines = normalizeReceiptText(raw).split('\n').filter(Boolean);
  const r: ParsedReceipt = {
    receiptNumber: '',
    date: '',
    time: '',
    waiter: '',
    currency: 'RUB',
    items: [],
    subtotalMinor: 0,
    totalMinor: 0,
    confidence: 0,
    warnings: []
  };
  if (!lines.length) {
    r.warnings.push('OCR не вернул текст');
    return r;
  }
  for (const line of lines) {
    r.receiptNumber ||= line.match(/(?:чек|заказ|сч[её]т|receipt)\s*(?:№|#|no\.?)?\s*[:#№-]?\s*(\d[\da-zа-я/-]*)/i)?.[1] || '';
    r.date ||= line.match(/\b(?:\d{2}[./-]\d{2}[./-](?:\d{4}|\d{2})|\d{4}[./-]\d{2}[./-]\d{2})\b/)?.[0] || '';
    r.time ||= line.match(/\b(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?\b/)?.[0] || '';
    r.waiter ||= line.match(/^(?:официант|кассир|сотрудник|waiter)\s*[:#-]?\s*(.{2,60})$/i)?.[1] || '';
    if (/^(?:сум|uzs)(?:\s|$)|\bUZS\b/i.test(line)) r.currency = 'UZS';
    else if (/\bKZT\b|тенге|₸/i.test(line)) r.currency = 'KZT';
    else if (/\bUSD\b|доллар|\$/i.test(line)) r.currency = 'USD';
    else if (/\bEUR\b|евро|€/i.test(line)) r.currency = 'EUR';
    else if (/\bGEL\b|лари|₾/i.test(line)) r.currency = 'GEL';
  }
  const headers = lines.filter((l) => HEADER.test(l));
  const header = headers.join(' ');
  const priceAt = header.search(/цена|price/i);
  const qtyAt = header.search(/кол[- ]?во|количество|qty/i);
  const layout: Layout = priceAt >= 0 && qtyAt >= 0 ? (priceAt < qtyAt ? 'price-qty' : 'qty-price') : qtyAt >= 0 ? 'qty-total' : 'unknown';
  const start = lines.findIndex((l) => HEADER.test(l));
  const candidates: Candidate[] = [];
  let pending = '';
  let detached = false;
  let skipped = 0;
  for (let index = start < 0 ? 0 : start + 1; index < lines.length; index++) {
    const line = lines[index];
    if (TOTAL.test(line) || FEES.test(line) || /^(?:подытог|subtotal)/i.test(line)) break;
    if (HEADER.test(line) || META.test(line) || /^\d{2}[./-]\d{2}[./-]/.test(line)) {
      pending = '';
      continue;
    }
    if (/^[-_=*.\s]+$/.test(line) || /^\d[\d\s]{9,}$/.test(line)) continue;
    if (new RegExp(String.raw`${NUMBER}\s*x\s*${NUMBER}\s*${UNIT}$`, 'i').test(line) && !parseLine(line, layout)) {
      pending = '';
      detached = true;
      skipped++;
      continue;
    }
    let item = parseLine(line, layout);
    if (!item && pending) {
      item = parseLine(pending + ' ' + line, layout);
      if (item) pending = '';
    }
    if (item && /[a-zа-яё]/i.test(item.name)) {
      if (candidates.length >= 100) {
        skipped++;
        continue;
      }
      candidates.push(item);
      pending = '';
      detached = false;
      continue;
    }
    if (!/[a-zа-яё]/i.test(line) && !/^\d+[.,]\d+\s*(?:мл|л|гр|кг)$/i.test(line)) {
      if (/\d/.test(line)) skipped++;
      continue;
    }
    if (line.length > 120) {
      skipped++;
      continue;
    }
    const next = lines[index + 1] || '';
    const beginsNew = !/[a-zа-яё]/i.test(next.replace(/\b(?:x|RUB)\b/gi, '')) && !!parseLine(line + ' ' + next, layout);
    if (!candidates.length || beginsNew || pending) pending = (pending ? pending + ' ' : '') + line;
    else if (!detached) candidates[candidates.length - 1].name = cleanName(candidates[candidates.length - 1].name + ' ' + line);
  }
  r.items = candidates.map((i, index) => ({
    ...i,
    name: cleanName(i.name),
    id: createHash('sha1')
      .update(index + ':' + i.name + ':' + i.lineTotalMinor)
      .digest('hex')
      .slice(0, 12)
  }));
  r.subtotalMinor = calculateSubtotal(r.items);
  const printedTotal = parseTotal(lines);
  r.totalMinor = printedTotal ?? r.subtotalMinor;
  if (!r.items.length) r.warnings.push('Не удалось уверенно распознать позиции');
  if (!r.totalMinor) r.warnings.push('Не удалось распознать итоговую сумму');
  if (printedTotal === undefined) r.warnings.push('Итог рассчитан как сумма распознанных позиций: сверьте с фото');
  if (skipped)
    r.warnings.push('Есть строки без надёжно распознанной суммы (' + skipped + '). Проверьте бесплатные дополнения и пропущенные позиции.');
  const uncertain = r.items.filter((i) => (i.confidence ?? 0) < 0.8);
  if (uncertain.length)
    r.warnings.push(
      'Проверьте количество и цену в позициях: ' +
        uncertain.map((i) => String(r.items.indexOf(i) + 1)).join(', ') +
        '. Недостающие количества временно приняты за 1.'
    );
  const delta = r.totalMinor - r.subtotalMinor;
  if (delta)
    r.warnings.unshift(
      'Сумма позиций отличается от итога на ' +
        formatMoney(Math.abs(delta), r.currency) +
        '. Проверьте скидки, обслуживание и пропущенные позиции.'
    );
  const feeLines = lines.filter((l) => FEES.test(l));
  if (feeLines.length)
    r.warnings.push(
      'В чеке есть скидка или обслуживание: ' + feeLines.join('; ').slice(0, 250) + '. Корректировка распределится пропорционально долям.'
    );
  const mean = r.items.length ? r.items.reduce((s, i) => s + (i.confidence || 0), 0) / r.items.length : 0;
  r.confidence = Math.max(
    0,
    Math.min(1, Math.round((mean * 0.8 + (printedTotal !== undefined ? 0.2 : 0) - (delta && !feeLines.length ? 0.2 : 0)) * 100) / 100)
  );
  r.warnings = r.warnings.slice(0, 20);
  return r;
}

function cleanName(name: string): string {
  return name
    .replace(/^\d{1,3}[.)]\s*/, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}
function quantity(text: string): number | undefined {
  const q = Number(text.replace(',', '.'));
  return Number.isFinite(q) && q > 0 && q <= 10000 ? q : undefined;
}
function candidate(name: string, qty: string, totalText: string, unitText?: string, confidence = 0.95): Candidate | undefined {
  if (!/[a-zа-яё]/i.test(name) || /^\d+(?:[.,]\d+)?\s*[xх*]/i.test(name) || /[=:]$/.test(name)) return;
  const q = quantity(qty);
  const total = parseMoneyToMinor(totalText);
  const unit = unitText === undefined ? undefined : parseMoneyToMinor(unitText);
  if (!q || total === undefined || (unitText !== undefined && unit === undefined)) return;
  const unitPriceMinor = unit ?? Math.round(total / q);
  if (unitPriceMinor > 100_000_000) return;
  if (unit !== undefined && Math.abs(Math.round(unit * q) - total) > 2) confidence = 0.55;
  return { name: cleanName(name), quantity: q, unitPriceMinor, lineTotalMinor: total, confidence };
}
function parseLine(raw: string, layout: Layout): Candidate | undefined {
  if (raw.includes('\t')) {
    const fields = raw.split('\t');
    const name = fields[0];
    let total = fields[fields.length - 1];
    const qtyIndex = layout === 'price-qty' ? 2 : 1;
    let qty = fields[qtyIndex]?.match(new RegExp('^' + QUANTITY + '$', 'i'))?.[1];
    if (!qty && fields.length === 3) {
      const combined = total.match(new RegExp(String.raw`^(${NUMBER})\s+(${MONEY})$`));
      if (combined && /[.,]/.test(combined[1])) {
        qty = combined[1];
        total = combined[2];
      }
    }
    const unit = fields.length === 4 ? fields[layout === 'price-qty' ? 1 : 2] || undefined : undefined;
    if (fields.length >= 3) return candidate(name, qty || '1', total, unit, qty ? 0.95 : 0.55);
  }
  const line = raw
    .replace(/^\d{1,3}[.)]\s*/, '')
    .replace(/\s*(?:₽|руб\.?|RUB|UZS|сум)$/i, '')
    .trim();
  if (META.test(line) || HEADER.test(line) || TOTAL.test(line) || FEES.test(line)) return;
  let m = line.match(new RegExp(String.raw`^(.+?)\s+(${NUMBER})\s*(?:x|\*|@|по)\s*(${MONEY})\s*(?:=|:)\s*(${MONEY})$`, 'i'));
  if (m) return candidate(m[1], m[2], m[4], m[3], 0.99);
  m = line.match(new RegExp(String.raw`^(.+?)\s+(${NUMBER})\s*(?:x|\*|@|по)\s*(${MONEY})$`, 'i'));
  if (m) {
    const q = quantity(m[2]),
      unit = parseMoneyToMinor(m[3]);
    if (q && unit !== undefined) return candidate(m[1], m[2], (Math.round(q * unit) / 100).toFixed(2), m[3], 0.9);
  }
  if (layout === 'price-qty') {
    m = line.match(new RegExp(String.raw`^(.+?)\s+(${MONEY})\s+${QUANTITY}\s+(${MONEY})$`, 'i'));
    if (m) return candidate(m[1], m[3], m[4], m[2]);
  }
  if (layout === 'qty-price' || layout === 'unknown') {
    m = line.match(new RegExp(String.raw`^(.+?)\s+${QUANTITY}\s+(${MONEY})\s+(${MONEY})$`, 'i'));
    if (m) {
      const found = candidate(m[1], m[2], m[4], m[3]);
      if (layout === 'qty-price' || (found?.confidence ?? 0) > 0.8) return found;
    }
  }
  m = line.match(new RegExp(String.raw`^(.+?)\s+${QUANTITY}\s+(${MONEY})$`, 'i'));
  if (m) return candidate(m[1], m[2], m[3], undefined, layout === 'unknown' ? 0.85 : 0.95);
  m = line.match(new RegExp(String.raw`^(.+?)\s+(${MONEY})$`, 'i'));
  if (m && (layout === 'unknown' || /[.,]\d{2}$/.test(m[2]) || Number(m[2].replace(/\s/g, '')) >= 10))
    return candidate(m[1], '1', m[2], undefined, layout === 'unknown' ? 0.85 : 0.55);
  return;
}
function parseTotal(lines: string[]): number | undefined {
  const totals: Array<{ value: number; priority: number; index: number }> = [];
  lines.forEach((line, index) => {
    if (!TOTAL.test(line) || /по\s+юридическим|подытог|промежуточный/i.test(line)) return;
    const tail = line.replace(
      /^(?:итого(?:\s+к\s+оплате)?|всего(?:\s+к\s+оплате)?|к\s+оплате|amount\s+due|total|сумма\s+заказов)\s*:?\s*/i,
      ''
    );
    let value = parseMoneyToMinor(tail);
    if (value === undefined && lines[index + 1]) value = parseMoneyToMinor(lines[index + 1]);
    if (value === undefined) return;
    totals.push({ value, priority: /к\s+оплате|amount\s+due/i.test(line) ? 3 : 1, index });
  });
  return totals.sort((a, b) => b.priority - a.priority || b.index - a.index)[0]?.value;
}
