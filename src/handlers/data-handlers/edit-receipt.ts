import { bot } from '../../bot/bot';
import { ChatState } from '../../interfaces';
import { createItemsKeyboard } from '../../utils';

export const editReceipt = async (state: ChatState, chatId: number) => {
  if (!state.receipt) return;
  await bot.sendMessage(chatId, 'Введите номер блюда для редактирования:', {
    reply_markup: createItemsKeyboard(state.receipt.items, 'edit_item')
  });
};
