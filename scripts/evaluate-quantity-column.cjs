const fs = require('node:fs');
const sharp = require('sharp');
const { createWorker, PSM } = require('tesseract.js');
async function main() {
  const index = Number(process.argv[2]);
  const data = JSON.parse(fs.readFileSync('data/receipt-evaluation/sample-' + index + '.json', 'utf8'));
  const lines = data.response.result.textAnnotation.blocks.flatMap(b => b.lines || []);
  const box = l => {
    const vs = l.boundingBox.vertices;
    return { left:Math.min(...vs.map(v=>+v.x)), right:Math.max(...vs.map(v=>+v.x)), top:Math.min(...vs.map(v=>+v.y)), bottom:Math.max(...vs.map(v=>+v.y)) };
  };
  const q = box(lines.find(l => /^Кол-во$/i.test(l.text)));
  const s = box(lines.find(l => /^Сумма$/i.test(l.text)));
  const end = box(lines.find(l => /^(Итого|Всего)/i.test(l.text)));
  const left = q.left - 2, top = q.bottom + 5, right = Math.round((q.right+s.left)/2);
  const content = await sharp(data.source).extract({left,top,width:right-left,height:end.top-top}).resize({width:(right-left)*4}).greyscale().normalise().png().toBuffer();
  const worker = await createWorker('eng',1,{langPath:process.cwd(),cachePath:'data/receipt-evaluation',gzip:false,corePath:require.resolve('tesseract.js-core/tesseract-core-simd-lstm.wasm.js')});
  try {
    await worker.setParameters({tessedit_pageseg_mode: PSM.SINGLE_BLOCK,tessedit_char_whitelist:'0123456789.,'});
    const result=(await worker.recognize(content,{}, {blocks:true,text:true})).data;
    console.log(JSON.stringify({index,text:result.text,blocks:result.blocks}));
    fs.writeFileSync('data/receipt-evaluation/quantities-'+index+'.json',JSON.stringify(result));
  } finally { await worker.terminate(); }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
