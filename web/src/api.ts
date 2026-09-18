import type { SessionView } from '../../src/http/app';
export type { SessionView };
export class ApiError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}
const messages: Record<string, string> = {
  AUTH_EXPIRED: 'Время входа истекло. Закройте приложение и откройте его снова из бота.',
  UNAUTHORIZED: 'Откройте Mini App кнопкой в Telegram, чтобы войти.',
  SESSION_FORBIDDEN: 'У вас нет доступа к этому чеку. Попросите владельца прислать приглашение.',
  SESSION_NOT_FOUND: 'Чек больше не доступен. Возможно, срок хранения истёк.',
  SESSION_CONFLICT: 'Чек изменился. Данные обновлены: проверьте выбор и сохраните ещё раз.',
  SESSION_FINALIZED: 'Расчёт уже завершён. Изменения больше не принимаются.',
  UNASSIGNED_ITEMS: 'Сначала распределите все позиции между участниками.',
  RECEIPT_NOT_CONFIRMED: 'Владелец ещё не подтвердил распознанный чек.',
  INVALID_INPUT: 'Проверьте суммы и количество: значения должны быть положительными.',
  INVALID_QUANTITY: 'Укажите количество больше нуля, не более трёх знаков после запятой.',
  QUANTITY_EXCEEDED: 'Участники выбрали больше, чем есть в чеке. Проверьте количество и сохраните ещё раз; ваш ввод сохранён на экране.',
  RATE_LIMIT: 'Слишком много запросов. Подождите минуту.',
  MEMBERSHIP_UNAVAILABLE: 'Не удалось проверить участие в группе. Попробуйте позже.',
  INTERNAL_ERROR: 'Не удалось сохранить данные. Попробуйте ещё раз.'
};
export const errorMessage = (error: unknown) =>
  error instanceof ApiError
    ? messages[error.code] || messages.INTERNAL_ERROR
    : 'Нет связи с сервером. Проверьте интернет и попробуйте снова.';
export async function api<T>(path: string, initData: string, payload?: unknown): Promise<T> {
  const res = await fetch('/api' + path, {
    method: payload === undefined ? 'GET' : 'POST',
    headers: { authorization: 'tma ' + initData, ...(payload === undefined ? {} : { 'content-type': 'application/json' }) },
    body: payload === undefined ? undefined : JSON.stringify(payload),
    signal: AbortSignal.timeout(15000)
  });
  const data = await res.json();
  if (!res.ok) throw new ApiError(data.error || 'INTERNAL_ERROR');
  return data as T;
}
