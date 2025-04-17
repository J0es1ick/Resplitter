import { bot } from '../../bot/bot';
import { getChatState } from '../../services/state-service';
import { createItemsKeyboard } from '../../utils/create-items-keyboard';

export const pagination = async (data: string, chatId: number, messageId: number) => {
  if (!data.includes('_page_')) return;

  const state = getChatState(chatId);
  if (!state.receipt?.items) {
    throw new Error('No receipt items found');
  }

  const parts = data.split(':');
  const action = parts[0];

  let actionPrefix = '';
  if (parts[1].startsWith('remove_item')) {
    actionPrefix = 'remove_item';
  } else if (parts[1].startsWith('edit_item')) {
    actionPrefix = 'edit_item';
  }

  const currentPage = parseInt(parts[1].split('_')[2]) || 0;

  let newPage;
  if (action === 'next') {
    newPage = currentPage + 1;
  } else if (action === 'prev') {
    newPage = Math.max(0, currentPage - 1);
  } else {
    return;
  }

  if (newPage === undefined) return;

  await bot.editMessageReplyMarkup(createItemsKeyboard(state.receipt.items, actionPrefix, newPage), {
    chat_id: chatId,
    message_id: messageId
  });
};
