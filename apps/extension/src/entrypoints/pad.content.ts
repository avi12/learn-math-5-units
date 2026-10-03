import { CHECK_MESSAGE, type CheckPayload } from '../utils/protocol';

/** On the pad: hear the button, hand the payload to the background worker.
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
export default defineContentScript({
  matches: [`${import.meta.env.WXT_PAD_ORIGIN}/*`],
  runAt: 'document_start',

  main() {
    document.documentElement.dataset.aviMathCheck = 'ready';

    window.addEventListener('message', (event: MessageEvent) => {
      // Only this page, only this message. A content script shares the page's window with
      // everything else on it, so an unchecked listener is an open door.
      if (event.source !== window || event.origin !== location.origin) return;
      const data = event.data as Partial<CheckPayload> | null;
      if (!data || data.type !== CHECK_MESSAGE) return;
      if (typeof data.image !== 'string' || typeof data.prompt !== 'string') return;

      chrome.runtime.sendMessage({
        type: CHECK_MESSAGE,
        image: data.image,
        prompt: data.prompt,
        topic: String(data.topic ?? '')
      });
    });
  }
});
