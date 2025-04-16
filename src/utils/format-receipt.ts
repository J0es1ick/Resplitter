import { ParsedReceipt } from '../interfaces';
import { isReceiptValid } from './is-receipt-valid';

export const formatReceipt = (receipt: ParsedReceipt): string => {
  const isValidReceipt = isReceiptValid(receipt);

  if (!isValidReceipt) {
    return 'Отправлен не чек, попробуйте ещё раз.\nУбедитесь, что в чеке есть:\n- Номер чека\n- Дата\n- Список блюд\n- Итоговая сумма';
  }

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
