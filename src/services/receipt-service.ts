import { randomBytes } from 'crypto';
import { createWriteStream, promises as fs } from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { Transform } from 'stream';

import { createWorker } from 'tesseract.js';
import type { Message } from 'node-telegram-bot-api';

import { bot } from '../bot/bot';
import { config } from '../config';
import type { ParsedReceipt } from '../interfaces';
import { isReceiptValid, isTransientOcrError, logOcrError, parseReceiptText, sendToReceiptProcessor } from '../utils';
import { logger } from '../utils/logger';
import { metrics } from './metrics-service';

class Semaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  public constructor(private readonly limit: number) {}

  public async use<T>(operation: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      if (this.queue.length >= 8) throw new Error('OCR_BUSY');
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active += 1;
    try {
      return await operation();
    } finally {
      this.active -= 1;
      this.queue.shift()?.();
    }
  }
}

const ocrSemaphore = new Semaphore(config.ocr.maxConcurrent);
const tesseractSemaphore = new Semaphore(1);

export async function cleanupOrphanedPhotos(): Promise<void> {
  await fs.mkdir(config.storage.tempDir, { recursive: true });
  for (const entry of await fs.readdir(config.storage.tempDir, { withFileTypes: true })) {
    if (!entry.isFile() || !/^[a-f0-9]{32}\.(?:jpg|jpeg|png)$/i.test(entry.name)) continue;
    await fs.unlink(path.join(config.storage.tempDir, entry.name));
  }
}

export async function processReceiptPhoto(msg: Message): Promise<ParsedReceipt> {
  return ocrSemaphore.use(() => recognizePhoto(msg));
}
async function recognizePhoto(msg: Message): Promise<ParsedReceipt> {
  if (!msg.photo?.length) throw new Error('PHOTO_NOT_FOUND');
  const startedAt = Date.now();
  const fileId = msg.photo[msg.photo.length - 1].file_id;
  await fs.mkdir(config.storage.tempDir, { recursive: true });
  const fileInfo = await bot.getFile(fileId);
  if ((fileInfo.file_size || 0) > config.ocr.maxImageBytes) throw new Error('TELEGRAM_FILE_TOO_LARGE');
  const extension = path.extname(fileInfo.file_path || '') || '.jpg';
  const downloadPath = path.join(config.storage.tempDir, `${randomBytes(16).toString('hex')}${extension}`);

  try {
    await downloadTelegramFile(fileId, downloadPath);
    return await (async () => {
      let primaryError: unknown;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          const receipt = await sendToReceiptProcessor(downloadPath, config.ocr);
          if (isReceiptValid(receipt)) {
            metrics.increment('resplitter_ocr_primary_success_total');
            return receipt;
          }
          primaryError = new Error('OCR_LOW_CONFIDENCE');
        } catch (error) {
          primaryError = error;
          logOcrError(error, attempt);
          if (!isTransientOcrError(error)) break;
          await delay(250 * attempt + Math.floor(Math.random() * 150));
        }
      }

      metrics.increment('resplitter_ocr_primary_failure_total');
      if (!config.ocr.fallbackEnabled) throw primaryError;
      const fallback = await tesseractSemaphore.use(() => processWithTesseract(downloadPath));
      const parsed = parseReceiptText(fallback);
      metrics.increment('resplitter_ocr_fallback_total');
      if (!isReceiptValid(parsed)) throw new Error('OCR_UNREADABLE_RECEIPT');
      return parsed;
    })();
  } finally {
    metrics.observe('resplitter_receipt_processing', Date.now() - startedAt);
    await fs.unlink(downloadPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') logger.warn('Temporary receipt cleanup failed', { error });
    });
  }
}

const downloadTelegramFile = async (fileId: string, destination: string): Promise<void> => {
  let bytes = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > config.ocr.maxImageBytes) callback(new Error('TELEGRAM_FILE_TOO_LARGE'));
      else callback(null, chunk);
    }
  });
  await pipeline(bot.getFileStream(fileId), limiter, createWriteStream(destination, { mode: 0o600 }), {
    signal: AbortSignal.timeout(config.ocr.timeoutMs)
  });
};

const processWithTesseract = async (imagePath: string): Promise<string> => {
  let timedOut = false;
  let timer: NodeJS.Timeout | undefined;
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
  const task = (async () => {
    const created = await createWorker('rus+eng');
    if (timedOut) {
      await created.terminate();
      throw new Error('TESSERACT_TIMEOUT');
    }
    worker = created;
    return (await created.recognize(imagePath)).data.text;
  })();
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(new Error('TESSERACT_TIMEOUT'));
        }, config.ocr.timeoutMs * 2);
      })
    ]);
  } finally {
    clearTimeout(timer);
    await worker?.terminate().catch((error) => logger.warn('Tesseract termination failed', { error }));
  }
};

const delay = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));
