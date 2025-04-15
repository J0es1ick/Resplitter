import { ReceiptItem } from '../interfaces';

export const createItemsKeyboard = (items: ReceiptItem[], actionPrefix: string, page: number = 0) => {
  if (!items || !Array.isArray(items)) {
    throw new Error('Invalid items array');
  }

  const itemsPerPage = 8;
  if (itemsPerPage <= 0) {
    throw new Error('Items per page must be positive');
  }

  const totalItems = items.length;
  const totalPages = totalItems > 0 ? Math.ceil(totalItems / itemsPerPage) : 1;

  page = Math.max(0, Math.min(page, totalPages - 1));

  const startIdx = page * itemsPerPage;
  const pageItems = items.slice(startIdx, startIdx + itemsPerPage);

  const itemButtons = pageItems.map((item, idx) => [
    {
      text: `${startIdx + idx + 1}. ${item.name}`,
      callback_data: `${actionPrefix}_${startIdx + idx}`
    }
  ]);

  const paginationButtons = [];
  if (totalPages > 1) {
    if (page > 0) {
      paginationButtons.push({
        text: '◀ Назад',
        callback_data: `prev:${actionPrefix}_page_${page - 1}`
      });
    }

    if (page < totalPages - 1) {
      paginationButtons.push({
        text: 'Вперед ▶',
        callback_data: `next:${actionPrefix}_page_${page + 1}`
      });
    }
  }

  const allButtons = [
    ...itemButtons,
    ...(paginationButtons.length > 0 ? [paginationButtons] : []),
    [{ text: 'Отмена', callback_data: 'cancel' }]
  ];

  return {
    inline_keyboard: allButtons
  };
};
