import { bot } from '../bot/bot';
import { receiptStorage } from '../constants/receipt-storage';
import { ParsedReceipt } from '../interfaces';
import { generateWebAppUrl } from '../utils';

export const setupStartCommand = () => {
  bot.onText(/\/start(.+)?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const text = match?.[1]?.trim();

    if (!text) {
      await bot.sendMessage(
        chatId,
        `Добро пожаловать в телеграм-бота Resplitter. Для начала работы отправьте чек или перейдите по ссылке из группы`
      );
      return;
    }

    if (text.startsWith('receipt_')) {
      const groupChatId = text.split('_')[1];
      const receipt = receiptStorage.get(Number(groupChatId));

      if (receipt) {
        await sendWebAppMenu(chatId, receipt);
      } else {
        await bot.sendMessage(chatId, 'Чек не найден или устарел. Пожалуйста, запросите новый чек в группе.');
      }
      return;
    }
  });
};

const sendWebAppMenu = async (chatId: number, receipt: ParsedReceipt) => {
  try {
    await bot.sendMessage(chatId, 'Продолжите выбор блюд:', {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: 'Открыть меню',
              web_app: { url: generateWebAppUrl(receipt, chatId) }
            }
          ]
        ]
      }
    });
  } catch (error) {
    console.error('Ошибка отправки меню:', error);
    await bot.sendMessage(chatId, 'Не удалось загрузить меню. Пожалуйста, попробуйте позже.');
  }
};
