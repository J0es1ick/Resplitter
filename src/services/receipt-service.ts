import fs from 'fs';
import https from 'https';
import path from 'path';

import { parseReceiptText } from '../utils/receipt-parser';
import { bot } from '../bot/bot';
import { createWorker } from 'tesseract.js';
import { Message } from 'node-telegram-bot-api';
import { config } from '../config';
import { sendToReceiptProcessor } from '../utils';
import { ParsedReceipt } from '../interfaces';

export async function processReceiptPhoto(msg: Message) {
  if (!msg.photo || msg.photo.length === 0) {
    throw new Error('No photo found in message');
  }

  const fileId = msg.photo[msg.photo.length - 1].file_id;
  const fileInfo = await bot.getFile(fileId);
  const fileUrl = `https://api.telegram.org/file/bot${config.telegram.token}/${fileInfo.file_path}`;
  const downloadPath = path.join('downloads', `${msg.chat.id}_${msg.message_id}.jpg`);

  if (!fs.existsSync(path.dirname(downloadPath))) {
    fs.mkdirSync(path.dirname(downloadPath), { recursive: true });
  }

  await downloadFile(fileUrl, downloadPath);

  try {
    let recognizedReceipt: ParsedReceipt | null = null;
    try {
      recognizedReceipt = await sendToReceiptProcessor(
        downloadPath,
        config.receiptProcessor.api,
        config.receiptProcessor.apiKey,
        config.receiptProcessor.folderId
      );
    } catch (error) {
      console.error('Ошибка основного сервиса обработки:', error);
    }

    if (!recognizedReceipt) {
      console.log('Основной сервис не вернул результатов, пробуем Tesseract...');
      const recognizedText = await processWithTesseract(downloadPath);
      recognizedReceipt = parseReceiptText(recognizedText);
    }

    return recognizedReceipt;
  } finally {
    cleanupFile(downloadPath);
  }
}

async function downloadFile(url: string, savePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const fileStream = fs.createWriteStream(savePath);

    https
      .get(url, (response) => {
        response.pipe(fileStream).on('finish', resolve).on('error', reject);
      })
      .on('error', reject);
  });
}

async function processWithTesseract(imagePath: string): Promise<string> {
  const worker = await createWorker('rus');
  try {
    const {
      data: { text }
    } = await worker.recognize(imagePath);
    return text;
  } finally {
    await worker.terminate();
  }
}

function cleanupFile(filePath: string): void {
  try {
    fs.existsSync(filePath) && fs.unlinkSync(filePath);
  } catch (error) {
    console.error('File cleanup error:', error);
  }
}
