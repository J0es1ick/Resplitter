import sharp from 'sharp';
import type { OCRResponse } from '../interfaces';

export async function prepareOcrRetry(file: string, response: OCRResponse): Promise<Buffer> {
  const input = sharp(file, { limitInputPixels: 25_000_000, failOn: 'error' });
  const metadata = await input.metadata();
  const width = metadata.width || 0,
    height = metadata.height || 0;
  if (!width || !height) throw new Error('INVALID_IMAGE');
  const vertices = (response.result?.textAnnotation?.blocks || [])
    .flatMap((b) => b.lines || [])
    .flatMap((l) => l.boundingBox?.vertices || []);
  const xs = vertices.map((v) => Number(v.x)).filter(Number.isFinite),
    ys = vertices.map((v) => Number(v.y)).filter(Number.isFinite);
  const left = xs.length ? Math.max(0, Math.floor(Math.min(...xs)) - 24) : 0;
  const top = ys.length ? Math.max(0, Math.floor(Math.min(...ys)) - 24) : 0;
  const right = xs.length ? Math.min(width, Math.ceil(Math.max(...xs)) + 24) : width;
  const bottom = ys.length ? Math.min(height, Math.ceil(Math.max(...ys)) + 24) : height;
  if (right <= left || bottom <= top) throw new Error('INVALID_OCR_GEOMETRY');
  const scale = Math.min(3, 2800 / (right - left), 5000 / (bottom - top));
  return input
    .extract({ left, top, width: right - left, height: bottom - top })
    .resize({ width: Math.round((right - left) * scale), kernel: 'lanczos3' })
    .greyscale()
    .normalise({ lower: 1, upper: 99 })
    .sharpen()
    .jpeg({ quality: 94 })
    .toBuffer();
}
