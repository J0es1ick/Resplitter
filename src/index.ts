import type { Server } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import type { Update } from 'node-telegram-bot-api';
import { bot, setBotUsername } from './bot/bot';
import { config } from './config';
import { handleCallback } from './handlers/callback-handler';
import { handlePhoto } from './handlers/photo-handler';
import { handleStart } from './handlers/start-handlers';
import { handleText } from './handlers/text-handler';
import { setReady, startHttpServer } from './server';
import { stateService } from './services/state-service';
import { cleanupOrphanedPhotos } from './services/receipt-service';
import { acquireInstanceLock } from './services/instance-lock';
import { metrics } from './services/metrics-service';
import { logger } from './utils/logger';
import { RateLimit } from './security/rate-limit';
import { backKeyboard } from './utils/bot-navigation';
import { screens } from './bot/screens';
import { notificationOutcome } from './services/notification-delivery';

let server: Server | undefined;
let stopping = false;
let releaseLock: (() => void) | undefined;
let maintenance: NodeJS.Timeout | undefined;
const tasks: Promise<void>[] = [];
const controller = new AbortController();
const pause = (ms: number) => delay(ms, undefined, { signal: controller.signal }).catch(() => undefined);
const messages = new RateLimit(30, 60000);
let lastPoll = Date.now();

async function dispatch(update: Update): Promise<void> {
  const msg = update.message;
  if (update.callback_query) {
    await handleCallback(update.callback_query);
    return;
  }
  if (!msg || !msg.from || msg.from.is_bot) return;
  if (!messages.allow(String(msg.from.id))) return;
  if (msg.photo?.length) {
    await handlePhoto(msg);
    return;
  }
  if (/^\/(start|app|demo)(?:@\w+)?(?:\s|$)/i.test(msg.text || '')) await handleStart(msg);
  else await handleText(msg);
}
async function consume(): Promise<void> {
  while (!stopping) {
    const entry = stateService.nextUpdate();
    if (!entry) {
      await pause(200);
      continue;
    }
    try {
      await dispatch(entry.update);
      stateService.finishUpdate(entry.id);
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      if (['SESSION_FORBIDDEN', 'SESSION_NOT_FOUND', 'SESSION_FINALIZED', 'PARTICIPANT_LIMIT'].includes(code)) {
        const chatId = entry.update.message?.chat.id || entry.update.callback_query?.message?.chat.id;
        const userId = entry.update.message?.from?.id || entry.update.callback_query?.from.id;
        if (chatId && userId)
          await screens
            .show(chatId, userId, 'Чек недоступен: проверьте приглашение, участие в группе и срок действия.', {
              reply_markup: backKeyboard
            })
            .catch(() => undefined);
        stateService.finishUpdate(entry.id);
      } else {
        logger.error('Update processing failed', { updateId: entry.id, attempt: entry.attempts, error });
        metrics.increment('resplitter_update_errors_total');
        stateService.finishUpdate(entry.id, true);
        await pause(2000 * entry.attempts);
      }
    }
  }
}
async function deliver(): Promise<void> {
  while (!stopping) {
    const entry = stateService.nextNotification();
    if (!entry) {
      await pause(500);
      continue;
    }
    try {
      await bot.sendMessage(entry.chat_id, entry.body + '\n\nПросмотр чеков: /app');
      stateService.notificationAttempt(entry.id, { status: 'sent' });
    } catch (error) {
      stateService.notificationAttempt(entry.id, notificationOutcome(error));
      metrics.increment('resplitter_notification_errors_total');
      logger.error('Final notification delivery failed', { notificationId: entry.id, error });
    }
  }
}
async function poll(): Promise<void> {
  while (!stopping) {
    try {
      const updates = await bot.getUpdates({
        offset: stateService.getOffset(),
        timeout: 10,
        limit: 50,
        allowed_updates: ['message', 'callback_query']
      });
      for (const update of updates) stateService.enqueue(update);
      if (updates.length) stateService.setOffset(Math.max(...updates.map((u) => u.update_id)) + 1);
      lastPoll = Date.now();
      setReady(!stopping);
    } catch (error) {
      metrics.increment('resplitter_telegram_errors_total');
      logger.error('Telegram polling failed', { error });
      if (Date.now() - lastPoll > 60000) setReady(false);
      await pause(5000);
    }
  }
}
async function start(): Promise<void> {
  if (!config.miniAppUrl) throw new Error('MINI_APP_URL is required; use an HTTPS origin for Telegram');
  releaseLock = acquireInstanceLock(config.storage.databaseFile + '.lock');
  await stateService.initialize();
  stateService.importLegacy(config.storage.stateFile);
  await cleanupOrphanedPhotos();
  const identity = await bot.getMe();
  setBotUsername(identity.username || '');
  server = await startHttpServer();
  await bot.setMyCommands([
    { command: 'start', description: 'Загрузить чек и начать' },
    { command: 'app', description: 'Мои чеки: открытые и закрытые' },
    { command: 'info', description: 'Как разделить чек' },
    { command: 'group', description: 'Разделить чек компанией' },
    { command: 'back', description: 'Назад в главное меню' },
    { command: 'cancel', description: 'Отменить ввод и вернуться' },
    { command: 'privacy', description: 'Данные и срок хранения' },
    ...(config.demoEnabled ? [{ command: 'demo', description: 'Тестовый чек без фотографии' }] : [])
  ]);
  await bot.setChatMenuButton({ menu_button: { type: 'web_app', text: 'Mini App', web_app: { url: config.miniAppUrl + '/app/' } } });
  if (config.telegram.updateMode === 'webhook') {
    await bot.setWebhook(config.telegram.webhookBaseUrl + '/telegram/webhook', {
      secret_token: config.telegram.webhookSecret,
      allowed_updates: ['message', 'callback_query']
    });
  } else {
    await bot.deleteWebhook({ drop_pending_updates: false });
    tasks.push(poll());
  }
  tasks.push(consume(), deliver());
  for (const task of tasks)
    void task.catch((error) => {
      logger.error('Background worker stopped', { error });
      void shutdown('workerFailure', 1);
    });
  maintenance = setInterval(() => {
    void stateService.cleanupExpired().catch((error) => {
      logger.error('Retention cleanup failed', { error });
      void shutdown('storeFailure', 1);
    });
    if (config.telegram.updateMode === 'polling' && Date.now() - lastPoll > 60000) setReady(false);
  }, 30000);
  setReady(true);
  logger.info('Resplitter started', {
    environment: config.environment,
    updateMode: config.telegram.updateMode,
    bot: identity.username,
    port: config.http.port
  });
}
async function shutdown(reason: string, exitCode = 0): Promise<void> {
  if (stopping) return;
  stopping = true;
  setReady(false);
  controller.abort();
  clearInterval(maintenance);
  logger.info('Shutdown started', { reason });
  const deadline = setTimeout(() => process.exit(1), 90000);
  deadline.unref();
  try {
    if (server) await new Promise<void>((resolve, reject) => server!.close((e) => (e ? reject(e) : resolve())));
    await Promise.allSettled(tasks);
    await stateService.close();
    releaseLock?.();
    clearTimeout(deadline);
    process.exit(exitCode);
  } catch (error) {
    logger.error('Shutdown failed', { error });
    process.exit(1);
  }
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', (error) => {
  logger.error('Unhandled rejection', { error });
  void shutdown('unhandledRejection', 1);
});
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error });
  void shutdown('uncaughtException', 1);
});
void start().catch((error) => {
  logger.error('Startup failed', { error });
  void shutdown('startupFailure', 1);
});
