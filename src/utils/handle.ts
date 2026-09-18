import axios from 'axios';
import { promises as fs } from 'fs';
import path from 'path';

import type { OCRResponse, ParsedReceipt } from '../interfaces';
import { logger } from './logger';
import { parseReceiptText } from './receipt-parser';
import { reconstructReceiptRows as extractTextFromOcrResponse } from './ocr-layout';
import { prepareOcrRetry } from './ocr-preprocess';
import { combineOcrCandidates, needsOcrRetry } from './ocr-candidates';

export interface OcrRequestOptions {
  api: string;
  apiKey: string;
  folderId: string;
  authScheme: 'Api-Key' | 'Bearer';
  allowProviderDataLogging: boolean;
  timeoutMs: number;
  maxImageBytes: number;
  enhancedRetryEnabled?: boolean;
}

export async function recognizeReceiptImage(
  imagePath: string,
  options: OcrRequestOptions,
  model: 'page' | 'table' = 'page'
): Promise<OCRResponse> {
  const file = await fs.stat(imagePath);
  if (!file.isFile()) throw new Error('OCR_IMAGE_NOT_FOUND');
  if (file.size > options.maxImageBytes) throw new Error('OCR_IMAGE_TOO_LARGE');
  if (!options.apiKey || !options.folderId) throw new Error('OCR_NOT_CONFIGURED');

  const content = await fs.readFile(imagePath);
  const extension = path.extname(imagePath).toLowerCase();
  const mimeType = extension === '.png' ? 'PNG' : extension === '.pdf' ? 'PDF' : 'JPEG';
  return recognizeReceiptContent(content, mimeType, options, model);
}

export async function recognizeReceiptContent(
  content: Buffer,
  mimeType: string,
  options: OcrRequestOptions,
  model: 'page' | 'table' = 'page'
): Promise<OCRResponse> {
  if (content.length > options.maxImageBytes) throw new Error('OCR_IMAGE_TOO_LARGE');
  if (!options.apiKey || !options.folderId) throw new Error('OCR_NOT_CONFIGURED');
  const response = await axios.post<OCRResponse>(
    options.api,
    {
      mimeType,
      languageCodes: ['ru', 'en'],
      model,
      content: content.toString('base64')
    },
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `${options.authScheme} ${options.apiKey}`,
        'x-folder-id': options.folderId,
        'x-data-logging-enabled': String(options.allowProviderDataLogging)
      },
      timeout: options.timeoutMs,
      maxRedirects: 0,
      maxBodyLength: options.maxImageBytes * 2,
      maxContentLength: 10 * 1024 * 1024,
      validateStatus: (status) => status >= 200 && status < 300
    }
  );

  return response.data;
}

export async function sendToReceiptProcessor(imagePath: string, options: OcrRequestOptions): Promise<ParsedReceipt> {
  const response = await recognizeReceiptImage(imagePath, options);
  const text = extractTextFromOcrResponse(response);
  if (!text) throw new Error('OCR_EMPTY_RESPONSE');
  const primary = parseReceiptText(text);
  if (options.enhancedRetryEnabled !== false && needsOcrRetry(primary)) {
    try {
      const content = await prepareOcrRetry(imagePath, response);
      const enhanced = await recognizeReceiptContent(content, 'JPEG', options);
      return combineOcrCandidates(primary, parseReceiptText(extractTextFromOcrResponse(enhanced)));
    } catch {
      logger.warn('Optional OCR enhancement unavailable');
    }
  }
  return primary;
}

export { reconstructReceiptRows as extractTextFromOcrResponse } from './ocr-layout';

export const isTransientOcrError = (error: unknown): boolean => {
  if (!axios.isAxiosError(error)) return false;
  const status = error.response?.status;
  return !status || status === 408 || status === 429 || status >= 500;
};

export const logOcrError = (error: unknown, attempt: number): void => {
  if (axios.isAxiosError(error)) {
    logger.warn('OCR request failed', {
      attempt,
      status: error.response?.status,
      code: error.code,
      message: error.message
    });
    return;
  }
  logger.warn('OCR processing failed', { attempt, error });
};
