import { quietly, within } from '../utils/async';
import { ExtensionMessage, extensionMessenger } from '../utils/protocol';
import {
  type LiveStatus,
  type NoteRequest,
  PadMessage,
  padMessenger,
  PRESENCE_FLAG,
  PRESENCE_READY
} from '@learn-math/shared/protocol';

/** On the pad: hear the buttons, hand the payloads to the background worker — and, for
 *  Gemini Live, carry the worker's picture requests and news back into the page.
 *
 * Two jobs, and the first one is the quiet one. The page has to know whether an
 * extension is here BEFORE the button is pressed, because the fallback (copy to the
 * clipboard) has to happen inside the click's own user gesture — a clipboard write that
 * waits for an answer from an extension has already lost the gesture and is refused. So
 * this stamps the document as soon as it exists, and the page reads a flag rather than
 * asking a question.
 *
 * `document_start` is deliberate: the stamp has to be there before the app's first
 * render, not after. It is declared here rather than in a manifest file, so the timing
 * and the code that depends on it cannot drift apart.
 */

/** A note request from the page, or nothing: every field a string, or it is not one. */
function noteRequestOf(v: unknown): NoteRequest | undefined {
  const n = v as Partial<Record<keyof NoteRequest, unknown>> | null;
  const keys: (keyof NoteRequest)[] = ['cue', 'template', 'heard', 'said', 'none'];
  return n && keys.every((k) => typeof n[k] === 'string') ? (n as NoteRequest) : undefined;
}

/** How long the page has to draw a picture. Gemini gives up on one after three seconds
 *  (glic.content.ts), and the hops either side of this one need some of that. */
const FRAME_MS = 2500;

export default defineContentScript({
  matches: [`${import.meta.env.WXT_PAD_ORIGIN}/*`],
  runAt: 'document_start',

  main() {
    document.documentElement.dataset[PRESENCE_FLAG] = PRESENCE_READY;

    // Page → worker. What the page sends is checked here: a content script shares the
    // page's window with everything else on it.
    padMessenger.onMessage(PadMessage.CHECK, ({ data }) => {
      if (typeof data?.image !== 'string' || typeof data.prompt !== 'string') {
        return;
      }

      const check = { image: data.image, prompt: data.prompt, topic: String(data.topic ?? '') };
      void quietly(extensionMessenger.sendMessage(ExtensionMessage.CHECK, check));
    });
    padMessenger.onMessage(PadMessage.LIVE_START, ({ data }) => {
      if (typeof data?.prompt !== 'string' || typeof data.title !== 'string') {
        return;
      }

      const start = { prompt: data.prompt, title: data.title, notes: noteRequestOf(data.notes) };
      void quietly(extensionMessenger.sendMessage(ExtensionMessage.LIVE_START, start));
    });
    padMessenger.onMessage(PadMessage.LIVE_RETARGET, ({ data }) => {
      if (typeof data?.title !== 'string') {
        return;
      }

      const target = { title: data.title, notes: noteRequestOf(data.notes) };
      void quietly(extensionMessenger.sendMessage(ExtensionMessage.LIVE_RETARGET, target));
    });
    padMessenger.onMessage(PadMessage.LIVE_STOP, () => {
      void quietly(extensionMessenger.sendMessage(ExtensionMessage.LIVE_STOP));
    });

    // Worker → page: the page is this tab's own, so every message goes to its origin only.
    const tellPage = (status: LiveStatus): void => {
      void quietly(padMessenger.sendMessage(PadMessage.LIVE_STATUS, status, location.origin));
    };
    extensionMessenger.onMessage(ExtensionMessage.FRAME, () =>
      within({ ms: FRAME_MS, promise: padMessenger.sendMessage(PadMessage.FRAME, undefined, location.origin), fallback: null })
    );
    extensionMessenger.onMessage(ExtensionMessage.LIVE_STATUS, ({ data }) => tellPage(data));
    extensionMessenger.onMessage(ExtensionMessage.LIVE_NOTE, ({ data }) => {
      void quietly(padMessenger.sendMessage(PadMessage.LIVE_NOTE, data, location.origin));
    });

    // A pad reloaded in the middle of a session still has one: ask, and tell the page —
    // after the app has mounted and is listening, since this script runs before it exists.
    void quietly(
      extensionMessenger.sendMessage(ExtensionMessage.PAD_HELLO).then((status) => {
        if (!status) {
          return;
        }

        if (document.readyState === 'complete') {
          tellPage(status);
          return;
        }

        addEventListener('load', () => tellPage(status), { once: true });
      })
    );
  }
});
