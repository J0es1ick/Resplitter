import { bot } from '../../bot/bot';
import { ChatState } from '../../interfaces';

export const editItemById = async (state: ChatState, chatId: number, data: string) => {
  if (!state.receipt) return;
  const indexStr = data.replace('edit_item_', '');
  const index = parseInt(indexStr, 10);

  if (isNaN(index) || index < 0 || index >= state.receipt.items.length) {
    console.error('Неизвестный индекс блюда:', { index, itemsLength: state.receipt.items.length });
    await bot.sendMessage(chatId, 'Неизвестный номер блюда.');
    return;
  }
  state.editingItemIndex = index;
  state.waitingFor = 'editItem';
  const item = state.receipt.items[index];

  await bot.sendMessage(
    chatId,
    `Редактирование блюда ${index + 1}:\n` +
      `${item.name} (${item.quantity}) - ${item.price.toFixed(2)} руб.\n\n` +
      'Введите новые данные в формате: "Название Цена (руб) [Количество]"',
    { reply_markup: { inline_keyboard: [[{ text: 'Отмена', callback_data: 'cancel' }]] } }
  );
};
