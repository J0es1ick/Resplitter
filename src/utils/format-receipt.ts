import { ParsedReceipt } from '../interfaces';

export const formatReceipt = (receipt: ParsedReceipt): string => {
  let text = `Чек #${receipt.receiptNumber || ' N/A'}\n`;
  text += `${receipt.date || 'Дата неизвестна'} ${receipt.time || ''}\n`;
  if (receipt.waiter) text += `Официант: ${receipt.waiter}\n\n`;

  text += 'Блюда:\n';
  receipt.items.forEach((item, index) => {
    text += `${index + 1}. ${item.name} (${item.quantity}) - ${item.price.toFixed(2)} руб.\n`;
  });

  text += `\nИтого: ${receipt.total.toFixed(2)} руб.`;
  return text;
};
