import { bot } from '../bot/bot';
import { stateService } from '../services/state-service';
import { sendMiniApp } from '../utils/mini-app';
import { sendReceiptWithActions } from '../utils/send-receipt-with-actions';
import { createReceiptReviewHandlers } from './receipt-review';
import { createNavigationHandlers } from './navigation';
import { handleStart, receiptCatalog } from './start-handlers';
import { config } from '../config';
import { screens } from '../bot/screens';

export const receiptReview = createReceiptReviewHandlers({
  bot,
  store: stateService,
  screen: screens,
  show: sendReceiptWithActions,
  open: (chatId, session) => sendMiniApp(chatId, session, 'Чек подтверждён. Теперь выберите блюда и пригласите друзей в Mini App.')
});
export const navigation = createNavigationHandlers({
  bot,
  store: stateService,
  home: handleStart,
  retentionHours: config.storage.sessionTtlMs / 3600000,
  screen: screens,
  receiptsBack: receiptCatalog.back,
  currentReceipt: receiptCatalog.resume
});
export const handleCallback = async (query: Parameters<typeof receiptReview.callback>[0]) => {
  if (!(await receiptCatalog.callback(query)) && !(await navigation.callback(query))) await receiptReview.callback(query);
};
