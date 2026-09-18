import type { Message } from 'node-telegram-bot-api';
import { receiptReview, navigation } from './callback-handler';
export async function handleText(msg: Message): Promise<void> {
  if (!msg.from) return;
  if (await navigation.text(msg)) return;
  await receiptReview.text(msg);
}
