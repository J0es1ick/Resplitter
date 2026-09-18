import type { ParsedReceipt } from '../interfaces';
import { formatMoney } from './money';

export const REVIEW_PAGE_SIZE = 6;
export const escapeHtml = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const formatReceipt = (receipt: ParsedReceipt, page = 0): string => {
  const pages = Math.max(1, Math.ceil(receipt.items.length / REVIEW_PAGE_SIZE));
  page = Math.max(0, Math.min(page, pages - 1));
  const money = (n: number) => formatMoney(n, receipt.currency);
  const lines = [
    '<b>Проверка чека в боте</b>',
    '№ ' + escapeHtml(receipt.receiptNumber || '—'),
    escapeHtml([receipt.date, receipt.time].filter(Boolean).join(' ')),
    '',
    '<b>Страница ' +
      (page + 1) +
      ' из ' +
      pages +
      ' · позиции ' +
      (receipt.items.length ? page * REVIEW_PAGE_SIZE + 1 : 0) +
      '–' +
      Math.min((page + 1) * REVIEW_PAGE_SIZE, receipt.items.length) +
      ' из ' +
      receipt.items.length +
      '</b>'
  ];
  if (pages > 1)
    lines.push('📄 Это часть чека. Остальные позиции — на других страницах; листайте кнопками ниже. Итог указан за ВЕСЬ чек.', '');
  if (!receipt.items.length) lines.push('Не распознаны — добавьте позиции вручную.');
  for (const [offset, item] of receipt.items.slice(page * REVIEW_PAGE_SIZE, (page + 1) * REVIEW_PAGE_SIZE).entries()) {
    lines.push(
      page * REVIEW_PAGE_SIZE +
        offset +
        1 +
        '. ' +
        escapeHtml(item.name) +
        '\n' +
        'Кол-во: ' +
        item.quantity +
        ((item.confidence ?? 1) < 0.8 ? ' ⚠ проверьте' : '') +
        ' · вся позиция: <b>' +
        money(item.lineTotalMinor) +
        '</b>'
    );
  }
  lines.push('', 'Сумма позиций: ' + money(receipt.subtotalMinor), '<b>К оплате: ' + money(receipt.totalMinor) + '</b>');
  if (receipt.warnings.length)
    lines.push('', '<b>Проверьте:</b>', ...receipt.warnings.slice(0, 3).map((w) => '• ' + escapeHtml(w.slice(0, 240))));
  lines.push(
    '',
    'Сверьте все страницы с фото. После подтверждения откроется Mini App для разделения. Разницу между итогом и позициями распределим пропорционально.'
  );
  return lines.join('\n');
};
