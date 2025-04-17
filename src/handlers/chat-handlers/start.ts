import { bot } from '../../bot/bot';

export const start = (chatId: number) => {
  return bot.sendMessage(chatId, `Добро пожаловать в телеграм-бота Resplitter. Отправьте чек для начала работы`);
};
