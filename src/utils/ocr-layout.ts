import type { OCRResponse } from '../interfaces';
import { parseMoneyToMinor } from './money';

type Box = { vertices?: Array<{ x: string; y: string }> };
type Cell = { text: string; x: number; right: number; y: number; height: number; lineX?: number; lineY?: number };
function cell(text: string, box?: Box): Cell | undefined {
  const vertices = box?.vertices || [];
  const xs = vertices.map((v) => Number(v.x)),
    ys = vertices.map((v) => Number(v.y));
  if (vertices.length < 2 || ![...xs, ...ys].every(Number.isFinite)) return;
  return { text, x: Math.min(...xs), right: Math.max(...xs), y: Math.max(...ys), height: Math.max(1, Math.max(...ys) - Math.min(...ys)) };
}
const median = (values: number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] || 0;

function reconstructSparseTable(response: OCRResponse, name?: Cell, qty?: Cell, sum?: Cell, price?: Cell): string | undefined {
  if (!name || !qty || !sum || price) return;
  const lines = (response.result?.textAnnotation?.blocks || []).flatMap((b) => b.lines || []);
  const originals = lines.map((l) => cell(l.text || '', l.boundingBox)).filter((c): c is Cell => !!c);
  const top = Math.max(name.y, qty.y, sum.y);
  const footer = originals.filter((c) => c.y > top && /^(?:итого|всего|к\s+оплате|subtotal)/i.test(c.text)).sort((a, b) => a.y - b.y)[0];
  if (!footer) return;
  const bottom = footer.y - footer.height / 2;
  const edge = (qty.right + sum.x) / 2;
  const names: Cell[] = [],
    amounts: Cell[] = [],
    counts: Cell[] = [];
  for (const line of lines) {
    const box = cell(line.text || '', line.boundingBox);
    if (!box || box.y <= top || box.y - box.height / 2 >= bottom || /^(?:итого|всего|к\s+оплате)/i.test(box.text)) continue;
    const words = (line.words || []).map((w) => cell(w.text || '', w.boundingBox)).filter((c): c is Cell => !!c);
    const parts = words.length ? words : [box];
    const buckets: Cell[][] = [[], [], []];
    for (const word of parts) {
      const mid = (word.x + word.right) / 2;
      buckets[mid < qty.x ? 0 : mid < edge ? 1 : 2].push(word);
    }
    for (const [index, bucket] of buckets.entries()) {
      if (!bucket.length) continue;
      const text = bucket
        .sort((a, b) => a.x - b.x)
        .map((c) => c.text)
        .join(' ');
      if (index === 0 && /^\d[\d\s]{9,}$/.test(text)) continue;
      const c = {
        ...box,
        text,
        x: Math.min(...bucket.map((c) => c.x)),
        right: Math.max(...bucket.map((c) => c.right)),
        y: median(bucket.map((c) => c.y - c.height / 2))
      };
      [names, counts, amounts][index].push(c);
    }
  }
  if (amounts.length < 4 || counts.length > amounts.length / 2) return;
  const merged: Cell[] = [];
  for (const a of amounts.sort((a, b) => a.y - b.y || a.x - b.x)) {
    const previous = merged[merged.length - 1];
    if (
      previous &&
      Math.abs(previous.y - a.y) < Math.min(a.height, previous.height) * 0.3 &&
      /^\d{1,3}$/.test(previous.text) &&
      /^\d{3}[.,]\d{2}$/.test(a.text)
    ) {
      previous.text += ' ' + a.text;
      previous.right = a.right;
    } else merged.push({ ...a });
  }
  if (merged.some((a) => parseMoneyToMinor(a.text) === undefined)) return;
  names.sort((a, b) => a.y - b.y);
  if (names.length < merged.length || names.length > merged.length * 2 || !names.length) return;
  const n = names.length,
    m = merged.length;
  const nameSpan = names[n - 1].y - names[0].y,
    amountSpan = merged[m - 1].y - merged[0].y;
  if (nameSpan <= 0 || amountSpan <= 0) return;
  const dp = Array.from({ length: n + 1 }, () => Array<number>(m + 1).fill(Infinity));
  const matched = Array.from({ length: n + 1 }, () => Array<boolean>(m + 1).fill(false));
  dp[0][0] = 0;
  for (let i = 1; i <= n; i++)
    for (let j = 0; j <= m; j++) {
      const continuation = /^(?:[а-яёa-z(«"]|\d+[.,]\d+$)/.test(names[i - 1].text) || names[i - 1].text.length <= 4;
      dp[i][j] = dp[i - 1][j] + (continuation ? 0.1 : 2);
      if (j > 0) {
        const distance = ((names[i - 1].y - names[0].y) / nameSpan - (merged[j - 1].y - merged[0].y) / amountSpan) * m;
        const cost = dp[i - 1][j - 1] + distance * distance;
        if (cost < dp[i][j]) {
          dp[i][j] = cost;
          matched[i][j] = true;
        }
      }
    }
  if (dp[n][m] > m * 1.5) return;
  const pairs: Array<{ nameIndex: number; amountIndex: number }> = [];
  for (let i = n, j = m; i > 0; i--)
    if (matched[i][j]) {
      pairs.push({ nameIndex: i - 1, amountIndex: j - 1 });
      j--;
    }
  pairs.reverse();
  if (pairs.length !== m || pairs[0].nameIndex !== 0) return;
  return pairs
    .map((pair, index) => {
      const end = pairs[index + 1]?.nameIndex ?? names.length;
      const label = names
        .slice(pair.nameIndex, end)
        .map((n) => n.text)
        .join(' ');
      const amount = merged[pair.amountIndex];
      const near = counts.filter((c) => Math.abs(c.y - amount.y) <= Math.min(c.height, amount.height) * 0.5);
      return label + '\t' + (near.length === 1 ? near[0].text : '') + '\t' + amount.text;
    })
    .join('\n');
}

export function reconstructReceiptRows(response: OCRResponse): string {
  const lines = (response.result?.textAnnotation?.blocks || []).flatMap((b) => b.lines || []);
  if (!lines.length) return response.result?.textAnnotation?.fullText?.trim() || '';
  const slopes: Array<{ y: number; value: number; height: number; total: boolean }> = [];
  const cells: Cell[] = [];
  for (const line of lines) {
    const text =
      line.text?.trim() ||
      line.words
        ?.map((w) => w.text || '')
        .join(' ')
        .trim() ||
      '';
    if (!text) continue;
    const positioned = cell(text, line.boundingBox);
    if (!positioned) return lines.map((l) => l.text || l.words?.map((w) => w.text || '').join(' ') || '').join('\n');
    const words = (line.words || []).map((w) => cell(w.text || '', w.boundingBox)).filter((w): w is Cell => !!w && !!w.text);
    if (words.length >= 2) {
      const ordered = [...words].sort((a, b) => a.x - b.x);
      const values = [];
      for (let i = 0; i < ordered.length; i++)
        for (let j = i + 1; j < ordered.length; j++) {
          const a = ordered[i],
            b = ordered[j];
          const dx = (b.x + b.right - a.x - a.right) / 2;
          if (dx < Math.max(60, a.height * 3) || Math.max(a.height, b.height) > Math.min(a.height, b.height) * 1.7) continue;
          const value = (b.y - a.y) / dx;
          if (Math.abs(value) <= 0.35) values.push(value);
        }
      if (values.length)
        slopes.push({
          y: positioned.y,
          value: median(values),
          height: positioned.height,
          total: /^(?:итого\s+к\s+оплате|к\s+оплате|amount\s+due)/i.test(text)
        });
    }
    cells.push(
      ...(words.length === line.words?.length && words.length ? words : [positioned]).map((c) => ({
        ...c,
        lineX: (positioned.x + positioned.right) / 2,
        lineY: positioned.y - positioned.height / 2
      }))
    );
  }
  const origin = Math.min(...cells.map((c) => c.x));
  const headerName = cells.find((c) => /^(?:наименование|блюдо|name)[.:]?$/i.test(c.text));
  const headerSum = cells.find((c) => /^(?:сумма|sum|amount)[.:]?$/i.test(c.text));
  const headerQty = cells.find((c) => /^(?:кол[- ]?во|количество|qty)[.:]?$/i.test(c.text));
  const headerPrice = cells.find((c) => /^(?:цена|price)[.:]?$/i.test(c.text));
  const sparse = reconstructSparseTable(response, headerName, headerQty, headerSum, headerPrice);
  for (const c of cells) {
    const near = [...slopes].sort((a, b) => Math.abs(a.y - c.y) - Math.abs(b.y - c.y)).slice(0, 5);
    const footerSlope = near.find((s) => s.total && Math.abs(s.y - c.y) < s.height * 3);
    const slope = footerSlope?.value ?? median(near.map((s) => s.value));
    c.y -= slope * ((c.x + c.right) / 2 - origin);
  }
  const rows: Array<{ y: number; height: number; cells: Cell[] }> = [];
  for (const c of cells.sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = rows
      .filter(
        (r) =>
          Math.abs(r.y - c.y) <= Math.min(r.height, c.height) * 0.55 &&
          r.cells.every(
            (w) =>
              c.x >= w.right - 2 ||
              c.right <= w.x + 2 ||
              (/^\d/.test(c.text) &&
                /^\d/.test(w.text) &&
                Math.min(c.right, w.right) - Math.max(c.x, w.x) < Math.min(c.right - c.x, w.right - w.x) * 0.45)
          )
      )
      .sort((a, b) => Math.abs(a.y - c.y) - Math.abs(b.y - c.y))[0];
    if (row) {
      row.cells.push(c);
      row.y = median(row.cells.map((w) => w.y));
    } else rows.push({ y: c.y, height: c.height, cells: [c] });
  }
  const cols =
    headerName && headerQty && headerSum
      ? [headerName, ...(headerPrice ? [headerPrice] : []), headerQty, headerSum].sort((a, b) => a.x - b.x)
      : [];
  let inTable = false;
  let sparseInserted = false;
  return rows
    .sort((a, b) => a.y - b.y)
    .map((r) => {
      const ordered = r.cells.sort((a, b) => a.x - b.x);
      const text = ordered.map((c) => c.text).join(' ');
      if (/^(?:итого|всего|к\s+оплате|сумма\s+заказов|подытог|обслуживание)/i.test(text)) inTable = false;
      if (ordered.includes(headerName!)) {
        inTable = true;
        if (sparse) {
          sparseInserted = true;
          return text + '\n' + sparse;
        }
        return text;
      }
      if (inTable && sparseInserted) return '';
      if (inTable && cols.length && !ordered.includes(headerQty!) && !ordered.includes(headerSum!)) {
        const buckets = cols.map(() => [] as string[]);
        for (const c of ordered) {
          let index = 0;
          for (let i = 1; i < cols.length; i++) {
            const boundary = cols[i] === headerSum ? (cols[i - 1].right + cols[i].x) / 2 : cols[i].x;
            if ((c.x + c.right) / 2 >= boundary) index = i;
          }
          buckets[index].push(c.text);
        }
        if (buckets[buckets.length - 1].length) return buckets.map((b) => b.join(' ')).join('\t');
      }
      return text;
    })
    .filter(Boolean)
    .join('\n');
}
