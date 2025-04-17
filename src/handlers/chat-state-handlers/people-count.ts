import { bot } from '../../bot/bot';
import { ChatState } from '../../interfaces';

export const peopleCount = async (text: string, state: ChatState, chatId: number) => {
  if (!state.receipt || !/^\d+$/.test(text)) return false;

  const peopleCount = parseInt(text, 10);
  if (peopleCount > 0) {
    const amountPerPerson = state.receipt.total / peopleCount;
    await bot.sendMessage(
      chatId,
      `Счёт разделён на ${peopleCount} человек(а).\n` + `Каждый должен оплатить: ${amountPerPerson.toFixed(2)} руб.`
    );
    delete state.waitingFor;
    return true;
  }
  return false;
};
