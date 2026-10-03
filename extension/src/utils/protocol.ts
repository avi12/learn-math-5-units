/** The wire between the pad, this extension, and the Claude tab.
 *
 * `CHECK_MESSAGE` used to be typed out in two files here and it is typed out in a third
 * place that this repo cannot import at all — `avi-math-study/src/lib/check.ts`, the
 * page's half of the same contract. Two of those three now read from here; the third is
 * across a repo boundary and is the reason the string carries `@1`. **If it ever changes,
 * it changes in both repos in the same commit, or the button silently stops working:**
 * the page posts, nothing answers, and the fallback to the clipboard looks like the
 * intended behaviour rather than a break.
 */

/** Pad → extension: here is a board and a prompt. Must match `check.ts` in the pad. */
export const CHECK_MESSAGE = 'avi-math-check@1';

/** Claude tab → background: what was I opened for? */
export const TAKE = 'avi-math-take';

/** The one row in `chrome.storage.local`. */
export const PENDING = 'pending';

/** Where a check goes. */
export const NEW_CHAT = 'https://claude.ai/new';

/** How long a parked payload stays valid. A stale one is worse than none: it would be
 *  pasted into whatever Claude tab opens next, days later. */
export const PENDING_TTL_MS = 5 * 60 * 1000;

/** What the pad posts, and what the Claude tab collects. */
export interface CheckPayload {
  type: typeof CHECK_MESSAGE;
  /** the board, as a PNG data URL */
  image: string;
  prompt: string;
  topic: string;
}

/** The same, once the background has stamped it. */
export type PendingCheck = CheckPayload & { at: number };
