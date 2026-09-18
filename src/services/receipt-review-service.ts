import { randomBytes } from 'node:crypto';
import type { StateService } from './state-service';
import type { ParsedReceipt, ReceiptItem, ReceiptSession } from '../interfaces';
import { parseMoneyToMinor, calculateSubtotal, formatMoney } from '../utils/money';

function reviewFields(text: string): string[] {
  const value = text.trim();
  if (value.length > 512) throw new Error('INVALID_ITEM_INPUT');
  if (/[|;]/.test(value)) return value.split(/[|;]/).map((part) => part.trim());
  if (/[\n\r]/.test(value)) return value.split(/\r?\n/).map((part) => part.trim());
  const punctuated = /^(.+?)[,.]\s+(\d(?:[\d.,\u00a0\u202f ]*\d)?)[,.]\s+(\d+(?:[.,]\d{1,3})?)$/u.exec(value);
  if (punctuated) return punctuated.slice(1);
  const compact = /^([^,.]+)[,.](\d+)[,.](\d+)$/u.exec(value);
  if (compact) return compact.slice(1).map((part) => part.trim());
  const spaced = /^(.+?)\s+(\d+(?:[.,]\d{1,2})?)\s+(\d+(?:[.,]\d{1,3})?)$/u.exec(value);
  if (spaced) {
    if (/\s\d{1,3}$/.test(spaced[1]) && /^\d{3}(?:[.,]\d{1,2})?$/.test(spaced[2])) throw new Error('INVALID_ITEM_INPUT');
    return spaced.slice(1);
  }
  throw new Error('INVALID_ITEM_INPUT');
}

export function parseReviewItem(text: string, id = randomBytes(9).toString('base64url')): ReceiptItem {
  const fields = reviewFields(text).map((field) => field.trim());
  if (fields.length !== 3 || !fields[0] || fields[0].length > 120) throw new Error('INVALID_ITEM_INPUT');
  const total = parseMoneyToMinor(fields[1]);
  const quantity = /^\d+(?:[.,]\d{1,3})?$/.test(fields[2]) ? Number(fields[2].replace(',', '.')) : NaN;
  if (total === undefined || !Number.isFinite(quantity) || quantity <= 0 || quantity > 10000 || Math.round(total / quantity) > 100_000_000)
    throw new Error('INVALID_ITEM_INPUT');
  return { id, name: fields[0], quantity, lineTotalMinor: total, unitPriceMinor: Math.round(total / quantity), confidence: 1 };
}

export class ReceiptReviewService {
  constructor(private readonly store: StateService) {}
  public async revise(id: string, userId: number, version: number, update: (receipt: ParsedReceipt) => void): Promise<ReceiptSession> {
    return this.store.updateSession(
      id,
      (s) => {
        update(s.receipt);
        s.receipt.subtotalMinor = calculateSubtotal(s.receipt.items);
        if (s.receipt.subtotalMinor > 100_000_000) throw new Error('INVALID_ITEM_INPUT');
        s.receipt.warnings = s.receipt.warnings.filter(
          (w) => !w.startsWith('Сумма позиций отличается от итога') && !w.startsWith('Проверьте количество и цену')
        );
        const delta = s.receipt.totalMinor - s.receipt.subtotalMinor;
        if (delta)
          s.receipt.warnings.push(
            `Сумма позиций отличается от итога на ${formatMoney(Math.abs(delta), s.receipt.currency)}. Проверьте скидки, обслуживание и пропущенные позиции.`
          );
        const uncertain = s.receipt.items.map((item, i) => ((item.confidence ?? 1) < 0.8 ? i + 1 : 0)).filter(Boolean);
        if (uncertain.length) s.receipt.warnings.push('Проверьте количество и цену в позициях: ' + uncertain.join(', ') + '.');
        s.receipt.warnings = s.receipt.warnings.slice(-20);
        s.status = 'draft';
        for (const participant of Object.values(s.participants)) {
          participant.itemIds = [];
          participant.itemQuantities = {};
        }
      },
      { actorUserId: userId, ownerOnly: true, expectedVersion: version }
    );
  }
  public async confirm(id: string, userId: number, version: number): Promise<ReceiptSession> {
    return this.store.updateSession(
      id,
      (s) => {
        if (!s.receipt.items.length || s.receipt.totalMinor <= 0) throw new Error('EMPTY_RECEIPT');
        s.status = 'open';
      },
      { actorUserId: userId, ownerOnly: true, expectedVersion: version }
    );
  }
}
