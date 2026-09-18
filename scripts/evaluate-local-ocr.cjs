const fs = require('node:fs');
const path = require('node:path');
const { createWorker } = require('tesseract.js');
async function main() {
  const dir = path.resolve('data/receipt-evaluation');
  fs.mkdirSync(dir, { recursive:true });
  const worker = await createWorker('rus+eng', 1, { langPath:process.cwd(), cachePath:dir, gzip:false, corePath:require.resolve('tesseract.js-core/tesseract-core-simd-lstm.wasm.js') });
  try {
    for (const [index,file] of process.argv.slice(2).entries()) {
      const cache = path.join(dir,'local-' + (index+1) + '.json');
      const data = fs.existsSync(cache) ? JSON.parse(fs.readFileSync(cache,'utf8')) : (await worker.recognize(file, {}, {blocks:true,text:true})).data;
      fs.writeFileSync(cache, JSON.stringify(data), { mode:0o600 });
      console.log(JSON.stringify({sample:index+1,text:data.text}));
    }
  } finally { await worker.terminate(); }
}
main().catch(e=>{console.error(e.name+': '+e.message);process.exitCode=1;});
