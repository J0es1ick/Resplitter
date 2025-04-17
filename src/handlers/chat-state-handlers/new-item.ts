import { bot } from '../../bot/bot';
import { ChatState } from '../../interfaces';
import { sendReceiptWithActions } from '../../utils';

export const addItem = async (text: string, state: ChatState, chatId: number) => {
  if (!state.receipt) return false;

  const parts = text.split(' ');
  if (parts.length >= 2) {
    const name = parts.slice(0, -2).join(' ');
    const price = parseFloat(parts[parts.length - 2].replace(',', '.'));
    const quantity = parseFloat(parts[parts.length - 1].replace(',', '.')) || 1;

    if (!isNaN(price)) {
      state.receipt.items.push({ name, price, quantity });
      state.receipt.total += price * quantity;
      await sendReceiptWithActions(chatId, state.receipt);
      delete state.waitingFor;
      return true;
    }
  }

  await bot.sendMessage(chatId, 'Неверный формат. Введите: "Название Цена [Количество]"');
  return false;
};
