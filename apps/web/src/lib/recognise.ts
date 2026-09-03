/** Canvas -> LaTeX.
 *
 * Two ways to reach the model, both configured from inside the page and kept in this
 * browser's localStorage — nothing is baked into the bundle or committed:
 *
 *   direct  an Anthropic API key, and the browser calls the API itself. Needs the
 *           `anthropic-dangerous-direct-browser-access` header, without which CORS
 *           blocks the request outright (verified: with it a bad key comes back 401,
 *           without it the fetch never leaves the browser). The key sits in your own
 *           browser on your own devices — the "internal tool, trusted user" case the
 *           SDK docs name as the reasonable one.
 *   proxy   a URL for worker/ocr.js, if you would rather the key never be on the
 *           device at all.
 *
 * With neither configured the formula bar is just an editor and you type the maths.
 */

const K_KEY = 'avi-math-ocr-key';
const K_ENDPOINT = 'avi-math-ocr-endpoint';

// Claude Opus 5. 'claude-haiku-4-5' is about five times cheaper per call and usually
// enough to transcribe a single handwritten expression.
const MODEL = 'claude-opus-5';

const PROMPT = `Transcribe the handwritten mathematics in this image into a single line of LaTeX.

Rules:
- Output ONLY the LaTeX. No $ delimiters, no \\[ \\], no explanation, no markdown fence.
- If several lines are written, join them with \\\\ so it stays one LaTeX string.
- Preserve exactly what is written, including mistakes. Do not solve, simplify or correct.
- Use \\frac for fractions, \\sqrt for roots, ^ and _ for scripts, \\sin \\cos \\tan \\log \\ln,
  \\int \\sum \\lim with their bounds, and Greek letters by name.
- If the image has no mathematics in it, output nothing at all.`;

const read = (k: string) => {
  try {
    return localStorage.getItem(k) ?? '';
  } catch {
    return '';
  }
};

export const apiKey = () => read(K_KEY);
export const endpoint = () => read(K_ENDPOINT) || (import.meta.env.VITE_OCR_ENDPOINT ?? '');
export const configured = () => apiKey().length > 0 || endpoint().length > 0;

function write(k: string, v: string) {
  const clean = v.trim();
  try {
    if (clean) localStorage.setItem(k, clean);
    else localStorage.removeItem(k);
  } catch {
    /* private mode */
  }
}
export const setApiKey = (v: string) => write(K_KEY, v);
export const setEndpoint = (v: string) => write(K_ENDPOINT, v.replace(/\/+$/, ''));

/** Recognition is charged per call, so the same drawing is never sent twice. */
const cache = new Map<string, string>();

export class RecogniseError extends Error {}

function tidy(text: string): string {
  return text
    .trim()
    .replace(/^```(?:latex)?\s*|\s*```$/g, '')
    .replace(/^\$+|\$+$/g, '')
    .trim();
}

async function base64(canvas: HTMLCanvasElement): Promise<string> {
  const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  if (!blob) throw new RecogniseError('export-failed');
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000)
    bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function direct(image: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey(),
      'anthropic-version': '2023-06-01',
      // without this the browser never even sends the request
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: image } },
            { type: 'text', text: PROMPT }
          ]
        }
      ]
    })
  });
  const data = (await res.json().catch(() => ({}))) as {
    content?: { type: string; text?: string }[];
    stop_reason?: string;
    error?: { message?: string; type?: string };
  };
  if (data.error)
    throw new RecogniseError(data.error.type || data.error.message || `http-${res.status}`);
  if (!res.ok) throw new RecogniseError(`http-${res.status}`);
  if (data.stop_reason === 'refusal') throw new RecogniseError('refused');
  return tidy(
    (data.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('')
  );
}

async function viaProxy(image: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(endpoint(), {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image })
  });
  const data = (await res.json().catch(() => ({}))) as { latex?: string; error?: string };
  if (data.error) throw new RecogniseError(data.error);
  if (!res.ok) throw new RecogniseError(`http-${res.status}`);
  return tidy(data.latex ?? '');
}

export async function toLatex(
  canvas: HTMLCanvasElement,
  key: string,
  signal?: AbortSignal,
  /** the "recognise again" button exists to retry a bad read, so it skips the cache */
  force = false
): Promise<string> {
  const hit = cache.get(key);
  if (!force && hit !== undefined) return hit;
  if (!configured()) throw new RecogniseError('not-configured');

  const image = await base64(canvas);
  const latex = apiKey() ? await direct(image, signal) : await viaProxy(image, signal);
  cache.set(key, latex);
  return latex;
}
