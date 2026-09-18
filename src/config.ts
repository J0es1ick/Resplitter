import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: [path.resolve(process.cwd(), '.env.runtime'), path.resolve(process.cwd(), '.env')], quiet: true });

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

const integer = (name: string, fallback: number, min: number, max: number): number => {
  const raw = process.env[name]?.trim();
  const value = raw ? Number(raw) : fallback;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
};

const boolean = (name: string, fallback: boolean): boolean => {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (['1', 'true', 'yes'].includes(raw)) return true;
  if (['0', 'false', 'no'].includes(raw)) return false;
  throw new Error(`${name} must be true or false`);
};

const environment = process.env.NODE_ENV?.trim() || 'development';
const isProduction = environment === 'production';
const miniAppUrl = process.env.MINI_APP_URL?.trim().replace(/\/$/, '') || '';
if (miniAppUrl) {
  const url = new URL(miniAppUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('MINI_APP_URL must be an HTTPS origin without a path, credentials or query');
  }
}
const updateMode = (process.env.TELEGRAM_UPDATE_MODE?.trim() || (isProduction ? 'webhook' : 'polling')) as 'polling' | 'webhook';

if (!['polling', 'webhook'].includes(updateMode)) throw new Error('TELEGRAM_UPDATE_MODE must be polling or webhook');

const webhookBaseUrl = process.env.WEBHOOK_BASE_URL?.trim().replace(/\/$/, '') || '';
const webhookSecret = process.env.WEBHOOK_SECRET?.trim() || '';

if (updateMode === 'webhook' && (!webhookBaseUrl || !webhookSecret)) {
  throw new Error('WEBHOOK_BASE_URL and WEBHOOK_SECRET are required in webhook mode');
}
if (updateMode === 'webhook' && (!/^https:\/\//i.test(webhookBaseUrl) || webhookSecret.length < 32)) {
  throw new Error('Webhook mode requires an HTTPS base URL and WEBHOOK_SECRET of at least 32 characters');
}

const ocrAuthScheme = process.env.OCR_AUTH_SCHEME?.trim() || 'Api-Key';
if (!['Api-Key', 'Bearer'].includes(ocrAuthScheme)) throw new Error('OCR_AUTH_SCHEME must be Api-Key or Bearer');
if (isProduction && (!process.env.API_KEY?.trim() || !process.env.API_FOLDER_KEY?.trim())) {
  throw new Error('API_KEY and API_FOLDER_KEY are required in production');
}

export const config = {
  environment,
  isProduction,
  miniAppUrl,
  metricsToken: process.env.METRICS_TOKEN?.trim() || '',
  demoEnabled: boolean('ENABLE_DEMO_COMMAND', !isProduction),
  telegram: {
    token: required('TELEGRAM_TOKEN'),
    updateMode,
    webhookBaseUrl,
    webhookSecret
  },
  http: {
    host: process.env.HOST?.trim() || (isProduction ? '0.0.0.0' : '127.0.0.1'),
    port: integer('PORT', 43127, 1024, 65535)
  },
  ocr: {
    api: process.env.RECEIPT_PROCESSOR_API?.trim() || 'https://ocr.api.cloud.yandex.net/ocr/v1/recognizeText',
    apiKey: process.env.API_KEY?.trim() || '',
    folderId: process.env.API_FOLDER_KEY?.trim() || '',
    authScheme: ocrAuthScheme as 'Api-Key' | 'Bearer',
    allowProviderDataLogging: boolean('OCR_ALLOW_DATA_LOGGING', false),
    fallbackEnabled: boolean('OCR_FALLBACK_ENABLED', !isProduction),
    enhancedRetryEnabled: boolean('OCR_ENHANCED_RETRY', true),
    timeoutMs: integer('OCR_TIMEOUT_MS', 20_000, 1_000, 120_000),
    maxConcurrent: integer('OCR_MAX_CONCURRENT', 2, 1, 8),
    maxImageBytes: integer('OCR_MAX_IMAGE_BYTES', 12 * 1024 * 1024, 1024, 20 * 1024 * 1024)
  },
  storage: {
    databaseFile: path.resolve(process.env.DATABASE_FILE?.trim() || 'data/resplitter.sqlite'),
    stateFile: path.resolve(process.env.STATE_FILE?.trim() || 'data/runtime-state.json'),
    tempDir: path.resolve(process.env.TEMP_DIR?.trim() || 'data/tmp'),
    sessionTtlMs: integer('SESSION_TTL_MS', 24 * 60 * 60 * 1000, 60_000, 30 * 24 * 60 * 60 * 1000)
  },
  limits: {
    maxItems: integer('MAX_RECEIPT_ITEMS', 100, 1, 500),
    maxItemNameLength: integer('MAX_ITEM_NAME_LENGTH', 120, 10, 500),
    maxPeople: integer('MAX_PEOPLE_COUNT', 100, 2, 1000)
  }
} as const;

export type AppConfig = typeof config;
