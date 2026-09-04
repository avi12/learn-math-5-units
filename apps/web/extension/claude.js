/** On claude.ai: put the board and the prompt into the composer, and stop there.
 *
 * It does NOT press send. Staging and sending are different promises: staging that goes
 * wrong is visible and fixable, sending that goes wrong has already happened. The last
 * step stays Avi's.
 *
 * Everything here talks to someone else's UI, so it is written to fail loudly and
 * harmlessly. The composer is found by role rather than by class name — class names are
 * generated and change without notice, `contenteditable` is what the thing IS. If it is
 * not found within the timeout, the payload goes to the clipboard and a banner says so,
 * which leaves exactly the manual flow that existed before this extension.
 */
const TAKE = 'avi-math-take';

/** ProseMirror listens for real clipboard events, so a paste is the honest way in:
 *  it exercises the editor's own image and text handling instead of writing into its
 *  DOM behind its back, which it would overwrite on the next keystroke. */
function pasteInto(target, { file, text }) {
  const dt = new DataTransfer();
  if (file) dt.items.add(file);
  if (text) dt.setData('text/plain', text);
  target.focus();
  return target.dispatchEvent(
    new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
  );
}

function dataUrlToFile(dataUrl, name) {
  const [head, body] = dataUrl.split(',', 2);
  const mime = /:(.*?);/.exec(head)?.[1] ?? 'image/png';
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], name, { type: mime });
}

/** The composer, once it exists. A fresh chat mounts it a moment after navigation. */
function composer(timeoutMs = 15000) {
  const find = () =>
    document.querySelector('div[contenteditable="true"][role="textbox"]') ??
    document.querySelector('div[contenteditable="true"]');
  return new Promise((resolve) => {
    const now = find();
    if (now) return resolve(now);
    const stop = setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeoutMs);
    const observer = new MutationObserver(() => {
      const el = find();
      if (!el) return;
      clearTimeout(stop);
      observer.disconnect();
      resolve(el);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

function banner(text, tone) {
  const el = document.createElement('div');
  el.textContent = text;
  Object.assign(el.style, {
    position: 'fixed',
    insetInlineStart: '50%',
    insetBlockEnd: '92px',
    transform: 'translateX(-50%)',
    zIndex: '2147483647',
    padding: '10px 18px',
    borderRadius: '8px',
    font: '500 14px/1.4 system-ui, sans-serif',
    color: '#fff',
    background: tone === 'bad' ? '#8a1c3a' : '#1f6f4a',
    boxShadow: '0 6px 24px rgba(0,0,0,.35)',
    direction: 'rtl'
  });
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 6000);
}

async function run() {
  const job = await chrome.runtime.sendMessage({ type: TAKE });
  if (!job) return; // an ordinary visit to Claude, not one this extension asked for

  const box = await composer();
  if (!box) {
    await navigator.clipboard.writeText(job.prompt).catch(() => {});
    banner('לא מצאתי את תיבת ההודעה. הפרומפט הועתק — הדבק ידנית.', 'bad');
    return;
  }

  // Image first: it becomes an attachment, and the text then lands in an empty box.
  const image = pasteInto(box, { file: dataUrlToFile(job.image, 'board.png') });
  await new Promise((r) => setTimeout(r, 400));
  const text = pasteInto(box, { text: job.prompt });

  if (!image || !text) {
    banner('משהו מהשניים לא נדבק. בדוק לפני ששולח.', 'bad');
    return;
  }
  banner(`מוכן לבדיקה — ${job.topic || 'הלוח'}. עבור עליו ושלח.`, 'ok');
}

void run();
