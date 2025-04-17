import { bot } from '../../bot/bot';
import { ChatState } from '../../interfaces';

export const splitEvently = async (state: ChatState, chatId: number, messageId: number) => {
  state.waitingFor = 'peopleCount';
  await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: messageId });
  bot.sendMessage(chatId, 'Введите количество человек, на которое нужно разделить счет:');
};
