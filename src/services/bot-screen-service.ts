import type { InlineKeyboardMarkup, Message } from 'node-telegram-bot-api';
import type { BotInstance } from '../bot/bot';
import type { StateService } from './state-service';

export interface ScreenOptions {
  parse_mode?: 'HTML';
  reply_markup?: InlineKeyboardMarkup;
}
export type Screen = Pick<BotScreenService, 'show' | 'adopt'>;
const emptyKeyboard = { inline_keyboard: [] };
const unchanged = (error: unknown) => error instanceof Error && error.message.includes('message is not modified');
const unavailable = (error: unknown) =>
  error instanceof Error && /message (?:to edit not found|can't be edited|identifier is not specified)/i.test(error.message);

export class BotScreenService {
  constructor(
    private readonly bot: Pick<BotInstance, 'sendMessage' | 'editMessageText' | 'editMessageReplyMarkup'>,
    private readonly store: StateService
  ) {}

  private async disable(chatId: number, messageId: number): Promise<void> {
    try {
      await this.bot.editMessageReplyMarkup(emptyKeyboard, { chat_id: chatId, message_id: messageId });
    } catch (error) {
      if (!unchanged(error) && !unavailable(error)) throw error;
    }
  }

  public async adopt(chatId: number, userId: number, messageId: number, ownedReceipt = false): Promise<void> {
    const current = this.store.getBotUi(chatId, userId).messageId;
    const owner = this.store.botUiOwner(chatId, messageId);
    if (owner !== undefined && owner !== userId) return;
    if (current === messageId || (chatId < 0 && !ownedReceipt)) return;
    if (current) await this.disable(chatId, messageId);
    else this.store.setBotUi(chatId, userId, { messageId });
  }

  public async show(chatId: number, userId: number, text: string, options: ScreenOptions = {}): Promise<Message> {
    const messageId = this.store.getBotUi(chatId, userId).messageId;
    const reply_markup = options.reply_markup || emptyKeyboard;
    if (messageId) {
      try {
        await this.bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...options, reply_markup });
        this.store.setBotUi(chatId, userId, { messageId });
        return { message_id: messageId } as Message;
      } catch (error) {
        if (unchanged(error)) {
          this.store.setBotUi(chatId, userId, { messageId });
          return { message_id: messageId } as Message;
        }
        if (!unavailable(error)) throw error;
        await this.disable(chatId, messageId);
      }
    }
    const message = await this.bot.sendMessage(chatId, text, { ...options, reply_markup });
    this.store.setBotUi(chatId, userId, { messageId: message.message_id });
    return message;
  }
}
