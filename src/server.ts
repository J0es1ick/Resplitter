import { createServer } from 'node:http';
import path from 'node:path';
import { bot, getBotUsername } from './bot/bot';
import { config } from './config';
import { stateService } from './services/state-service';
import { metrics } from './services/metrics-service';
import { createHttpHandler } from './http/app';
let ready = false;
export const setReady = (value: boolean): void => {
  ready = value;
};
export async function startHttpServer() {
  const handler = createHttpHandler({
    store: stateService,
    token: config.telegram.token,
    botUsername: getBotUsername,
    lookup: (chat, user) => bot.getChatMember(chat, user),
    miniAppUrl: config.miniAppUrl,
    webDir: path.resolve('dist/web'),
    webhookEnabled: config.telegram.updateMode === 'webhook',
    webhookSecret: config.telegram.webhookSecret,
    ready: () => ready,
    metrics: () => metrics.render() + '\n' + stateService.queueMetrics(),
    metricsToken: config.metricsToken
  });
  const server = createServer((req, res) => {
    void handler(req, res);
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.http.port, config.http.host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  return server;
}
