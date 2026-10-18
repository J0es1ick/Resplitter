import TelegramBot from 'node-telegram-bot-api';

export function createOutboxBot(token: string, fetch?: typeof globalThis.fetch): TelegramBot {
  return new TelegramBot(token, { polling: false, request: { timeoutMs: 20000, maxRetriesOn429: 0, fetch } });
}
