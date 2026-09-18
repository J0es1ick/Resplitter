import { screens } from '../bot/screens';
import { stateService } from '../services/state-service';
import type { ReceiptSession } from '../interfaces';
import { encodeCallback, type CallbackAction } from './callback-data';
import { formatReceipt, REVIEW_PAGE_SIZE } from './format-receipt';
import { menuButton, receiptsButton } from './bot-navigation';

export const reviewButton = (s: ReceiptSession, text: string, action: CallbackAction, value?: string | number) => ({
  text,
  callback_data: encodeCallback(s.id, action, value, s.version)
});

export const reviewKeyboard = (s: ReceiptSession, page = 0) => {
  const pages = Math.max(1, Math.ceil(s.receipt.items.length / REVIEW_PAGE_SIZE));
  const rows = [];
  if (pages > 1)
    rows.push([
      ...(page > 0 ? [reviewButton(s, '← Предыдущая', 'page', page - 1)] : []),
      ...(page < pages - 1 ? [reviewButton(s, 'Далее → (' + (page + 2) + '/' + pages + ')', 'page', page + 1)] : [])
    ]);
  if (s.status !== 'finalized')
    rows.push([
      reviewButton(s, s.status === 'draft' ? '✓ Всё верно → разделить' : 'Открыть разделение', 'confirm'),
      reviewButton(s, 'Исправить', 'editMenu')
    ]);
  rows.push([receiptsButton], [menuButton]);
  return { inline_keyboard: rows };
};
export const editKeyboard = (s: ReceiptSession) => ({
  inline_keyboard: [
    [reviewButton(s, 'Изменить позицию', 'edit'), reviewButton(s, 'Добавить', 'add')],
    [reviewButton(s, 'Удалить позицию', 'remove'), reviewButton(s, 'Изменить итог', 'change')],
    [reviewButton(s, 'Валюта', 'currency'), reviewButton(s, '← Назад к чеку', 'back')],
    [menuButton]
  ]
});
export const sendReceiptWithActions = async (chatId: number, s: ReceiptSession, messageId?: number, page = 0): Promise<void> => {
  page = Math.max(0, Math.min(page, Math.max(0, Math.ceil(s.receipt.items.length / REVIEW_PAGE_SIZE) - 1)));
  const options = { parse_mode: 'HTML' as const, reply_markup: reviewKeyboard(s, page) };
  if (messageId) await screens.adopt(chatId, s.ownerUserId, messageId, true);
  await screens.show(chatId, s.ownerUserId, formatReceipt(s.receipt, page), options);
  stateService.setBotUi(chatId, s.ownerUserId, { receipt: { sessionId: s.id, mode: 'review', page } });
};
