import { bot } from '../../bot/bot';
import { ChatState } from '../../interfaces';
import { createItemsKeyboard } from '../../utils';

export const editReceipt = async (state: ChatState, chatId: number, messageId: number) => {
  if (!state.receipt) return;
  await bot.editMessageReplyMarkup(createItemsKeyboard(state.receipt.items, 'edit_item'), { chat_id: chatId, message_id: messageId });
};
