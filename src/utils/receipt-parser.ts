import { ParsedReceipt } from '../interfaces/ParsedReceipt';

export function parseReceiptText(text: string): ParsedReceipt {
  const normalizedText = text
    .replace(/\r\n/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ +/g, ' ')
    .trim();

  const result: ParsedReceipt = {
    receiptNumber: '',
    date: '',
    time: '',
    waiter: '',
    items: [],
    total: 0
  };

  const lines = normalizedText.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (/Чек[#№\s]*(\d+)/i.test(line)) {
      result.receiptNumber = line.replace(/Чек[#№\s]*/i, '');
    }

    const dateTimeMatch = line.match(/(\d{2}\.\d{2}\.\d{4}).*?(\d{1,2}:\d{2})/);
    if (dateTimeMatch && !result.date) {
      const [_, date, time] = dateTimeMatch;
      if (isValidDate(date) && isValidTime(time)) {
        result.date = date;
        result.time = time;
      }
    }

    if (/Официант:/i.test(line)) {
      result.waiter = line.replace(/Официант:/i, '').trim();
    }

    if (/Итого к оплате:/i.test(line)) {
      const totalMatch = line.match(/(\d+[\.,]\d{2})/);
      if (!totalMatch && i + 1 < lines.length) {
        const nextLine = lines[i + 1].trim();
        const nextLineMatch = nextLine.match(/(\d+[\.,]\d{2})/);
        if (nextLineMatch) result.total = parseFloat(nextLineMatch[1].replace(',', '.'));
      } else if (totalMatch) {
        result.total = parseFloat(totalMatch[1].replace(',', '.'));
      }
    }
  }

  const itemsStartIndex = lines.findIndex((line) => /(Блюдо|Наименование|Товар).*(Кол-во|Количество).*(Цена|Сумма)/i.test(line));
  const itemsEndIndex = lines.findIndex((line, idx) => idx > itemsStartIndex && /(Итого|Всего|ИТОГО|===|---)/i.test(line));

  for (let i = itemsStartIndex + 1; i < itemsEndIndex; i++) {
    const line = lines[i].trim();
    if (!line || /^(---|===|\+{3})$/i.test(line)) continue;

    const match =
      line.match(/^(.*?)\s+(\d+[\.,]?\d*)\s+(\d+[\.,]\d{2})\s*$/) ||
      line.match(/^(.*?)\s+(\d+[\.,]?\d*)\s*$/) ||
      line.match(/^(.*?)\s+(\d+[\.,]\d{2})\s*$/);

    if (match) {
      const name = match[1].trim();
      const quantity = parseFloat((match[2] || '1').replace(',', '.'));
      const price = parseFloat((match[3] || match[2]).replace(',', '.'));

      if (name && !isNaN(price)) {
        result.items.push({
          name,
          quantity: !isNaN(quantity) ? quantity : 1,
          price
        });
      }
    }
  }

  return result;
}

function isValidDate(dateStr: string): boolean {
  return /^\d{2}\.\d{2}\.\d{4}$/.test(dateStr);
}

function isValidTime(timeStr: string): boolean {
  return /^\d{1,2}:\d{2}$/.test(timeStr);
}
