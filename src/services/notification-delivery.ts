export type NotificationOutcome =
  | { status: 'sent' }
  | { status: 'retry'; retryAfterMs?: number; error?: string }
  | { status: 'failed'; error?: string };

type TelegramFailure = {
  message?: string;
  response?: { statusCode?: number; body?: { parameters?: { retry_after?: number } } };
};

function failure(value: unknown): TelegramFailure {
  return typeof value === 'object' && value !== null ? (value as TelegramFailure) : {};
}

export function notificationOutcome(error: unknown): NotificationOutcome {
  const details = failure(error);
  const status = details.response?.statusCode;
  const message = details.message || (error instanceof Error ? error.message : 'DELIVERY_ERROR');
  if (status === 400 || status === 401 || status === 403 || status === 404) return { status: 'failed', error: message };
  const retryAfter = details.response?.body?.parameters?.retry_after;
  if (status === 429 && typeof retryAfter === 'number' && retryAfter > 0)
    return { status: 'retry', retryAfterMs: retryAfter * 1000, error: message };
  return { status: 'retry', error: message };
}