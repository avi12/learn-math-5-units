/** Canvas -> LaTeX, entirely in this browser.
 *
 * No API key, no proxy, no server: transformers.js runs an ONNX build of texify2 on
 * the device. The model is fetched from the Hugging Face CDN on first use (~320MB,
 * q8) and cached by the browser after that.
 *
 * The preprocessing is not optional. Fed the canvas as-is the model returns nonsense,
 * and both reasons are mundane:
 *   - the exported canvas is transparent-backed, so an RGBA read is black on black;
 *   - the formula occupies a small part of a wide canvas, and the model expects a
 *     formula, not a page.
 * Flattening onto white and cropping to the ink turned "**(a)**: **(b)**: …" into
 * "y=x^{2}" on a real handwriting sample.
 */

const MODEL = 'Xenova/texify2';

export type Progress = { stage: string; pct: number };

let ready: Promise<(img: unknown, opts: unknown) => Promise<{ generated_text: string }[]>> | null =
  null;

export const configured = () => true; // nothing to configure any more

export class RecogniseError extends Error {}

/** Recognition is not free in time or battery, so the same drawing is never redone. */
const cache = new Map<string, string>();

function load(onProgress?: (p: Progress) => void) {
  if (!ready) {
    ready = import('@huggingface/transformers').then(({ pipeline }) =>
      pipeline('image-to-text', MODEL, {
        dtype: 'q8',
        progress_callback: (e: { status?: string; progress?: number; file?: string }) => {
          if (e.status === 'progress' && typeof e.progress === 'number')
            onProgress?.({ stage: e.file ?? '', pct: Math.round(e.progress) });
        }
      })
    ) as never;
  }
  return ready!;
}

/** Flatten onto white and trim to the ink, returning a canvas the model can read. */
function prepare(src: HTMLCanvasElement): HTMLCanvasElement | null {
  const ctx = src.getContext('2d');
  if (!ctx) return null;
  const { width, height } = src;
  const img = ctx.getImageData(0, 0, width, height);
  const d = img.data;
  let x0 = width, y0 = height, x1 = 0, y1 = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = d[i + 3] / 255;
      const r = d[i] * a + 255 * (1 - a);
      const g = d[i + 1] * a + 255 * (1 - a);
      const b = d[i + 2] * a + 255 * (1 - a);
      d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
      if ((r + g + b) / 3 < 200) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  if (x1 <= x0 || y1 <= y0) return null; // nothing drawn

  const pad = 24;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(width - 1, x1 + pad); y1 = Math.min(height - 1, y1 + pad);

  const flat = document.createElement('canvas');
  flat.width = width;
  flat.height = height;
  flat.getContext('2d')!.putImageData(img, 0, 0);

  const out = document.createElement('canvas');
  out.width = x1 - x0;
  out.height = y1 - y0;
  out.getContext('2d')!.drawImage(flat, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

function tidy(text: string): string {
  return text
    .trim()
    .replace(/^```(?:latex)?\s*|\s*```$/g, '')
    .replace(/^\$\$?|\$\$?$/g, '')
    .trim();
}

export async function toLatex(
  canvas: HTMLCanvasElement,
  key: string,
  onProgress?: (p: Progress) => void,
  /** the "recognise again" button exists to retry a bad read, so it skips the cache */
  force = false
): Promise<string> {
  const hit = cache.get(key);
  if (!force && hit !== undefined) return hit;

  const prepared = prepare(canvas);
  if (!prepared) throw new RecogniseError('empty-canvas');

  const ocr = await load(onProgress);
  const out = await ocr(prepared, { max_new_tokens: 256 });
  const latex = tidy(out?.[0]?.generated_text ?? '');
  cache.set(key, latex);
  return latex;
}
