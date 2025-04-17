import { bot } from '../../bot/bot';
import { ChatState } from '../../interfaces';
import { sendReceiptWithActions } from '../../utils';

export const changeTotal = async (text: string, state: ChatState, chatId: number) => {
  if (!state.receipt) return false;

  const newTotal = parseFloat(text.replace(',', '.'));
  if (!isNaN(newTotal) && newTotal > 0) {
    state.receipt.total = newTotal;
    await sendReceiptWithActions(chatId, state.receipt);
    delete state.waitingFor;
    return true;
  }

  await bot.sendMessage(
    chatId,
    `Неверный формат. Текущая сумма: ${state.receipt.total.toFixed(2)} руб.\n\n` +
      'Введите новую сумму числом, например: "1250.50" или "1500"',
    { reply_markup: { inline_keyboard: [[{ text: 'Отмена', callback_data: 'cancel' }]] } }
  );
  return false;
};
