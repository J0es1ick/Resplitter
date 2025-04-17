import TelegramBot from 'node-telegram-bot-api';
import { config } from '../config';

export const bot = new TelegramBot(config.telegram.token, {
  polling: config.server.isProduction ? false : true
});

export type BotInstance = typeof bot;
