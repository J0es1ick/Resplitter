import { config } from '../config';
import { ParsedReceipt } from '../interfaces';
import { bot } from '../bot/bot';
import { getChatState, updateChatState } from '../services/state-service';
import type { Message } from 'node-telegram-bot-api';

export const generateWebAppUrl = (receipt: ParsedReceipt, chatId: number): string => {
  const receiptWithIds = {
    ...receipt,
    items: receipt.items.map((item, index) => ({
      ...item,
      id: `${chatId}_${index}_${Date.now()}`
    }))
  };

  return `${config.telegram.webAppUrl}?receipt=${encodeURIComponent(JSON.stringify(receiptWithIds))}&chatId=${chatId}`;
};

export const setupWebAppHandler = () => {
  bot.on('web_app_data', async (msg: Message) => {
    if (!msg.web_app_data?.data || !msg.from) return;

    try {
      const data = JSON.parse(msg.web_app_data.data);
      const chatId = msg.chat.id;
      const currentState = getChatState(chatId);

      await bot.sendMessage(chatId, `Вы выбрали ${data.selectedItems?.length || 0} блюд. Введите количество человек:`);

      updateChatState(chatId, {
        ...currentState,
        selectedItems: data.selectedItems,
        waitingFor: 'peopleCount' as const
      });
    } catch (error) {
      console.error('WebApp error:', error);
      await bot.sendMessage(msg.chat.id, 'Ошибка обработки выбора блюд');
    }
  });
};
