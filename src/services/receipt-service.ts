import fs from 'fs';
import FormData from 'form-data';
import https from 'https';
import path from 'path';
import axios from 'axios';
import { parseReceiptText } from '../utils/receipt-parser';
import { bot } from '../bot/bot';
import { createWorker } from 'tesseract.js';
import { Message } from 'node-telegram-bot-api';
import { config } from '../config';

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
    try {
      const externalResult = await processWithExternalService(downloadPath);
      return parseReceiptText(externalResult);
    } catch (externalError) {
      console.error('Ошибка процессора чеков:', externalError);
      const worker = await createWorker('rus');
      try {
        const {
          data: { text }
        } = await worker.recognize(downloadPath);
        return parseReceiptText(text);
      } finally {
        await worker.terminate();
      }
    }
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

async function processWithExternalService(imagePath: string): Promise<string> {
  const formData = new FormData();
  formData.append('image', fs.createReadStream(imagePath));

  const response = await axios.post(config.receiptProcessor.uploadEndpoint, formData, {
    headers: {
      ...formData.getHeaders(),
      Accept: 'application/json'
    },
    timeout: 10000
  });

  if (!response.data?.text) {
    throw new Error('No text received from external service');
  }

  return response.data.text;
}

function cleanupFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (unlinkError) {
    console.error('Ошибка при удалении файла:', unlinkError);
  }
}
