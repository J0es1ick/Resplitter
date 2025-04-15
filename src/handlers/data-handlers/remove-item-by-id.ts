import { bot } from '../../bot/bot';
import { ChatState } from '../../interfaces';
import { sendReceiptWithActions } from '../../utils';

export const removeItemById = async (state: ChatState, chatId: number, messageId: number, data: string) => {
  if (!state.receipt) return;
  const index = parseInt(data.replace('remove_item_', ''), 10);
  if (index >= 0 && index < state.receipt.items.length) {
    const removedItem = state.receipt.items.splice(index, 1)[0];
    state.receipt.total -= removedItem.price * removedItem.quantity;

    if (state.receipt!.items.length > 0) {
      await sendReceiptWithActions(chatId, state.receipt, messageId);
    } else {
      await bot.editMessageText('Все блюда удалены. Чек пуст.', {
        chat_id: chatId,
        message_id: messageId
      });
      state.receipt.items = [];
      state.receipt.total = 0;
    }
  }
};
