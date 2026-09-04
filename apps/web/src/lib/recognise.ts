/** Canvas -> LaTeX, entirely in this browser.
 *
 * No API key, no proxy, no server: transformers.js runs an ONNX build of texify2 on
 * the device. The model is fetched from the Hugging Face CDN on first use (305.2MB
 * measured, q8) and cached by the browser after that.
 *
 * **One formula per read.** texify2 answers with a single expression, so a picture of
 * two equations comes back as the first one and the second is silently dropped. Measured
 * on a real two-line sample: together they gave `y=X^{2}+n^{3}4z`, and the second line
 * alone gave `F(X)=` — the model could read it perfectly well, it was never asked. So
 * the caller hands over one canvas per writing line (`lines()` in ink.ts) and this runs
 * the model once per line.
 *
 * The preprocessing is not optional either. Fed a canvas as-is the model returns
 * nonsense, for three mundane reasons:
 *   - the exported canvas is transparent-backed, so an RGBA read is black on black;
 *   - in the dark theme the background is painted near-black, and every pixel then
 *     looks like ink;
 *   - the formula occupies a small part of a wide canvas, and the model expects a
 *     formula, not a page.
 * Flattening, normalising to dark-on-light and cropping to the ink turned
 * "**(a)**: **(b)**: …" into "y=x^{2}" on a real handwriting sample.
 */

const MODEL = 'Xenova/texify2';

export type Progress = { stage: string; pct: number };

/** A single writing line: the canvas to read, and the stroke ids it is made of. */
export type Line = { key: string; canvas: HTMLCanvasElement };

/** There is exactly one model download, ever, so it is reported from one place rather
 *  than by whichever read happened to trigger it. That ownership was the bug: the first
 *  reader's callback outlived its own read, so aborting that read left the download
 *  still writing "downloading 46%" into a status line that had moved on. `null` means
 *  nothing is downloading. */
const watchers = new Set<(p: Progress | null) => void>();

export function onDownload(cb: (p: Progress | null) => void): () => void {
  watchers.add(cb);
  return () => void watchers.delete(cb);
}

function announce(p: Progress | null) {
  for (const w of watchers) w(p);
}

class RecogniseError extends Error {}

/** Recognition is not free in time or battery, so the same drawing is never redone. */
const cache = new Map<string, string>();

type Ocr = (img: unknown, opts: unknown) => Promise<{ generated_text: string }[]>;
/** transformers.js can be told to stop generating mid-sequence; this is that handle. */
type Halt = { interrupt(): void };
type Engine = { ocr: Ocr; halt: () => Halt };

let ready: Promise<Engine> | null = null;

function load(): Promise<Engine> {
  ready ??= import('@huggingface/transformers')
    .then(async (t) => {
      const ocr = (await t.pipeline('image-to-text', MODEL, {
        dtype: 'q8',
        progress_callback: (e: { status?: string; progress?: number; file?: string }) => {
          if (e.status === 'progress' && typeof e.progress === 'number')
            announce({ stage: e.file ?? '', pct: Math.round(e.progress) });
        }
      })) as unknown as Ocr;
      announce(null);
      return { ocr, halt: () => new t.InterruptableStoppingCriteria() as Halt };
    })
    // a failed download must not poison every later attempt — the next call retries
    .catch((e) => {
      ready = null;
      announce(null);
      throw e;
    });
  return ready;
}

/** Flatten, normalise to dark ink on a light ground, and trim to the ink.
 *
 *  The ground is read from the corner rather than assumed: the export paints the board
 *  colour across the whole rect, and in the dark theme that colour is near-black. Testing
 *  "is this pixel dark" against a dark ground marked the entire canvas as ink, so the
 *  crop was the whole board and the model got a black rectangle. Inverting a dark export
 *  keeps the antialiasing, which binarising would have thrown away. */
function prepare(src: HTMLCanvasElement): HTMLCanvasElement | null {
  const ctx = src.getContext('2d');
  if (!ctx) return null;
  const { width, height } = src;
  const img = ctx.getImageData(0, 0, width, height);
  const d = img.data;

  /** one channel of a pixel, composited over white so alpha stops mattering */
  const over = (i: number, ch: number) => {
    const a = d[i + 3] / 255;
    return d[i + ch] * a + 255 * (1 - a);
  };
  // The board colour, read from the four corners rather than one: a stroke can reach a
  // corner, but not three of them, so the median of the four is always board.
  const lum = (i: number) => (over(i, 0) + over(i, 1) + over(i, 2)) / 3;
  const corners = [
    lum(0),
    lum((width - 1) * 4),
    lum((height - 1) * width * 4),
    lum(((height - 1) * width + width - 1) * 4)
  ].sort((a, b) => a - b);
  const ground = (corners[1] + corners[2]) / 2;
  const invert = ground < 128;

  let x0 = width, y0 = height, x1 = 0, y1 = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      let r = over(i, 0), g = over(i, 1), b = over(i, 2);
      if (invert) { r = 255 - r; g = 255 - g; b = 255 - b; }
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

export function tidy(text: string): string {
  return (
    text
      .trim()
      .replace(/^```(?:latex)?\s*|\s*```$/g, '')
      .replace(/^\$\$?|\$\$?$/g, '')
      // texify2 reads a handwritten x as \chi — every x on Avi's board came back that
      // way. In school algebra chi does not occur and x is on every line, so the
      // mapping is safe here and wrong nowhere that matters. \chi{...} is not a thing,
      // so the lookahead only has to protect longer command names.
      .replace(/\\chi(?![a-zA-Z])/g, 'x')
      .replace(/\\Chi(?![a-zA-Z])/g, 'X')
      .trim()
  );
}

/** One answer, split into the rows it actually contains.
 *
 *  Handed a picture with several equations the model does not refuse: it answers with
 *  them glued together, `$…$$…$`, and MathLive then renders one run-on line that means
 *  nothing. The dollars are the only place the rows are recoverable from, so they are
 *  used as the separators they are. */
export function rows(text: string): string[] {
  return text
    .split('$')
    .map((piece) => tidy(piece))
    .filter(Boolean);
}

export type ReadOpts = {
  /** the "recognise again" button exists to retry a bad read, so it skips the cache */
  force?: boolean;
  /** the pen touching the glass again invalidates the read that is running */
  signal?: AbortSignal;
  /** which line is being read, so a multi-line wait can say so */
  onLine?: (done: number, total: number) => void;
  /** which lines came back empty or looping — silence about them is the old bug */
  onMiss?: (lines: number[]) => void;
  /** the whole board as one image, to fall back to when the split misreads */
  whole?: HTMLCanvasElement;
};

/** Several lines are one formula with rows, not several formulas: `aligned` is what a
 *  person can paste into a document unchanged, and what MathLive will hand back intact. */
function join(rows: string[]): string {
  const kept = rows.filter(Boolean);
  if (kept.length <= 1) return kept[0] ?? '';
  return `\\begin{aligned}${kept.join(' \\\\ ')}\\end{aligned}`;
}

/** Has the decoder fallen into a loop?
 *
 *  Handed a fragment that is not a formula - the bar of a fraction that got split away
 *  from its numerator, say - the model does not fail. It emits one short piece over and
 *  over until it runs out of tokens, and the result looks like real LaTeX. A person sees
 *  a fraction repeated eight times where they wrote one equation. Nothing downstream can
 *  tell that apart from a genuinely long formula, so it is caught here. */
export function degenerate(text: string): boolean {
  if (text.length < 60) return false;
  for (let n = 8; n <= 48; n++) {
    const piece = text.slice(0, n);
    if (piece.length < n) break;
    const times = text.split(piece).length - 1;
    // Counting repeats alone is not enough: a short prefix like "\frac{1}" turns up four
    // times in a perfectly ordinary expression. What marks a loop is that the repeated
    // piece TILES the answer - there is nothing else in it.
    if (times >= 4 && piece.length * times >= text.length * 0.8) return true;
  }
  return false;
}

export async function toLatex(
  lines: Line[],
  { force = false, signal, onLine, onMiss, whole }: ReadOpts = {}
): Promise<string> {
  /** Aborting is checked at every point where seconds could pass, and once more after
   *  each line — an interrupted generation still returns, just truncated, and a truncated
   *  formula published as the answer is worse than none. */
  const stop = () => {
    if (signal?.aborted) throw new DOMException('recognition superseded', 'AbortError');
  };

  stop();
  const work = lines
    .map(({ key, canvas }) => ({ key, image: prepare(canvas) }))
    .filter((l): l is { key: string; image: HTMLCanvasElement } => l.image !== null);
  if (!work.length) throw new RecogniseError('empty-canvas');

  // every line already read stays read; only the changed ones cost time
  if (!force && work.every((l) => cache.has(l.key)))
    return join(work.map((l) => cache.get(l.key)!));

  const { ocr, halt } = await load();
  stop();

  const readings: string[] = [];
  for (const [n, l] of work.entries()) {
    const hit = cache.get(l.key);
    if (!force && hit !== undefined) {
      readings.push(hit);
      continue;
    }
    onLine?.(n + 1, work.length);

    const interrupt = halt();
    const onAbort = () => interrupt.interrupt();
    signal?.addEventListener('abort', onAbort, { once: true });
    let out: { generated_text: string }[];
    try {
      out = await ocr(l.image, { max_new_tokens: 256, stopping_criteria: interrupt });
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
    stop();

    // one line's picture can still come back as several $-blocks; keep them as rows
    const row = rows(out?.[0]?.generated_text ?? '').join(' \\\\ ');
    if (row) cache.set(l.key, row);
    readings.push(row);
  }

  // Falling back to one read of the whole board is a LAST resort, and it used to fire
  // far too easily: one unreadable line out of four threw away the three that had been
  // read and returned a single whole-board read instead. That read cannot be right on a
  // multi-line board — the model answers one formula — and what came back was four
  // equations glued into one line, which is exactly what Avi was shown. So it now runs
  // only when the split produced nothing usable at all; anything usable is kept, and the
  // lines that failed are reported rather than quietly dropped.
  const good = readings.filter((r) => r && !degenerate(r));
  onMiss?.(readings.map((r, i) => (r && !degenerate(r) ? 0 : i + 1)).filter(Boolean));
  if (good.length === 0 && whole) {
    const image = prepare(whole);
    if (image) {
      const interrupt = halt();
      const onAbort = () => interrupt.interrupt();
      signal?.addEventListener('abort', onAbort, { once: true });
      let out: { generated_text: string }[];
      try {
        out = await ocr(image, { max_new_tokens: 256, stopping_criteria: interrupt });
      } finally {
        signal?.removeEventListener('abort', onAbort);
      }
      stop();
      // the whole board is several equations, and the model glues them with dollars —
      // taken apart they are rows again rather than one meaningless run-on line
      const one = rows(out?.[0]?.generated_text ?? '').filter((r) => !degenerate(r));
      if (one.length) {
        for (const l of work) cache.delete(l.key);
        return join(one);
      }
    }
  }

  // a loop with nothing to fall back to is still not an answer
  return join(readings.filter((r) => !degenerate(r)));
}
