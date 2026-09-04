/** Read a room out of the QR on the desktop, with the tablet's camera.
 *
 * The tablet is the device that cannot type: a room id is 32 hex characters, and nobody
 * enters those twice. Pasting works when there is something to paste from, which inside
 * the WebView wrapper there usually is not. Pointing the camera at the screen is the
 * gesture that always works.
 *
 * Two decoders, and which one runs is decided by the device rather than by taste.
 * `BarcodeDetector` is native on Android — the only place this button appears — so the
 * tablet decodes with no download at all. Everywhere else (a desktop browser, where this
 * is really only exercised by the tests) jsQR is pulled in dynamically, so it never
 * reaches the bundle the tablet loads.
 */

type Reader = () => Promise<string | null>;

interface DetectorCtor {
  new (opts: { formats: string[] }): { detect(src: CanvasImageSource): Promise<{ rawValue: string }[]> };
  getSupportedFormats?(): Promise<string[]>;
}

async function nativeReader(video: HTMLVideoElement): Promise<Reader | null> {
  const Detector = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
  if (!Detector) return null;
  try {
    const formats = (await Detector.getSupportedFormats?.()) ?? ['qr_code'];
    if (!formats.includes('qr_code')) return null;
    const det = new Detector({ formats: ['qr_code'] });
    return async () => (await det.detect(video))[0]?.rawValue ?? null;
  } catch {
    return null; // the constructor throws on some builds that expose the name only
  }
}

async function fallbackReader(video: HTMLVideoElement): Promise<Reader> {
  const { default: jsQR } = await import('jsqr');
  const frame = document.createElement('canvas');
  const g = frame.getContext('2d', { willReadFrequently: true })!;
  return async () => {
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return null;
    frame.width = w;
    frame.height = h;
    g.drawImage(video, 0, 0, w, h);
    return jsQR(g.getImageData(0, 0, w, h).data, w, h)?.data ?? null;
  };
}

/** Start the camera and watch for a code. Resolves with the stop function; call it when
 *  the overlay closes, or the camera stays on and the tablet stays warm. */
export async function scan(
  video: HTMLVideoElement,
  onfound: (text: string) => void
): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
    audio: false
  });
  video.srcObject = stream;
  video.setAttribute('playsinline', '');
  video.muted = true;
  await video.play();

  const read = (await nativeReader(video)) ?? (await fallbackReader(video));
  let live = true;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const look = async () => {
    if (!live) return;
    try {
      const text = await read();
      if (text) {
        onfound(text);
        return; // whoever was told is expected to stop us
      }
    } catch {
      /* a frame that cannot be decoded is the normal case, not an error */
    }
    // four looks a second reads a screen instantly and leaves the tablet cool
    timer = setTimeout(look, 220);
  };
  void look();

  return () => {
    live = false;
    clearTimeout(timer);
    for (const track of stream.getTracks()) track.stop();
    video.srcObject = null;
  };
}
