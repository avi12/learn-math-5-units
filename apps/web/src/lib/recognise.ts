/** Canvas -> LaTeX.
 *
 * The model runs behind a small proxy because an API key cannot sit in a browser
 * bundle. Point VITE_OCR_ENDPOINT at it (see worker/ocr.js for a Cloudflare Worker
 * that is the whole server side). With no endpoint configured the formula bar falls
 * back to typing, which is what it did before this existed.
 */

/** Runtime first, build-time second: the Worker URL is not known until the Worker is
 *  deployed, and pasting it into the page beats rebuilding the site to bake it in. */
const KEY = 'avi-math-ocr-endpoint';

export function endpoint(): string {
  try {
    return localStorage.getItem(KEY) || (import.meta.env.VITE_OCR_ENDPOINT ?? '');
  } catch {
    return import.meta.env.VITE_OCR_ENDPOINT ?? '';
  }
}

export function setEndpoint(url: string): void {
  const clean = url.trim().replace(/\/+$/, '');
  if (clean) localStorage.setItem(KEY, clean);
  else localStorage.removeItem(KEY);
}

export function configured(): boolean {
  return endpoint().length > 0;
}

/** Recognition is charged per call, so the same drawing is never sent twice. */
const cache = new Map<string, string>();

export class RecogniseError extends Error {}

export async function toLatex(
  canvas: HTMLCanvasElement,
  key: string,
  signal?: AbortSignal,
  /** the "recognise again" button exists precisely to retry a bad read, so it must
   *  bypass the cache — only the automatic path is allowed to dedupe */
  force = false
): Promise<string> {
  const hit = cache.get(key);
  if (!force && hit !== undefined) return hit;
  const url = endpoint();
  if (!url) throw new RecogniseError('no-endpoint');

  const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  if (!blob) throw new RecogniseError('export-failed');
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: btoa(bin) }),
    signal
  });
  // the proxy explains itself in the body even when it fails, and "upstream-401"
  // is a far more actionable message than "http-502"
  const data = (await res.json().catch(() => ({}))) as { latex?: string; error?: string };
  if (data.error) throw new RecogniseError(data.error);
  if (!res.ok) throw new RecogniseError(`http-${res.status}`);
  const latex = (data.latex ?? '').trim();
  cache.set(key, latex);
  return latex;
}
