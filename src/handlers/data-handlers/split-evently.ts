import { bot } from '../../bot/bot';
import { ChatState } from '../../interfaces';

export const splitEvently = async (state: ChatState, chatId: number) => {
  state.waitingFor = 'peopleCount';
  bot.sendMessage(chatId, 'Введите количество человек, на которое нужно разделить счет:', {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: 'Отмена',
            callback_data: 'cancel'
          }
        ]
      ]
    }
  });
};
