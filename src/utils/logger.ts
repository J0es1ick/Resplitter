type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const secretKeys = /authorization|token|api[-_]?key|secret|content|image/i;
const redactText = (text: string): string =>
  text
    .replace(/\b\d{5,}:[A-Za-z0-9_-]{20,}\b/g, '[telegram-token]')
    .replace(/\b(?:Api-Key|Bearer|tma)\s+\S+/gi, '[authorization]')
    .replace(/https?:\/\/[^\s)]+/gi, '[url]')
    .slice(0, 1000);

const sanitize = (value: unknown, depth = 0): unknown => {
  if (depth > 5) return '[truncated]';
  if (value instanceof Error) return { name: value.name, message: redactText(value.message) };
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitize(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        secretKeys.test(key) ? '[redacted]' : sanitize(item, depth + 1)
      ])
    );
  }
  if (typeof value === 'string') return redactText(value);
  return value;
};

const write = (level: LogLevel, message: string, context?: Record<string, unknown>): void => {
  const payload = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(context ? { context: sanitize(context) } : {})
  });
  if (level === 'error') console.error(payload);
  else if (level === 'warn') console.warn(payload);
  else console.log(payload);
};

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => write('debug', message, context),
  info: (message: string, context?: Record<string, unknown>) => write('info', message, context),
  warn: (message: string, context?: Record<string, unknown>) => write('warn', message, context),
  error: (message: string, context?: Record<string, unknown>) => write('error', message, context)
};
