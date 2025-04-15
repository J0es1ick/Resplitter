import { bot } from '../../bot/bot';
import { ChatState } from '../../interfaces';
import { createItemsKeyboard } from '../../utils';

export const removeDish = async (state: ChatState, chatId: number) => {
  if (!state.receipt) return;
  await bot.sendMessage(chatId, 'Выберите блюдо для удаления:', {
    reply_markup: createItemsKeyboard(state.receipt.items, 'remove_item')
  });
};
