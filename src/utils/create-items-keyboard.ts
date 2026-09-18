import type { InlineKeyboardMarkup } from 'node-telegram-bot-api';

import type { ReceiptSession } from '../interfaces';
import { encodeCallback } from './callback-data';

export type ItemsKeyboardMode = 'edit' | 'remove' | 'select';

export const createItemsKeyboard = (
  session: ReceiptSession,
  mode: ItemsKeyboardMode,
  page = 0,
  selectedItemIds: string[] = []
): InlineKeyboardMarkup => {
  const perPage = 8;
  const totalPages = Math.max(1, Math.ceil(session.receipt.items.length / perPage));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const start = safePage * perPage;
  const items = session.receipt.items.slice(start, start + perPage);
  const action = mode === 'edit' ? 'editItem' : mode === 'remove' ? 'removeItem' : 'toggle';
  const rows = items.map((item, index) => [
    {
      text: `${selectedItemIds.includes(item.id) ? '✅ ' : ''}${start + index + 1}. ${item.name}`.slice(0, 60),
      callback_data: encodeCallback(session.id, action, item.id)
    }
  ]);

  const pagination = [];
  if (safePage > 0) pagination.push({ text: '◀', callback_data: encodeCallback(session.id, 'page', `${mode},${safePage - 1}`) });
  if (safePage < totalPages - 1)
    pagination.push({ text: '▶', callback_data: encodeCallback(session.id, 'page', `${mode},${safePage + 1}`) });
  if (pagination.length) rows.push(pagination);
  if (mode === 'select') rows.push([{ text: 'Готово', callback_data: encodeCallback(session.id, 'selectionDone') }]);
  rows.push([{ text: mode === 'select' ? 'Отмена' : 'Назад', callback_data: encodeCallback(session.id, 'back') }]);
  return { inline_keyboard: rows };
};
