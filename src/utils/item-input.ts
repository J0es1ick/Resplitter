import { parseMoneyToMinor } from './money';

export interface ParsedItemInput {
  name: string;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
}

const MONEY_INPUT = String.raw`\d[\d\s\u00a0\u202f]*(?:[.,]\d{1,2})?`;

export const parseItemInput = (text: string, maxNameLength = 120): ParsedItemInput | undefined => {
  let parsed: [name: string, price: string, quantity: string];
  const pipeParts = text
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean);

  if (pipeParts.length === 2 || pipeParts.length === 3) {
    parsed = [pipeParts[0], pipeParts[1], pipeParts[2] || '1'];
  } else {
    const match = text.trim().match(new RegExp(`^(.+?)\\s+(${MONEY_INPUT})(?:\\s+(\\d+(?:[.,]\\d+)?))?$`));
    if (!match) return undefined;
    parsed = [match[1].trim(), match[2], match[3] || '1'];
  }

  const [name, priceRaw, quantityRaw] = parsed;
  const unitPriceMinor = parseMoneyToMinor(priceRaw);
  const quantity = Number(quantityRaw.replace(',', '.'));
  if (!name || name.length > maxNameLength || !/[a-zа-яё]/i.test(name)) return undefined;
  if (unitPriceMinor === undefined || unitPriceMinor <= 0) return undefined;
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 10_000) return undefined;
  const lineTotalMinor = Math.round(unitPriceMinor * quantity);
  if (!Number.isSafeInteger(lineTotalMinor) || lineTotalMinor <= 0) return undefined;
  return { name, quantity, unitPriceMinor, lineTotalMinor };
};
