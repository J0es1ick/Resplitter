export function quantityUnits(quantity: number): number {
  const units = Math.round(quantity * 1000);
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 10000 || Math.abs(quantity * 1000 - units) > 1e-7)
    throw new Error('INVALID_QUANTITY');
  return units;
}
