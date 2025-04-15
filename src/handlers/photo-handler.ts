import { bot } from '../bot/bot';
import { processReceiptPhoto } from '../services/receipt-service';
import { updateChatState } from '../services/state-service';
import { sendReceiptWithActions } from '../utils';

export function setupPhotoHandler() {
  bot.on('photo', async (msg) => {
    if (!msg.photo || !msg.from) return;

    const chatId = msg.chat.id;

    try {
      const parsedReceipt = await processReceiptPhoto(msg);

      updateChatState(chatId, { receipt: parsedReceipt });

      await sendReceiptWithActions(chatId, parsedReceipt);
    } catch (error) {
      console.error('Ошибка процессора чеков:', error);
      await bot.sendMessage(chatId, 'Произошла ошибка при обработке чека. Пожалуйста, попробуйте еще раз.');
    }
  });
}
