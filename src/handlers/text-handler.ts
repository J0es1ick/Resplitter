import { info } from './chat-handlers/index';
import { bot } from '../bot/bot';
import { getChatState } from '../services/state-service';
import { addItem, changeTotal, editItem, peopleCount } from './chat-state-handlers';

export function setupTextHandler() {
  bot.on('text', async (msg) => {
    const text = msg.text!;
    const options = {
      chatId: msg.chat.id!,
      tgId: msg.from?.id!,
      messageId: msg.message_id!
    };

    const state = getChatState(options.chatId);

    if (state.waitingFor) {
      switch (state.waitingFor) {
        case 'newItem':
          await addItem(text, state, options.chatId);
          break;
        case 'editItem':
          await editItem(text, state, options.chatId);
          break;
        case 'changeTotal':
          await changeTotal(text, state, options.chatId);
          break;
        case 'peopleCount':
          await peopleCount(text, state, options.chatId);
          break;
      }
    }

    switch (text) {
      case '/info':
        info(options.chatId);
        break;
    }
  });
}
