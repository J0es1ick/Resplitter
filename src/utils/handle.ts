import axios from 'axios';
import fs from 'fs';
import { OCRResponse, ParsedReceipt } from '../interfaces';
import { parseReceiptText } from '.';

export async function sendToReceiptProcessor(imagePath: string, api: string, apiKey: string, folderId: string): Promise<ParsedReceipt> {
  if (!fs.existsSync(imagePath)) {
    throw new Error(`Файл не найден: ${imagePath}`);
  }

  const fileContent = fs.readFileSync(imagePath);
  const encodedImage = fileContent.toString('base64');

  const requestData = {
    mimeType: 'JPEG',
    languageCodes: ['ru', 'en'],
    model: 'page',
    content: encodedImage
  };

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    'x-folder-id': folderId,
    'x-data-logging-enabled': 'true'
  };

  try {
    const response = await axios.post<OCRResponse>(api, requestData, {
      headers,
      timeout: 15000
    });

    const formattedText = formatReceiptText(response.data);
    console.log(formattedText);
    const parsedReceipt = parseReceiptText(formattedText);

    return parsedReceipt;
  } catch (error: any) {
    let errorMessage = 'Ошибка OCR';

    if (axios.isAxiosError(error)) {
      console.error('Ошибка Axios:');
      console.error('URL:', error.config?.url);
      console.error('Method:', error.config?.method);
      console.error('Headers:', error.config?.headers);
      console.error('Status:', error.response?.status);
      console.error('Response Data:', error.response?.data);

      errorMessage += ` [${error.response?.status}] ${error.response?.data?.error?.message || error.message}`;
    } else {
      errorMessage += `: ${error.message}`;
    }
    throw error;
  }
}

function formatReceiptText(response: OCRResponse): string {
  if (!response.result?.textAnnotation?.blocks) {
    return '';
  }

  const blocks = response.result.textAnnotation.blocks;
  const elements: Array<{ y: number; x: number; text: string }> = [];

  for (const block of blocks) {
    for (const line of block.lines || []) {
      const y = parseInt(line.boundingBox?.vertices?.[0]?.y || '0', 10);
      const x = parseInt(line.boundingBox?.vertices?.[0]?.x || '0', 10);
      const text = line.text || line.words?.map((w) => w.text || '').join(' ') || '';

      if (text.trim()) {
        elements.push({ y, x, text: text.trim() });
      }
    }
  }

  const lineGroups = groupByYPosition(elements, 15);

  let formattedText = '';
  let isTableSection = false;
  let pendingItem: { name: string; quantity: string; price: string } | null = null;

  const sortedLines = Object.entries(lineGroups)
    .sort(([a], [b]) => parseInt(a, 10) - parseInt(b, 10))
    .map(([, elements]) => {
      return elements
        .sort((a, b) => a.x - b.x)
        .map((el) => el.text)
        .join(' ');
    });

  for (const line of sortedLines) {
    if (isTableStart(line)) {
      isTableSection = true;
      formattedText += formatTableHeader(line) + '\n---\n';
      continue;
    }

    if (isTableEnd(line)) {
      isTableSection = false;
      if (pendingItem) {
        formattedText += formatTableRow(pendingItem) + '\n';
        pendingItem = null;
      }
      formattedText += '---\n';
      continue;
    }

    if (isTableSection) {
      const tableRow = parseTableRow(line);
      if (tableRow) {
        if (pendingItem) {
          formattedText += formatTableRow(pendingItem) + '\n';
        }
        pendingItem = tableRow;
      } else if (pendingItem && isItemContinuation(line)) {
        pendingItem.name += ' ' + line.trim();
      }
    } else {
      if (pendingItem) {
        formattedText += formatTableRow(pendingItem) + '\n';
        pendingItem = null;
      }
      formattedText += line + '\n';
    }
  }

  if (pendingItem) {
    formattedText += formatTableRow(pendingItem) + '\n';
  }

  return formattedText.trim();
}

function groupByYPosition(
  elements: Array<{ y: number; x: number; text: string }>,
  threshold: number
): Record<number, Array<{ x: number; text: string }>> {
  const groups: Record<number, Array<{ x: number; text: string }>> = {};

  for (const el of elements) {
    const existingY = Object.keys(groups).find((y) => Math.abs(parseInt(y, 10) - el.y) <= threshold);
    const yKey = existingY ? parseInt(existingY, 10) : el.y;
    groups[yKey] = groups[yKey] || [];
    groups[yKey].push({ x: el.x, text: el.text });
  }

  return groups;
}

function isTableStart(line: string): boolean {
  return (
    /(Блюдо|Наименование|Товар|Название).*(Кол-во|Количество|Кол\.).*(Сумма|Цена|Стоимость)/i.test(line) ||
    /ПОСТЕВОЙ СЧЕТ|ГОСТЕВОЙ СЧЁТ|ЧЕК НА ОПЛАТУ/i.test(line)
  );
}

function isTableEnd(line: string): boolean {
  return /(Итого|Всего|ИТОГО К ОПЛАТЕ|К ОПЛАТЕ|Total)/i.test(line);
}

function isItemContinuation(line: string): boolean {
  return !/\d+[.,]\d{2}/.test(line) && !/^\d+$/.test(line) && !isTableEnd(line);
}

function parseTableRow(line: string): { name: string; quantity: string; price: string } | null {
  const match1 = line.match(/^([^\d]+?)\s+(\d+[.,]\d+)\s+(\d+[.,]\d+)/);
  const match2 = line.match(/^\d+\)\s+(.+?)\s+(\d+[.,]\d+).*=\s*(\d+[.,]\d+)/);
  const match3 = line.match(/^(.+?)\s+(\d+)\s*x\s*(\d+[.,]\d+)\s*=\s*(\d+[.,]\d+)/);

  if (match1) {
    return {
      name: match1[1].trim(),
      quantity: match1[2].replace(',', '.'),
      price: match1[3].replace(',', '.')
    };
  }

  if (match2) {
    return {
      name: match2[1].trim(),
      quantity: match2[2].replace(',', '.'),
      price: match2[3].replace(',', '.')
    };
  }

  if (match3) {
    return {
      name: match3[1].trim(),
      quantity: match3[2],
      price: match3[4].replace(',', '.')
    };
  }

  return null;
}

function formatTableHeader(line: string): string {
  if (line.includes('|')) {
    return line.replace(/\s*\|\s*/g, ' | ');
  }
  return 'Наименование'.padEnd(40) + 'Кол-во'.padStart(8) + 'Сумма'.padStart(10);
}

function formatTableRow(item: { name: string; quantity: string; price: string }): string {
  return item.name.slice(0, 40).padEnd(40) + item.quantity.padStart(8) + item.price.padStart(10);
}
