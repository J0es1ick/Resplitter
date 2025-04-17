import { bot } from '../../bot/bot';
import { ChatState } from '../../interfaces';

export const changeTotal = async (state: ChatState, chatId: number) => {
  state.waitingFor = 'changeTotal';
  await bot.sendMessage(chatId, `Текущая сумма чека: ${state.receipt?.total.toFixed(2)} руб.\n\n` + 'Введите новую общую сумму:', {
    reply_markup: { inline_keyboard: [[{ text: 'Отмена', callback_data: 'cancel' }]] }
  });
  return;
};
