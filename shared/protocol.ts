/** The contract between the pad (apps/web) and the Chrome extension (apps/extension).
 *
 * Both sides import it from here. Before the monorepo it was typed out on each side of a
 * repo boundary, with a comment begging whoever changed one to change the other in the
 * same commit — and a mismatch fails silently: the page posts, nothing answers, and the
 * clipboard fallback looks like intended behaviour. The `@1` stays as the wire version,
 * so a build of one side that is older than the other still tells them apart. */

/** Pad → extension: here is a board and a prompt. */
export const CHECK_MESSAGE = 'avi-math-check@1';

/** The extension stamps `document.documentElement.dataset[PRESENCE_FLAG] = PRESENCE_READY`
 *  at document_start, so the pad knows BEFORE a click whether anyone is listening: the
 *  clipboard fallback has to happen inside the click's own user gesture. */
export const PRESENCE_FLAG = 'aviMathCheck';
export const PRESENCE_READY = 'ready';

/** What the pad posts, and what the Claude tab collects. */
export interface CheckPayload {
  type: typeof CHECK_MESSAGE;
  /** the board, as a PNG data URL */
  image: string;
  /** the full prompt, criteria included */
  prompt: string;
  /** a human label for the exercise, for the banner in the Claude tab */
  topic: string;
}
