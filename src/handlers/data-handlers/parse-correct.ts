import { bot } from '../../bot/bot';

export const parseCorrect = async (chatId: number) => {
  bot.sendMessage(chatId, 'Выберите способ разделения счета:\n1. Разделить сумму поровну\n2. Выбрать блюда из списка', {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '1', callback_data: 'split_evenly' },
          { text: '2', callback_data: 'select_dishes' }
        ],
        [{ text: 'Отмена', callback_data: 'cancel' }]
      ]
    }
  });
};
