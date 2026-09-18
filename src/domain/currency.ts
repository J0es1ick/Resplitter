export const currencies = ['RUB', 'UZS', 'KZT', 'USD', 'EUR', 'GEL'] as const;
export type Currency = (typeof currencies)[number];
export const currencyLabels: Record<Currency, string> = { RUB: '₽', UZS: 'сум', KZT: '₸', USD: '$', EUR: '€', GEL: '₾' };
