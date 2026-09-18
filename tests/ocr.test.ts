import assert from 'node:assert/strict';
import test from 'node:test';
import { extractTextFromOcrResponse } from '../src/utils/handle';

test('OCR without geometry preserves line boundaries and supports fullText', () => {
  assert.equal(
    extractTextFromOcrResponse({ result: { textAnnotation: { blocks: [{ lines: [{ text: 'Чай 100.00' }, { text: 'ИТОГО 100.00' }] }] } } }),
    'Чай 100.00\nИТОГО 100.00'
  );
  assert.equal(
    extractTextFromOcrResponse({ result: { textAnnotation: { fullText: ' Чай 100.00\nИТОГО 100.00 ' } } }),
    'Чай 100.00\nИТОГО 100.00'
  );
});
test('OCR reassembles table columns using image-relative geometry', () => {
  const line = (text: string, x: number, y: number) => ({
    text,
    boundingBox: {
      vertices: [
        { x: String(x), y: String(y) },
        { x: String(x + 50), y: String(y + 10) }
      ]
    }
  });
  const text = extractTextFromOcrResponse({
    result: {
      textAnnotation: {
        blocks: [{ lines: [line('100.00', 100, 10), line('200.00', 100, 25)] }, { lines: [line('Чай', 0, 10), line('Кофе', 0, 25)] }]
      }
    }
  });
  assert.equal(text, 'Чай 100.00\nКофе 200.00');
});
