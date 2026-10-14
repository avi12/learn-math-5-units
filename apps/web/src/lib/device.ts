/** What this device is, read once: which role it opens in, and what it can do. */
import { pad } from './spen';

/** Which half of the room this page is: the tablet that is written on, or the desktop
 *  mirror that is read from. Also the value of `?role=`. */
export const Role = { PAD: 'pad', BOARD: 'board' } as const;
export type Role = (typeof Role)[keyof typeof Role];

/** The page's own query parameters. Links already shared and QR codes already printed
 *  carry these names, so they never change. */
export const QueryParam = { ROLE: 'role', ROOM: 'room', PEN_DEBUG: 'pendebug' } as const;
export type QueryParam = (typeof QueryParam)[keyof typeof QueryParam];

/** The page's own query string — `?role=`, `?room=`, `?pendebug`. */
export const params = new URL(location.href).searchParams;

/** A touch-primary screen: the tablet, as far as a browser can tell. */
const coarse = matchMedia('(pointer: coarse)').matches;

function isRole(s: string | null): s is Role {
  return s === Role.PAD || s === Role.BOARD;
}

/** The tablet gets the pen, the desktop gets the mirror. `?role=` overrides. */
export function initialRole(): Role {
  const forced = params.get(QueryParam.ROLE);
  if (isRole(forced)) {
    return forced;
  }

  return coarse ? Role.PAD : Role.BOARD;
}

/** A device that scans is a device that is HELD. Inside the wrapper that is certain;
 *  otherwise it takes a touch-primary pointer and a camera. The desktop is the screen
 *  SHOWING the code — a scan button there is a button that can only ever fail, and it
 *  is the mirror image of the mistake the QR made by being board-only. */
export const canScan = !!pad() || (coarse && !!navigator.mediaDevices?.getUserMedia);
