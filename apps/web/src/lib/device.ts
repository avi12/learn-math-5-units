/** What this device is, read once: which role it opens in, and what it can do. */
import { pad } from './spen';

export type Role = 'pad' | 'board';

/** The page's own query string — `?role=`, `?room=`, `?pendebug`. */
export const params = new URL(location.href).searchParams;

/** A touch-primary screen: the tablet, as far as a browser can tell. */
const coarse = matchMedia('(pointer: coarse)').matches;

/** The tablet gets the pen, the desktop gets the mirror. `?role=` overrides. */
export function initialRole(): Role {
  const forced = params.get('role');
  if (forced === 'pad' || forced === 'board') {
    return forced;
  }

  return coarse ? 'pad' : 'board';
}

/** A device that scans is a device that is HELD. Inside the wrapper that is certain;
 *  otherwise it takes a touch-primary pointer and a camera. The desktop is the screen
 *  SHOWING the code — a scan button there is a button that can only ever fail, and it
 *  is the mirror image of the mistake the QR made by being board-only. */
export const canScan = !!pad() || (coarse && !!navigator.mediaDevices?.getUserMedia);
