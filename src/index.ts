import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs';
import path from 'path';
import https from 'https';
import { createWorker } from 'tesseract.js';

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN!, { polling: true });

const commands = [
  { command: '/start', description: 'начальное приветствие' },
  {
    command: '/info',
    description: 'получить информацию обо всех доступных командах'
  }
];

const start = async () => {
  bot.setMyCommands(commands);

  const worker = await createWorker('rus');

  bot.on('message', async (msg) => {
    const text: string | undefined = msg.text;
    const options = {
      chatId: msg.chat.id,
      tgId: msg.from!.id,
      message_id: msg.message_id
    };

    if (msg.photo) {
      try {
        const fileId = msg.photo[msg.photo.length - 1].file_id;
        const fileInfo = await bot.getFile(fileId);
        const filePath = fileInfo.file_path;
        const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN!}/${filePath}`;

        const downloadPath = path.join('downloads', `${msg.chat.id}_${msg.message_id}.jpg`);
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
                  data: { text }
                } = await worker.recognize(downloadPath);

                bot.sendMessage(msg.chat.id, `Распознанный текст:\n\n${text}`);

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
            bot.sendMessage(msg.chat.id, 'Произошла ошибка при скачивании фотографии.');
          });
      } catch (error) {
        console.error('Ошибка при обработке фотографии:', error);
        bot.sendMessage(msg.chat.id, 'Произошла ошибка при обработке фотографии.');
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
