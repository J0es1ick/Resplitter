import type { ParsedReceipt, ReceiptSession } from '../interfaces';

const normalized = (value: string) => value.normalize('NFKC').toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
const words = (value: string) =>
  new Set((normalized(value).match(/[a-zа-я]{2,}/gu) || []).filter((word) => !['порц', 'шт', 'мл'].includes(word)));
const sameName = (a: string, b: string): boolean => {
  const left = words(a),
    right = words(b);
  if (!left.size || !right.size) return normalized(a) === normalized(b);
  const overlap = [...left].filter((word) => right.has(word)).length;
  return overlap / Math.min(left.size, right.size) >= 0.8;
};

export function samePrintedReceipt(a: ParsedReceipt, b: ParsedReceipt): boolean {
  if (!/^\d{2}[./-]\d{2}[./-]\d{4}$/.test(a.date.trim()) || !/^\d{1,2}:\d{2}(?::\d{2})?$/.test(a.time.trim()) || !a.receiptNumber.trim())
    return false;
  if (
    (['receiptNumber', 'date', 'time'] as const).some((key) => normalized(a[key]) !== normalized(b[key])) ||
    a.currency !== b.currency ||
    a.totalMinor !== b.totalMinor ||
    a.totalMinor <= 0
  )
    return false;
  const left = a.items.filter((i) => i.lineTotalMinor > 0),
    right = b.items.filter((i) => i.lineTotalMinor > 0);
  if (!left.length || !right.length) return false;
  const used = new Set<number>();
  let matches = 0;
  for (const item of left) {
    const index = right.findIndex(
      (other, index) => !used.has(index) && item.lineTotalMinor === other.lineTotalMinor && sameName(item.name, other.name)
    );
    if (index >= 0) {
      matches++;
      used.add(index);
    }
  }
  return matches / Math.max(left.length, right.length) >= 0.8;
}

export function assertSafeDuplicateDraft(draft: ReceiptSession | undefined, target: ReceiptSession | undefined): void {
  if (
    !draft ||
    !target ||
    draft.id === target.id ||
    draft.status !== 'draft' ||
    target.status === 'draft' ||
    draft.ownerUserId !== target.ownerUserId ||
    draft.sourceChatId !== target.sourceChatId ||
    draft.inviteToken ||
    Date.parse(draft.expiresAt) > Date.parse(target.expiresAt) ||
    Object.values(draft.participants).some(
      (p) => p.userId !== draft.ownerUserId || p.itemIds.length || Object.keys(p.itemQuantities || {}).length
    ) ||
    !samePrintedReceipt(draft.receipt, target.receipt)
  )
    throw new Error('UNSAFE_DUPLICATE_LINK');
}
