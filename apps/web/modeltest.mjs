/** Try a FOSS in-browser LaTeX OCR model on a real handwriting sample.
 *
 * Model cards argue; this measures. Runs the same transformers.js pipeline the browser
 * would run, on the actual canvas export, and prints what comes back.
 *
 *   node modeltest.mjs handwriting.png Xenova/texify2
 */
import { pipeline, RawImage } from '@huggingface/transformers';
import fs from 'node:fs';

const file = process.argv[2] ?? 'handwriting.png';
const modelId = process.argv[3] ?? 'Xenova/texify2';

console.log('model :', modelId);
console.log('image :', file, fs.statSync(file).size, 'bytes');

const t0 = Date.now();
let ocr;
try {
  ocr = await pipeline('image-to-text', modelId, { dtype: process.env.DTYPE || 'q8' });
} catch (e) {
  console.log('LOAD FAILED:', e.message.slice(0, 300));
  process.exit(2);
}
console.log('loaded in', ((Date.now() - t0) / 1000).toFixed(1), 's');

let image = await RawImage.read(file);
console.log('size  :', image.width + 'x' + image.height);

// The canvas export is transparent-backed, so flatten it onto white first - a model
// fed straight RGBA sees black on black. Then trim to the ink with a small margin,
// because these models expect a formula, not a page of empty space.
{
  const r = image.rgba();
  const { data, width, height } = r;
  let x0 = width, y0 = height, x1 = 0, y1 = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = data[i + 3] / 255;
      const lum = a === 0 ? 255 : (data[i] * a + 255 * (1 - a) + data[i + 1] * a + 255 * (1 - a) + data[i + 2] * a + 255 * (1 - a)) / 3;
      data[i] = data[i] * a + 255 * (1 - a);
      data[i + 1] = data[i + 1] * a + 255 * (1 - a);
      data[i + 2] = data[i + 2] * a + 255 * (1 - a);
      data[i + 3] = 255;
      if (lum < 200) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  console.log('ink bbox  :', x0, y0, x1, y1);
  image = r;
  if (x1 > x0 && y1 > y0) {
    const pad = 24;
    image = await r.crop([
      Math.max(0, x0 - pad), Math.max(0, y0 - pad),
      Math.min(width - 1, x1 + pad), Math.min(height - 1, y1 + pad)
    ]);
    console.log('cropped to:', image.width + 'x' + image.height);
  }
  await image.save('cropped.png');
}

const t1 = Date.now();
const out = await ocr(image, { max_new_tokens: 256 });
console.log('infer :', ((Date.now() - t1) / 1000).toFixed(1), 's');
console.log('OUTPUT:', JSON.stringify(out));
