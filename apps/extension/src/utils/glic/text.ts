/** Text turns in the same conversation: the text box, emptied for the worker to type
 *  into, and the answer, read back once it stops growing. */
import { sleep } from '../async';
import type { TextReply } from '../protocol';
import {
  Button,
  clickButton,
  findButton,
  REPLY_DONE,
  SUBMIT_BUTTONS
} from './page';

const TEXT_READY_MS = 6000;
const REPLY_MS = 30000;
const SETTLE_MS = 1400;

const waitFor = async <T>({ predicate, ms }: { predicate: () => T | null | undefined; ms: number }): Promise<T | null> => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const v = predicate();
    if (v) {
      return v;
    }
    await sleep(150);
  }
  return null;
};

const editor = (): HTMLElement | null => document.querySelector<HTMLElement>('[contenteditable="true"]');

/** The newest answer's container — the whole of it, cards included. */
const lastReply = (): HTMLElement | null => {
  const all = document.querySelectorAll<HTMLElement>('.presented-response-container');
  const last = all[all.length - 1];
  if (last) {
    return last;
  }

  const nodes = document.querySelectorAll<HTMLElement>(
    'message-content, .model-response-text, .markdown, [data-response-index]'
  );
  return nodes[nodes.length - 1] ?? null;
};

const replyOf = (): TextReply => {
  const el = lastReply();
  const text = (el?.innerText ?? '').replace(/\s+/g, ' ').replace(/^Gemini said\s*/i, '').trim();
  const blocks = el ? [...el.querySelectorAll('pre code, code-block code, pre')] : [];
  const code = (blocks.at(-1)?.textContent ?? '').trim();
  return { text, code };
};

/** Into text mode, and the text box emptied and focused; false when it never showed. */
export const emptyTextBox = async (): Promise<boolean> => {
  clickButton(Button.TEXT_MODE);
  const box = await waitFor({ predicate: editor, ms: TEXT_READY_MS });
  if (!box) {
    return false;
  }

  box.focus();
  document.execCommand('selectAll');
  document.execCommand('delete');
  return true;
};

/** Send what was typed and wait for the answer to stop growing. */
export const submitAndRead = async (): Promise<TextReply> => {
  const before = lastReply();
  clickButton(...SUBMIT_BUTTONS);
  let seen = '';
  let stableSince = 0;
  const deadline = Date.now() + REPLY_MS;
  while (Date.now() < deadline) {
    const el = lastReply();
    const now = el && el !== before ? (el.innerText ?? '') : '';
    if (now && now === seen && findButton(...REPLY_DONE)) {
      stableSince ||= Date.now();
      if (Date.now() - stableSince > SETTLE_MS) {
        break;
      }
    } else {
      stableSince = 0;
      seen = now;
    }
    await sleep(200);
  }
  // Out of time with the answer still running: stop it, or Live cannot come back.
  if (clickButton(Button.STOP_RESPONSE)) {
    await sleep(SETTLE_MS);
  }
  return replyOf();
};
