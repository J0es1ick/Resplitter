import type { ParsedReceipt } from '../interfaces';

const uncertain = (r: ParsedReceipt) => r.items.filter((i) => (i.confidence ?? 0) < 0.8);
export function needsOcrRetry(r: ParsedReceipt): boolean {
  return (
    !r.items.length ||
    uncertain(r).length > 0 ||
    r.warnings.some((w) => w.startsWith('Итог рассчитан')) ||
    (r.totalMinor !== r.subtotalMinor && !r.warnings.some((w) => w.startsWith('В чеке есть скидка')))
  );
}
const canonicalName = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]/g, '');
export function combineOcrCandidates(primary: ParsedReceipt, secondary: ParsedReceipt): ParsedReceipt {
  if (
    primary.currency === secondary.currency &&
    primary.totalMinor === secondary.totalMinor &&
    primary.items.length === secondary.items.length &&
    primary.items.every((p, i) => p.lineTotalMinor === secondary.items[i].lineTotalMinor)
  ) {
    const result = structuredClone(primary);
    result.items = result.items.map((p, i) => {
      const s = secondary.items[i];
      return (p.confidence ?? 0) < 0.8 && (s.confidence ?? 0) >= 0.8 && canonicalName(p.name) === canonicalName(s.name)
        ? { ...p, quantity: s.quantity, unitPriceMinor: s.unitPriceMinor, confidence: s.confidence }
        : p;
    });
    result.warnings = result.warnings.filter((w) => !w.startsWith('Проверьте количество и цену'));
    const missing = uncertain(result);
    if (missing.length)
      result.warnings.push(
        'Проверьте количество и цену в позициях: ' +
          missing.map((i) => result.items.indexOf(i) + 1).join(', ') +
          '. Недостающие количества временно приняты за 1.'
      );
    return result;
  }
  if (
    (!primary.items.length || primary.confidence < 0.45 || primary.totalMinor !== primary.subtotalMinor) &&
    secondary.items.length > 0 &&
    secondary.totalMinor === secondary.subtotalMinor &&
    secondary.confidence > primary.confidence
  ) {
    return {
      ...secondary,
      warnings: ['Повторное распознавание дало другой результат. Обязательно сверьте позиции и итог с фото.', ...secondary.warnings].slice(
        0,
        20
      )
    };
  }
  return primary;
}
