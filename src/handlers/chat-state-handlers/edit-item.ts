import { bot } from '../../bot/bot';
import { ChatState } from '../../interfaces';
import { sendReceiptWithActions } from '../../utils';

export const editItem = async (text: string, state: ChatState, chatId: number) => {
  if (!state.receipt || state.editingItemIndex === undefined) return false;

  const parts = text.split(' ');
  if (parts.length >= 2) {
    const name = parts.slice(0, -2).join(' ');
    const price = parseFloat(parts[parts.length - 2].replace(',', '.'));
    const quantity = parseFloat(parts[parts.length - 1].replace(',', '.')) || 1;

    if (!isNaN(price)) {
      const oldItem = state.receipt.items[state.editingItemIndex];
      state.receipt.total -= oldItem.price * oldItem.quantity;

      state.receipt.items[state.editingItemIndex] = {
        name: name || oldItem.name,
        price,
        quantity
      };
      state.receipt.total += price * quantity;

      await sendReceiptWithActions(chatId, state.receipt);
      delete state.waitingFor;
      delete state.editingItemIndex;
      return true;
    }
  }

  await bot.sendMessage(chatId, 'Неверный формат. Введите: "Название Цена [Количество]"');
  return false;
};
