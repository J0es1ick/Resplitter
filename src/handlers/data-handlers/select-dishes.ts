import { bot } from '../../bot/bot';
import { ParsedReceipt } from '../../interfaces';
import { generateBotDeepLink, generateWebAppUrl } from '../../utils';

export const selectDishes = async (chatId: number, messageId: number, receipt: ParsedReceipt, botUsername: string) => {
  await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: messageId });

  const chat = await bot.getChat(chatId);
  const isPrivateChat = chat.type === 'private';

  if (isPrivateChat) {
    await bot.sendMessage(chatId, 'Выберите блюда:', {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: 'Открыть меню',
              web_app: { url: generateWebAppUrl(receipt, chatId) }
            }
          ]
        ]
      }
    });
  } else {
    const deepLink = generateBotDeepLink(chatId, receipt, botUsername);
    await bot.sendMessage(chatId, 'Нажмите кнопку, чтобы открыть меню в ЛС:', {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: 'Открыть в ЛС',
              url: deepLink
            }
          ]
        ]
      }
    });
  }
};
