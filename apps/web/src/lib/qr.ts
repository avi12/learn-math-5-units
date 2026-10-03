/** The code the tablet scans to join this room. */

/** What the QR encodes. Explicitly role=pad: the code is scanned BY the tablet, and
 *  encoding location.href would hand it `role=board` and open a second mirror — two
 *  screens watching each other and nothing to write on. */
export function joinUrl(id: string): string {
  return `${location.origin}${location.pathname}?role=pad&room=${id}`;
}

/** The code as an image. The encoder is loaded only here, on first use: inside the
 *  Android wrapper no code is ever shown, so the tablet never downloads it. */
export async function qrImage(text: string): Promise<string> {
  const { default: QRCode } = await import('qrcode');
  return QRCode.toDataURL(text, { margin: 1, width: 300 });
}
