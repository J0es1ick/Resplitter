import { bot } from '../../bot/bot';
import { ChatState } from '../../interfaces';

export const cancel = async (state: ChatState, chatId: number, messageId: number) => {
  delete state.editingItemIndex;
  delete state.waitingFor;
  await bot.deleteMessage(chatId, messageId);
};
