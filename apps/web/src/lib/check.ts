/** "I finished — check me": the board and the right marking criteria, handed to Claude.
 *
 * The criteria are not written here. They live in the workbook's `build/content.py`, one
 * `grader` per topic, and `build/graders.py` exports them into `graders.json` next to
 * this file. That matters more than it looks: the workbook teaches a standard and this
 * button marks against one, and two hand-maintained copies of that standard would drift
 * apart quietly, in the direction of whichever one was edited last.
 *
 * Delivery is a Chrome extension (`extension/`) rather than an API call, which is what
 * Avi asked for and is also the better shape here — no API key on a public static site,
 * no per-check cost, and the answer lands in a real Claude conversation he can carry on.
 * The page never talks to the extension directly; it posts a message to its own window,
 * the extension's content script hears it, and if no extension is installed the same
 * payload goes to the clipboard instead. A page that assumed the extension would be
 * there would be a button that silently does nothing on any other machine.
 */
import graders from './graders.json';

export interface Topic {
  id: string;
  title: string;
  prompt: string;
}

export const TOPICS: Topic[] = graders.blocks;

/** The message the extension listens for. Named, versioned, and matched on both ends. */
export const CHECK_MESSAGE = 'avi-math-check@1';

export interface CheckPayload {
  type: typeof CHECK_MESSAGE;
  /** the board as a PNG data URL */
  image: string;
  /** the full prompt, criteria included */
  prompt: string;
  topic: string;
}

/** Is the extension listening? It answers a ping by setting this flag on the document.
 *  Asked rather than assumed, because the fallback has to be chosen before the click
 *  does anything the user can see. */
export function extensionPresent(): boolean {
  return document.documentElement.dataset.aviMathCheck === 'ready';
}

export function requestCheck(payload: CheckPayload): void {
  window.postMessage(payload, location.origin);
}
