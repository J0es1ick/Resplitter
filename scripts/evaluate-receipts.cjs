const fs = require('node:fs');
const { setTimeout } = require('node:timers');
const path = require('node:path');
const { config } = require('../dist/src/config');
const { recognizeReceiptImage, recognizeReceiptContent, extractTextFromOcrResponse } = require('../dist/src/utils/handle');
const { prepareOcrRetry } = require('../dist/src/utils/ocr-preprocess');
const { parseReceiptText } = require('../dist/src/utils/receipt-parser');
const model = process.argv.includes('--table') ? 'table' : 'page';
const enhanced = process.argv.includes('--enhanced');
async function recognize(file, index) {
  const source = enhanced ? JSON.parse(fs.readFileSync('data/receipt-evaluation/sample-' + index + '.json', 'utf8')) : undefined;
  if (source && source.source !== file) throw new Error('Source mismatch');
  const content = source ? await prepareOcrRetry(file, source.response) : undefined;
  for (let attempt = 0; ; attempt++) {
    try { return content ? await recognizeReceiptContent(content, 'JPEG', config.ocr, model) : await recognizeReceiptImage(file, config.ocr, model); }
    catch (error) {
      if (attempt >= 3 || ![429, 503].includes(error.response?.status)) throw error;
      await new Promise(resolve => setTimeout(resolve, 3000 * (attempt + 1)));
    }
  }
}
async function main() {
  const files = process.argv.slice(2).filter(a => !a.startsWith('--'));
  if (!files.length) throw new Error('Pass image paths explicitly');
  fs.mkdirSync('data/receipt-evaluation', { recursive: true });
  for (let i = 0; i < files.length; i++) {
    const suffix = enhanced ? '-enhanced' : model === 'table' ? '-table' : '';
    const cache = path.resolve('data/receipt-evaluation/sample-' + (i + 1) + suffix + '.json');
    const cached = fs.existsSync(cache) ? JSON.parse(fs.readFileSync(cache, 'utf8')) : undefined;
    const response = cached?.source === files[i] ? cached.response : await recognize(files[i], i + 1);
    if (!cached || cached.source !== files[i]) fs.writeFileSync(cache, JSON.stringify({ source: files[i], response }), { mode:0o600 });
    const text = extractTextFromOcrResponse(response);
    const receipt = parseReceiptText(text);
    fs.writeFileSync(path.resolve('data/receipt-evaluation/sample-' + (i + 1) + suffix + '.txt'), text, { mode:0o600 });
    console.log(JSON.stringify({ sample:i+1, text, receipt }));
  }
}
main().catch(e => { console.error(JSON.stringify({ name:e.name, code:e.code, status:e.response?.status })); process.exitCode=1; });
