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

    if (state.waitingFor === 'editItem' && text && state.receipt && state.editingItemIndex !== undefined) {
      const itemIndex = state.editingItemIndex;
      const parts = text.split(' ');
      if (parts.length >= 2) {
        const name = parts.slice(0, -2).join(' ');
        const price = parseFloat(parts[parts.length - 2].replace(',', '.'));
        const quantity = parseFloat(parts[parts.length - 1].replace(',', '.')) || 1;

        if (!isNaN(price)) {
          const oldItem = state.receipt.items[itemIndex];
          state.receipt.total -= oldItem.price * oldItem.quantity;

          state.receipt.items[itemIndex] = {
            name: name || oldItem.name,
            price,
            quantity
          };
          state.receipt.total += price * quantity;

          await sendReceiptWithActions(options.chatId, state.receipt);
          delete state.waitingFor;
          return;
        }
      }
      await bot.sendMessage(options.chatId, 'Неверный формат. Введите: "Название Цена [Количество]"');
      return;
    }

    if (state.waitingFor === 'changeTotal' && text && state.receipt) {
      const newTotal = parseFloat(text.replace(',', '.'));

      if (!isNaN(newTotal) && newTotal > 0) {
        state.receipt.total = newTotal;
        await sendReceiptWithActions(options.chatId, state.receipt);
        delete state.waitingFor;
        return;
      }

      await bot.sendMessage(
        options.chatId,
        `Неверный формат. Текущая сумма: ${state.receipt.total.toFixed(2)} руб.\n\n` +
          'Введите новую сумму числом, например: "1250.50" или "1500"',
        { reply_markup: { inline_keyboard: [[{ text: 'Отмена', callback_data: 'cancel' }]] } }
      );
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
