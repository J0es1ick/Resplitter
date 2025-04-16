import { start, info } from './message-handlers/index';
import { bot } from '../bot/bot';
import { sendReceiptWithActions } from '../utils';
import { getChatState } from '../services/state-service';

export function setupTextHandler() {
  bot.on('text', async (msg) => {
    const text = msg.text;
    const options = {
      chatId: msg.chat.id!,
      tgId: msg.from?.id!,
      messageId: msg.message_id!
    };

    const state = getChatState(options.chatId);

    if (state.waitingFor === 'newItem' && text && state.receipt) {
      const parts = text.split(' ');
      if (parts.length >= 2) {
        const name = parts.slice(0, -2).join(' ');
        const price = parseFloat(parts[parts.length - 2].replace(',', '.'));
        const quantity = parseFloat(parts[parts.length - 1].replace(',', '.')) || 1;

        if (!isNaN(price)) {
          state.receipt.items.push({ name, price, quantity });
          state.receipt.total += price * quantity;

          await sendReceiptWithActions(options.chatId, state.receipt);
          delete state.waitingFor;
          return;
        }
      }
      await bot.sendMessage(options.chatId, 'Неверный формат. Введите: "Название Цена [Количество]"');
      return;
    }

    if (state.waitingFor === 'peopleCount' && text && /^\d+$/.test(text)) {
      const peopleCount = parseInt(text, 10);
      if (peopleCount > 0 && state.receipt) {
        const amountPerPerson = state.receipt.total / peopleCount;
        await bot.sendMessage(
          options.chatId,
          `Счёт разделён на ${peopleCount} человек(а).\n` + `Каждый должен оплатить: ${amountPerPerson.toFixed(2)} руб.`
        );
        delete state.waitingFor;
        return;
      }
    }

    switch (text) {
      case '/start':
        start(options.chatId);
        break;
      case '/info':
        info(options.chatId);
        break;
    }
  });
}
