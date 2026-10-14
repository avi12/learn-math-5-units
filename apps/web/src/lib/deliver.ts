/** Getting the board's picture out of the page: clipboard first, a file when the
 *  clipboard refuses, and the Android share sheet inside the wrapper.
 *
 *  Every route the board's image can leave by lives here, so "copy as image", "copy a
 *  part" and "check with Claude" cannot drift into three slightly different ideas of
 *  how a canvas becomes a PNG. */
import { pad } from './spen';

/** The one format the board's picture leaves in. */
export const PNG = 'image/png';

/** How a delivery ended, so the caller can say it in its own words. */
export const Delivered = {
  COPIED: 'copied',
  DOWNLOADED: 'downloaded',
  SHARE_FAILED: 'share-failed',
  EXPORT_FAILED: 'export-failed'
} as const;
export type Delivered = (typeof Delivered)[keyof typeof Delivered];

/** What reached the clipboard when the image and the text were sent together. */
export const Pasted = { BOTH: 'both', TEXT: 'text' } as const;
export type Pasted = (typeof Pasted)[keyof typeof Pasted];

/** The canvas as a PNG, or null when the browser could not encode it. */
export function pngBlob(c: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => c.toBlob(resolve, PNG));
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error);
    // readAsDataURL gives "data:<mime>;base64,<payload>"; the bridge wants the payload
    r.onload = () => resolve(String(r.result).split(',', 2)[1] ?? '');
    r.readAsDataURL(blob);
  });
}

/** Whether the share sheet took it. A browser download has no way to say, so it is true. */
async function download(blob: Blob): Promise<boolean> {
  const name = `math-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
  // Inside the Android wrapper an <a download> does nothing at all — a WebView ignores
  // downloads, and a blob: URL cannot be handed to a system downloader either. So the
  // bytes go over the bridge and out through the share sheet, which on a tablet is the
  // more useful destination anyway. In a browser tab nothing changes.
  const bridge = pad();
  if (bridge) {
    return bridge.share(name, blob.type || PNG, await blobToBase64(blob));
  }

  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
  return true;
}

/** The canvas onto the clipboard, or out as a file when the clipboard refuses — the
 *  download fallback is still a delivery. */
export async function copyImage(c: HTMLCanvasElement): Promise<Delivered> {
  const blob = await pngBlob(c);
  if (!blob) {
    return Delivered.EXPORT_FAILED;
  }

  try {
    await navigator.clipboard.write([new ClipboardItem({ [PNG]: blob })]);
    return Delivered.COPIED;
  } catch {
    return (await download(blob)) ? Delivered.DOWNLOADED : Delivered.SHARE_FAILED;
  }
}

/** Image and text together, for pasting both in one go. Falls back to the text alone,
 *  and says whether the image made it. */
export async function copyImageAndText(blob: Blob, text: string): Promise<Pasted> {
  try {
    await navigator.clipboard.write([
      new ClipboardItem({ [PNG]: blob, 'text/plain': new Blob([text], { type: 'text/plain' }) })
    ]);
    return Pasted.BOTH;
  } catch {
    await navigator.clipboard.writeText(text).catch(() => {});
    return Pasted.TEXT;
  }
}
