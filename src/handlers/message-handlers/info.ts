import { bot } from '../../bot/bot';
import { commands } from '../../constants/commands';

export const info = (chatId: number) => {
  let helpText = `Список доступных команд: \n`;
  helpText += commands.map((command) => `${command.command} - ${command.description}`).join(`\n`);
  return bot.sendMessage(chatId, helpText);
};
