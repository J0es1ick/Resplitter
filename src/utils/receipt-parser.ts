import { ParsedReceipt, ReceiptItem } from '../interfaces';

export const parseReceiptText = (text: string): ParsedReceipt => {
  const result: ParsedReceipt = {
    receiptNumber: '',
    date: '',
    time: '',
    waiter: '',
    items: [],
    total: 0
  };

  try {
    const lines = (text || '')
      .split('\n')
      .map((line) => (line || '').trim())
      .filter((line) => line);

    parseCommonFields(lines, result);
    parseAllItems(lines, result);
    parseTotalAmount(lines, result);

    if (result.items.length === 0 && result.total === 0) {
      console.warn('Не удалось распознать товары в чеке');
    }

    return result;
  } catch (error) {
    console.error('Ошибка при парсинге текста чека:', error);
    return {
      receiptNumber: '',
      date: '',
      time: '',
      waiter: '',
      items: [],
      total: 0
    };
  }
};

function parseCommonFields(lines: string[], result: ParsedReceipt) {
  for (const line of lines) {
    if (!line) continue;

    try {
      if (!result.receiptNumber) {
        const receiptMatch = line.match(/(Чек|Заказ|Счёт|Счет|#)[#№]?\s*(\d+)/i) || line.match(/#(\d{5,})/) || line.match(/\b\d{4,}\b/);
        if (receiptMatch) {
          const receiptNumber = (receiptMatch[2] || receiptMatch[1] || '').toString().trim();
          if (receiptNumber) {
            result.receiptNumber = receiptNumber;
          }
        }
      }

      if (!result.date) {
        const dateMatch = line.match(/(\d{2}\.\d{2}\.\d{4})/) || line.match(/(\d{4}-\d{2}-\d{2})/);
        if (dateMatch && dateMatch[1]) {
          result.date = dateMatch[1];
        }
      }

      if (!result.time) {
        const timeMatch = line.match(/(\d{1,2}:\d{2}(?::\d{2})?)/);
        if (timeMatch && timeMatch[1]) {
          result.time = timeMatch[1];
        }
      }

      if (!result.waiter) {
        const waiterMatch =
          line.match(/Официант[:]?\s*(.+)/i) || line.match(/Пречек[:]?\s*(.+)/i) || line.match(/([А-Я][а-я]+\s[А-Я][а-я]+)(?=\s*$)/);
        if (waiterMatch && waiterMatch[1]) {
          const waiter = waiterMatch[1].trim();
          if (waiter) {
            result.waiter = waiter;
          }
        }
      }
    } catch (error) {
      console.error('Ошибка при парсинге строки:', line, error);
    }
  }
}

function parseAllItems(lines: string[], result: ParsedReceipt) {
  const itemsStartIndex = lines.findIndex((line) => /Блюдо|Наименование|Товар|ПОСТЕВОЙ СЧЕТ|ГОСТЕВОЙ СЧЁТ|\d+\)\s+.+/i.test(line));

  if (itemsStartIndex === -1) return;

  const itemsEndIndex = lines.findIndex((line, idx) => idx > itemsStartIndex && /Итого|Всего|ИТОГО К ОПЛАТЕ|---/.test(line));

  const itemLines = itemsEndIndex !== -1 ? lines.slice(itemsStartIndex + 1, itemsEndIndex) : lines.slice(itemsStartIndex + 1);

  let currentItem: ReceiptItem | null = null;

  for (const line of itemLines) {
    if (!line || /^-+$/.test(line)) continue;
    if (!line || /^-+$/.test(line) || /^\d+$/.test(line)) continue;

    const item = tryParseAsTableRow(line) || tryParseAsNumberedItem(line) || tryParseAsSimpleItem(line);

    if (item) {
      if (currentItem) {
        result.items.push(currentItem);
      }
      currentItem = item;
    } else if (currentItem && !/\d+[,.]\d{2}/.test(line)) {
      currentItem.name += ' ' + line.trim();
    }
  }

  if (currentItem) {
    result.items.push(currentItem);
  }
}

function tryParseAsTableRow(line: string): ReceiptItem | null {
  const match = line.match(/^([^\d]+?)\s+(\d{1,3}(?:\.\d{3})*)(?:\s+|\s*\.\s*)(\d{1,3}(?:\.\d{2})*)/i);

  if (match) {
    return {
      name: match[1].trim(),
      quantity: parseNumber(match[2]),
      price: parseNumber(match[3])
    };
  }
  return null;
}

function tryParseAsNumberedItem(line: string): ReceiptItem | null {
  const match = line.match(/^\d+\)\s+(.+?)\s+(\d+[,.]\d+).*=\s*(\d+[,.]\d+)/);
  if (match) {
    const price = parseNumber(match[2]);
    const total = parseNumber(match[3]);
    return {
      name: match[1].trim(),
      price: price,
      quantity: Math.round((total / price) * 100) / 100
    };
  }
  return null;
}

function tryParseAsSimpleItem(line: string): ReceiptItem | null {
  const match = line.match(/^(.+?)\s+(\d+[,.]\d{2})(?:\s|$)/);
  if (match && !/\d+\)/.test(line)) {
    return {
      name: match[1].trim(),
      price: parseNumber(match[2]),
      quantity: 1
    };
  }
  return null;
}

function parseTotalAmount(lines: string[], result: ParsedReceipt) {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];

    const totalMatch = line.match(/(?:Итого|Всего|ИТОГО К ОПЛАТЕ|Total)[:\s]*(\d+[,.]\d+)/i) || line.match(/(\d+[,.]\d{2})(?:\s*Руб|₽|$)/);

    if (totalMatch) {
      result.total = parseNumber(totalMatch[1]);
      break;
    }
  }
}

function parseNumber(numStr: string): number {
  const cleaned = numStr.replace(',', '.').replace(/\s+/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}
