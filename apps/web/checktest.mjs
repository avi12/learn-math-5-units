/** The check button, on both paths. `node checktest.mjs <url> <debug-port>`
 *
 * The extension cannot be loaded into a headless Chrome that is already running, so its
 * presence is faked the way it really announces itself — the stamp on <html> and a
 * listener on window.message — and what is verified is the page's half of the contract:
 *
 *   1. with an extension: the exact payload is posted, with a real PNG and the prompt
 *      for the TOPIC THAT IS SELECTED, not for whichever block happens to be first;
 *   2. without one: nothing is posted and the same prompt reaches the clipboard, so the
 *      button still does the whole job on a machine that has no extension.
 *
 * The criteria themselves are checked by identity, not by eyeballing: the prompt that
 * goes out has to contain the marking criteria the workbook wrote for that block.
 */
const [, , url, port] = process.argv;
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (m, p = {}) =>
  new Promise((r, j) => {
    const i = ++id;
    pending.set(i, r);
    setTimeout(() => j(new Error('CDP timeout: ' + m)), 25000);
    ws.send(JSON.stringify({ id: i, method: m, params: p }));
  });
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result ?? m.error);
    pending.delete(m.id);
  }
};
await new Promise((r) => (ws.onopen = r));
await send('Page.enable');
await send('Runtime.enable');
await send('Browser.grantPermissions', {
  origin: new URL(url).origin,
  permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite']
}).catch(() => {});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
  return r?.exceptionDetails ? 'EXC ' + r.exceptionDetails.text : r.result?.value;
};

let bad = 0;
const check = (name, ok, detail = '') => {
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(50)} ${detail}`);
};

await send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url });
await wait(7000);

// ---- the control itself -----------------------------------------------------
check('the topic picker is on the pad', (await ev(`!!document.querySelector('.topic select')`)) === true);
const count = await ev(`document.querySelectorAll('.topic select option').length`);
check('all ten blocks are offered', count === 10, `${count} options`);
const btn = `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('שקלוד יבדוק'))`;
check('the check button is there', (await ev(`!!${btn}`)) === true);

// draw something, so the board is not blank
const rect = JSON.parse(await ev('JSON.stringify(document.querySelector("canvas").getBoundingClientRect())'));
const y = rect.top + rect.height * 0.4;
const x0 = rect.left + rect.width * 0.2;
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y, button: 'left', buttons: 1, clickCount: 1 });
for (let i = 1; i <= 12; i++) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0 + i * 26, y: y + Math.sin(i) * 10, button: 'left', buttons: 1 });
}
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x0 + 312, y, button: 'left', buttons: 0, clickCount: 1 });
await wait(2500);

// ---- 1: with an extension listening -----------------------------------------
// Pick a topic that is NOT the default, so a payload built from the wrong one is caught.
await ev(`(() => {
  const s = document.querySelector('.topic select');
  s.value = '07';
  s.dispatchEvent(new Event('change', { bubbles: true }));
  s.dispatchEvent(new Event('input', { bubbles: true }));
  return s.value;
})()`);
await wait(400);

await ev(`(() => {
  document.documentElement.dataset.aviMathCheck = 'ready';
  window.__caught = null;
  window.addEventListener('message', (e) => {
    if (e.source === window && e.data && e.data.type === 'avi-math-check@1') window.__caught = e.data;
  });
  return 1;
})()`);
await ev(`${btn}.click(), 1`);
for (let i = 0; i < 40 && !(await ev(`!!window.__caught`)); i++) await wait(250);

const got = await ev(`(() => {
  const c = window.__caught;
  if (!c) return null;
  return { topic: c.topic, png: c.image.startsWith('data:image/png;base64,'), bytes: c.image.length, prompt: c.prompt };
})()`);
check('a payload is posted for the extension', !!got);
check('it carries a real PNG', got?.png === true, `${Math.round((got?.bytes ?? 0) / 1024)} kb data URL`);
check('the topic is the one selected', got?.topic?.includes('נגזרת'), JSON.stringify(got?.topic));
// the criteria the workbook wrote for block 07, verbatim
check(
  "the prompt carries that block's own criteria",
  String(got?.prompt).includes('ההשוואה לאפס של המונה בלבד מנומקת'),
  String(got?.prompt).length + ' chars'
);
check('and it does not still ask for pasted text', !String(got?.prompt).includes('כאן מדביקים'));

// ---- 2: with no extension ---------------------------------------------------
await ev(`(() => {
  delete document.documentElement.dataset.aviMathCheck;
  window.__caught = null;
  return 1;
})()`);
await ev(`${btn}.click(), 1`);
await wait(2500);
check('nothing is posted when no extension is present', (await ev(`!!window.__caught`)) === false);
const clip = await ev(`navigator.clipboard.readText().catch(() => '')`);
check(
  'the prompt reaches the clipboard instead',
  String(clip).includes('בוחן בגרות') || String(clip).includes('35571'),
  String(clip).slice(0, 40).replace(/\n/g, ' ')
);

console.log(bad ? `\n${bad} FAILED` : '\nall checks passed');
ws.close();
process.exit(bad ? 1 : 0);
