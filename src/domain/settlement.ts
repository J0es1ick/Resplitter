import type { ReceiptSession } from '../interfaces/receipt-session';
import { quantityUnits } from './quantity';

export interface Settlement {
  participants: Array<{ userId: number; displayName: string; itemsMinor: number; adjustmentMinor: number; totalMinor: number }>;
  itemShares: Record<string, Record<string, number>>;
  unassignedItemIds: string[];
  unassignedMinor: number;
  remainingQuantities: Record<string, number>;
  overallocatedItemIds: string[];
  adjustmentMinor: number;
  canFinalize: boolean;
  totalMinor: number;
}

export function allocateWeighted(total: number, weights: number[]): number[] {
  if (!Number.isSafeInteger(total) || total < 0 || weights.some((w) => !Number.isSafeInteger(w) || w < 0))
    throw new Error('INVALID_AMOUNT');
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!sum) return weights.map(() => 0);
  const parts = weights.map((w, index) => ({
    index,
    amount: Number((BigInt(total) * BigInt(w)) / BigInt(sum)),
    remainder: (BigInt(total) * BigInt(w)) % BigInt(sum)
  }));
  let left = total - parts.reduce((a, p) => a + p.amount, 0);
  for (const part of [...parts].sort((a, b) => (a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1))) {
    if (left-- > 0) part.amount++;
  }
  return parts.map((p) => p.amount);
}

export function calculateSettlement(session: Pick<ReceiptSession, 'participants' | 'receipt' | 'splitMode' | 'status'>): Settlement {
  const participants = Object.values(session.participants).sort((a, b) => a.userId - b.userId);
  const amounts = participants.map(() => 0);
  const itemShares: Settlement['itemShares'] = {};
  const unassignedItemIds: string[] = [];
  const remainingQuantities: Record<string, number> = {};
  const overallocatedItemIds: string[] = [];
  let unassignedMinor = 0;
  for (const item of session.receipt.items) {
    const selected = participants.map((p, i) => (p.itemIds.includes(item.id) ? i : -1)).filter((i) => i >= 0);
    itemShares[item.id] = {};
    const units = quantityUnits(item.quantity);
    const explicit = selected.map((i) => {
      const quantities = participants[i].itemQuantities;
      return quantities && Object.hasOwn(quantities, item.id) ? quantityUnits(quantities[item.id]) : 0;
    });
    const claimed = explicit.reduce((a, b) => a + b, 0);
    if (claimed > units) {
      overallocatedItemIds.push(item.id);
      continue;
    }
    const sharedCount = explicit.filter((q) => q === 0).length;
    const remaining = units - claimed;
    remainingQuantities[item.id] = sharedCount ? 0 : remaining / 1000;
    if (!sharedCount && remaining > 0 && item.lineTotalMinor > 0) unassignedItemIds.push(item.id);
    const weights = explicit.map((q) => (q ? q * Math.max(1, sharedCount) : remaining));
    const unassignedWeight = sharedCount ? 0 : remaining;
    allocateWeighted(item.lineTotalMinor, [...weights, unassignedWeight]).forEach((amount, i) => {
      if (i === selected.length) {
        unassignedMinor += amount;
        return;
      }
      amounts[selected[i]] += amount;
      itemShares[item.id][participants[selected[i]].userId] = amount;
    });
  }
  const equal = session.splitMode === 'equal';
  if (equal) {
    const base = allocateWeighted(
      session.receipt.subtotalMinor,
      participants.map(() => 1)
    );
    base.forEach((amount, index) => {
      amounts[index] = amount;
    });
  }
  const weights = equal ? participants.map(() => 1) : amounts;
  const complete =
    participants.length > 0 &&
    (equal || (unassignedItemIds.length === 0 && overallocatedItemIds.length === 0)) &&
    weights.some((w) => w > 0);
  const totals = complete ? allocateWeighted(session.receipt.totalMinor, weights) : amounts;
  return {
    participants: participants.map((p, i) => ({
      userId: p.userId,
      displayName: p.displayName,
      itemsMinor: amounts[i],
      adjustmentMinor: complete ? totals[i] - amounts[i] : 0,
      totalMinor: totals[i]
    })),
    itemShares,
    unassignedItemIds: equal ? [] : unassignedItemIds,
    unassignedMinor: equal ? 0 : unassignedMinor,
    remainingQuantities: equal ? {} : remainingQuantities,
    overallocatedItemIds: equal ? [] : overallocatedItemIds,
    adjustmentMinor: session.receipt.totalMinor - session.receipt.subtotalMinor,
    canFinalize: complete && session.status === 'open',
    totalMinor: session.receipt.totalMinor
  };
}
