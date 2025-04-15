import { bot } from '../../bot/bot';
import { ChatState } from '../../interfaces';

export const addDish = async (state: ChatState, chatId: number) => {
  state.waitingFor = 'newItem';
  await bot.sendMessage(chatId, 'Введите блюдо в формате: "Название Цена (руб) [Количество=1]"\n' + 'Например: "Пицца Маргарита 650 1"', {
    reply_markup: { inline_keyboard: [[{ text: 'Отмена', callback_data: 'cancel' }]] }
  });
};
