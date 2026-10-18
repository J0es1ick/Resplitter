import TelegramBot from 'node-telegram-bot-api';
import { config } from '../config';
import { createOutboxBot } from './outbox-bot';

export const bot = new TelegramBot(config.telegram.token, { polling: false, request: { timeoutMs: 20000, maxRetriesOn429: 1 } });
export const outboxBot = createOutboxBot(config.telegram.token);
let botUsername = '';
export const setBotUsername = (username: string): void => {
  botUsername = username;
};
export const getBotUsername = (): string => {
  if (!botUsername) throw new Error('BOT_IDENTITY_NOT_INITIALIZED');
  return botUsername;
};
export type BotInstance = typeof bot;
