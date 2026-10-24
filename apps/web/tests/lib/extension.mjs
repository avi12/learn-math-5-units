/** The extension's half of the pad's messages, for tests that stand in for it.
 *
 * The page talks to the extension through @webext-core/messaging's window messenger
 * (`padMessenger` in shared/protocol.ts). A test page has no extension, so the test plays
 * its part: it posts and hears the messenger's own envelope. The names and the namespace
 * come from protocol.ts itself; the envelope is the library's (dist/page.mjs), and is
 * written out here, in this one place.
 *
 * Each export is a JavaScript expression for `Runtime.evaluate` in the page. */
import { PAD_NAMESPACE, PadMessage } from '../../../../shared/protocol.ts';

export { PadMessage };

const REQUEST = '@webext-core/messaging/window';
const RESPONSE = '@webext-core/messaging/window/response';

/** Catch the next `type` the page sends, as `window.__caught` (its data), and answer it
 *  the way the content script would: with nothing. */
export const catchFromPage = (type) => `(() => {
  window.__caught = null;
  addEventListener('message', (e) => {
    const d = e.data;
    if (e.source !== window || d?.type !== '${REQUEST}' || d.namespace !== '${PAD_NAMESPACE}' ||
        d.message?.type !== '${type}' || d.instanceId === 'test') return;
    window.__caught = d.message.data;
    postMessage({ type: '${RESPONSE}', response: { res: undefined }, instanceId: 'test',
      message: d.message, namespace: '${PAD_NAMESPACE}' }, location.origin);
  });
  return 1;
})()`;

/** Send `type` with `data` to the page, as the extension would; resolves to the page's
 *  answer, JSON-encoded so it survives `returnByValue`. */
export const askPage = ({ type, data }) => `new Promise((resolve) => {
  const id = Math.floor(Math.random() * 1e9);
  addEventListener('message', function heard(e) {
    const d = e.data;
    if (d?.type !== '${RESPONSE}' || d.namespace !== '${PAD_NAMESPACE}' || d.message?.id !== id) return;
    removeEventListener('message', heard);
    resolve(JSON.stringify(d.response?.res ?? null));
  });
  postMessage({ type: '${REQUEST}', namespace: '${PAD_NAMESPACE}', instanceId: 'test', senderOrigin: location.origin,
    message: { id, type: '${type}', data: ${JSON.stringify(data ?? null)}, timestamp: Date.now() } }, location.origin);
})`;
