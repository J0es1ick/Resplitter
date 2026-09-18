import { currencyLabels, type Currency } from '../domain/currency';
const MAX_MONEY_MINOR = 100_000_000;

export const parseMoneyToMinor = (input: string): number | undefined => {
  const valueText = input
    .trim()
    .replace(/\s*(?:RUB|руб\.?|₽)$/i, '')
    .trim();
  const patterns = [
    /^\d+(?:[.,]\d{1,2})?$/,
    /^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/,
    /^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/,
    /^\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:[.,]\d{1,2})?$/
  ];
  if (!patterns.some((pattern) => pattern.test(valueText))) return undefined;
  let normalized = valueText.replace(/[\u00a0\u202f ]/g, '');

  if (!normalized || !/\d/.test(normalized)) return undefined;
  const comma = normalized.lastIndexOf(',');
  const dot = normalized.lastIndexOf('.');
  const separator = Math.max(comma, dot);

  if (separator >= 0) {
    const fractionLength = normalized.length - separator - 1;
    if (fractionLength === 1 || fractionLength === 2) {
      const integerPart = normalized.slice(0, separator).replace(/[.,]/g, '');
      const fractionPart = normalized.slice(separator + 1).padEnd(2, '0');
      normalized = `${integerPart}.${fractionPart}`;
    } else {
      normalized = normalized.replace(/[.,]/g, '');
    }
  }

  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) return undefined;
  const minor = Math.round(value * 100);
  return Number.isSafeInteger(minor) && minor <= MAX_MONEY_MINOR ? minor : undefined;
};

export const formatMoney = (minor: number, currency: Currency = 'RUB'): string => `${(minor / 100).toFixed(2)} ${currencyLabels[currency]}`;

export const allocateEvenly = (totalMinor: number, people: number): number[] => {
  if (!Number.isSafeInteger(totalMinor) || totalMinor < 0) throw new Error('Invalid total amount');
  if (!Number.isInteger(people) || people < 1) throw new Error('Invalid people count');
  const base = Math.floor(totalMinor / people);
  const remainder = totalMinor % people;
  return Array.from({ length: people }, (_, index) => base + (index < remainder ? 1 : 0));
};

export const calculateSubtotal = (items: Array<{ lineTotalMinor: number }>): number =>
  items.reduce((sum, item) => sum + item.lineTotalMinor, 0);
