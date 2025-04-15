import { bot } from '../../bot/bot';
import { getChatState } from '../../services/state-service';
import { createItemsKeyboard } from '../../utils/create-items-keyboard';

export const pagination = async (data: string, chatId: number, messageId: number) => {
  if (!data.includes('_page_')) return;

  const state = getChatState(chatId);
  if (!state.receipt?.items) {
    throw new Error('No receipt items found');
  }

  let newPage;
  if (data.startsWith('next:')) {
    const currentPage = parseInt(data.split('_')[2]) || 0;
    newPage = currentPage + 1;
  } else if (data.startsWith('prev:')) {
    const currentPage = parseInt(data.split('_')[2]) || 0;
    newPage = Math.max(0, currentPage - 1);
  }

  if (newPage === undefined) return;

  const actionPrefix = data.split(':')[1];

  await bot.editMessageReplyMarkup(createItemsKeyboard(state.receipt.items, actionPrefix, newPage), {
    chat_id: chatId,
    message_id: messageId
  });
};
