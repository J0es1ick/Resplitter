import 'dotenv/config';
import 'reflect-metadata';
import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs';
import path from 'path';
import https from 'https';

import { createWorker } from 'tesseract.js';
import { connection } from './utils/db';
import { parseReceiptText } from './utils/receipt-parser';
import { getUser } from './utils/get-user';
import { sendToReceiptProcessor } from './utils/handle';

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN!, { polling: true });

const RECEIPT_PROCESSOR_API = process.env.RECEIPT_PROCESSOR_API!;
const API_UPLOAD_ENDPOINT = `${RECEIPT_PROCESSOR_API}/upload`;
const API_RESULT_ENDPOINT = `${RECEIPT_PROCESSOR_API}/result`;

const commands = [
  { command: '/start', description: 'начальное приветствие' },
  {
    command: '/info',
    description: 'получить информацию обо всех доступных командах'
  }
];

const start = async () => {
  bot.setMyCommands(commands);

  connection.initialize().catch((error) => console.log(error));
  const worker = await createWorker('rus');

  bot.on('message', async (msg) => {
    const text: string | undefined = msg.text;
    const options = {
      chatId: msg.chat.id,
      tgId: msg.from!.id,
      message_id: msg.message_id
    };
    const user = await getUser(options.chatId, options.tgId);

    if (msg.photo) {
      try {
        const fileId = msg.photo[msg.photo.length - 1].file_id;
        const fileInfo = await bot.getFile(fileId);
        const filePath = fileInfo.file_path;
        const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN!}/${filePath}`;

        const downloadPath = path.join('downloads', `${options.chatId}_${options.message_id}.jpg`);
        const downloadDir = path.dirname(downloadPath);
        if (!fs.existsSync(downloadDir)) {
          fs.mkdirSync(downloadDir, { recursive: true });
        }

        https
          .get(fileUrl, (response) => {
            const fileStream = fs.createWriteStream(downloadPath);
            response.pipe(fileStream);

            fileStream.on('finish', async () => {
              fileStream.close();
              console.log(`Фотография сохранена в: ${downloadPath}`);

              try {
                const {
                  data: { text: ocrText }
                } = await worker.recognize(downloadPath);

                let processorText = '';
                try {
                  processorText = await sendToReceiptProcessor(
                    downloadPath,
                    msg.message_id.toString(),
                    API_UPLOAD_ENDPOINT,
                    API_RESULT_ENDPOINT
                  );
                } catch (processorError) {
                  console.error('Ошибка процессора чеков:', processorError);
                  processorText = 'Не удалось обработать чек через сервис. Используем OCR:\n\n' + ocrText;
                }

                //const responseText = processorText.includes('Не удалось обработать') ? processorText : `Текст из чека:\n\n${processorText}`;

                const parsedReceipt = parseReceiptText(ocrText);

                let responseText = `Чек #${parsedReceipt.receiptNumber}\n`;
                responseText += `${parsedReceipt.date} ${parsedReceipt.time}\n`;
                responseText += `Официант: ${parsedReceipt.waiter}\n\n`;
                responseText += 'Заказанные блюда:\n';

                parsedReceipt.items.forEach((item) => {
                  responseText += `- ${item.name} (${item.quantity}) ${item.price.toFixed(2)} руб.\n`;
                });

                responseText += `\nИтого: ${parsedReceipt.total.toFixed(2)} руб.`;

                bot.sendMessage(options.chatId, responseText, {
                  reply_markup: {
                    inline_keyboard: [[{ text: 'Выбрать свои позиции', web_app: { url: process.env.WEB_APP_URL! } }]]
                  }
                });

                try {
                  fs.unlinkSync(downloadPath);
                  console.log(`Файл удален: ${downloadPath}`);
                } catch (unlinkError) {
                  console.error('Ошибка при удалении файла:', unlinkError);
                }
              } catch (error) {
                console.error('OCR Error:', error);
              }
            });
          })
          .on('error', (err) => {
            console.error('Ошибка при скачивании файла:', err);
            bot.sendMessage(options.chatId, 'Произошла ошибка при скачивании фотографии.');
          });
      } catch (error) {
        console.error('Ошибка при обработке фотографии:', error);
        bot.sendMessage(options.chatId, 'Произошла ошибка при обработке фотографии.');
      }
    }

    switch (text) {
      case '/start':
        return bot.sendMessage(options.chatId, `Добро пожаловать в телеграм-бота Resplitter`);
      case '/info':
        let helpText: string = `Список доступных команд: \n`;
        helpText += commands.map((command) => `${command.command} - ${command.description}`).join(`\n`);
        return bot.sendMessage(options.chatId, helpText);
      //default:
      //  return bot.sendMessage(options.chatId, "Я не понимаю тебя, попробуй команду из списка");
    }
  });

  bot.on('callback_query', (msg) => {});
};

start();
