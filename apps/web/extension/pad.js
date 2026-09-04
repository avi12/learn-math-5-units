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
 * render, not after.
 */
const CHECK_MESSAGE = 'avi-math-check@1';

document.documentElement.dataset.aviMathCheck = 'ready';

window.addEventListener('message', (event) => {
  // Only this page, only this message. A content script shares the page's window with
  // everything else on it, so an unchecked listener is an open door.
  if (event.source !== window || event.origin !== location.origin) return;
  const data = event.data;
  if (!data || data.type !== CHECK_MESSAGE) return;
  if (typeof data.image !== 'string' || typeof data.prompt !== 'string') return;

  chrome.runtime.sendMessage({
    type: CHECK_MESSAGE,
    image: data.image,
    prompt: data.prompt,
    topic: String(data.topic ?? '')
  });
});
