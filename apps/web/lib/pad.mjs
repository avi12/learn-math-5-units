/** Getting a browser test onto the writing board, and knowing that it got there.
 *
 * The desktop guesses its role from `matchMedia('(pointer: coarse)')`, so a plain headless
 * Chrome opens `role=board` — the read-only mirror. `Surface.down()` returns on its first
 * line when `readonly` is set, so a test that opens the bare URL draws nothing at all:
 * every stroke is swallowed inside the page, every ink count comes back unchanged, and the
 * run looks exactly like a browser that refused to deliver the input.
 *
 * That reading cost a session. What went into the handoff was "CDP pointer events produce
 * no ink in this environment", with sticky touch emulation as the suspect and the four
 * browser tests written off as unrunnable. CDP was never involved.
 *
 * The fix is `asTablet`: tell the browser it has a touchscreen, and the app's own
 * detection puts itself on the writing board. `?role=pad` on the URL would also work, but
 * it *bypasses* the role detection, and the detection is part of what these tests are for.
 */

import { readFileSync } from 'node:fs';

/** The Firebase project the tests seed and read over REST — from `.env`, the same file
 *  the app is built from, so a test can never talk to a different database than the app. */
export const PROJECT = (() => {
  if (process.env.VITE_FIREBASE_PROJECT_ID) return process.env.VITE_FIREBASE_PROJECT_ID;
  const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
  const id = env.match(/^VITE_FIREBASE_PROJECT_ID=(.+)$/m)?.[1]?.trim();
  if (!id) throw new Error('VITE_FIREBASE_PROJECT_ID is not set - copy .env.example to .env');
  return id;
})();

/** A document path's prefix, as Firestore's REST API names it. */
export const DOCS = `projects/${PROJECT}/databases/(default)/documents`;

/** The REST base URL for documents. */
export const DB = `https://firestore.googleapis.com/v1/${DOCS}`;

/** Make the page believe it is a tablet, so the app's own guess lands on `role=pad`.
 *
 *  Call it BEFORE `Page.navigate` — the role is decided once, when the component
 *  initialises — and after whatever `setDeviceMetricsOverride` the script wants, since
 *  that call replaces the whole override object.
 *
 *  Deliberately only the one call. Measured, on the three things it would be tempting to
 *  add or to fear:
 *
 *    - `setDeviceMetricsOverride` is NOT needed and is not touched here, so every script
 *      keeps its own viewport and deviceScaleFactor exactly as it set them. `mobile: true`
 *      on its own does not make `pointer: coarse` match; touch emulation on its own does.
 *    - A tablet `userAgent` does nothing whatsoever — the app never reads
 *      `navigator.userAgent`, and a UA override does not move a media feature.
 *    - Touch emulation does NOT swallow CDP mouse events, and does not rewrite their
 *      `pointerType`. A dispatched mouse arrives as `mouse`, a dispatched pen as `pen`,
 *      at deviceScaleFactor 1 and 2 alike — so palm rejection and the S Pen barrel-button
 *      tests keep testing what they always tested. Two scripts carried a comment saying
 *      the opposite and turned touch emulation off because of it; it was folklore. */
export async function asTablet(send) {
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
}

/** Throw unless the writing board is the live role. Pass the script's own `ev`.
 *
 *  The app's own statement of which role is live is asked for, not a layout side effect:
 *  `.page.pinned` follows the role too, but that is scrolltest's assertion to make and a
 *  test should not quietly depend on the thing it is checking. */
export async function assertPad(ev) {
  const active = await ev(`(() => {
    const b = [...document.querySelectorAll('.roles .btn')]
      .find((b) => b.textContent.trim() === 'לוח כתיבה');
    return b ? b.dataset.active : 'no button';
  })()`);
  if (active !== 'true')
    throw new Error(
      `not on the writing board (role button reports ${active}) — nothing drawn here ` +
        `would leave ink. Call asTablet(send) before Page.navigate.`
    );
}

/** The URL with a room pinned onto it, whatever query it already carries. */
export function roomUrl(url, room) {
  const u = new URL(url);
  u.searchParams.set('room', room);
  return u.href;
}

/** A room id no other run will be holding: 32 hex characters, the shape the app uses.
 *
 *  A test that opens the default room inherits whatever the last one left in it, and then
 *  passes or fails on the order the suite happened to run in. That is not hypothetical —
 *  scrolltest did open the default room, and its wheel and pan checks flipped between
 *  green and red across two consecutive runs of an unchanged file, because the ink it was
 *  counting was partly the previous run's. The same trap then caught a throwaway probe
 *  written while investigating it: three scenarios sharing one room drew the identical
 *  stroke in the identical place, the pixel count never moved, and the third scenario was
 *  briefly recorded as a failure it had not had. Clear the room at the end as well;
 *  opening a fresh one and leaving it behind just moves the mess. */
export function freshRoom() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, '0')
  ).join('');
}
