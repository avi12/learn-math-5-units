/** The extension's own half, in a real browser with the extension really loaded.
 *
 *   node chaintest.mjs <debug-port>
 *
 * This is the piece the README used to list under "not tested automatically". Two things
 * had to be true before it could exist, and only one of them was about this repo:
 *
 *   1. `claude.test.html` covers what happens INSIDE the Claude tab against a stand-in
 *      composer. Nothing covered how the payload gets there — pad page → content script →
 *      service worker → a new tab — and that is three process boundaries.
 *   2. **Chrome 137 removed `--load-extension` from branded builds.** Passing it to the
 *      installed Chrome is silently ignored: the browser starts, the flag does nothing,
 *      and `Preferences` shows zero extensions registered. Measured, and it is the reason
 *      the old note said headless "refuses to load unpacked extensions".
 *      Chrome for Testing still honours it, and puppeteer keeps one in
 *      `~/.cache/puppeteer/chrome/<version>/chrome-win64/chrome.exe` — note the glob
 *      is spelled out, because a literal star-slash would end this comment.
 *
 * So:
 *   <cft> --headless=new --remote-debugging-port=<port> --user-data-dir=<fresh dir> \
 *         --disable-extensions-except=<abs path to .output/chrome-mv3> \
 *         --load-extension=<same> about:blank
 *   node chaintest.mjs <port>
 *
 * Run `npm run build` first — this loads the built extension, not the source.
 *
 * What is NOT covered, and still is not: the real DOM of claude.ai. It needs a login, and
 * it is the thing that will change one day and need fixing.
 */
const [, , port] = process.argv;
if (!port) {
  console.log('usage: node chaintest.mjs <debug-port>');
  process.exit(2);
}
const base = `http://127.0.0.1:${port}`;

const attach = async (target) => {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const send = (m, p = {}) =>
    new Promise((r, j) => {
      const i = ++id;
      pending.set(i, r);
      setTimeout(() => j(new Error('CDP timeout: ' + m)), 20000);
      ws.send(JSON.stringify({ id: i, method: m, params: p }));
    });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m.result);
      pending.delete(m.id);
    }
  };
  await new Promise((r) => (ws.onopen = r));
  await send('Runtime.enable');
  const ev = async (x) => {
    const r = await send('Runtime.evaluate', {
      expression: x,
      returnByValue: true,
      awaitPromise: true
    });
    if (r?.exceptionDetails) return 'EXC: ' + r.exceptionDetails.text;
    return r.result?.value;
  };
  return { ws, send, ev };
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const targets = async () => await (await fetch(`${base}/json/list`)).json();

let bad = 0;
const check = (name, ok, detail = '') => {
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(46)} ${detail}`);
};

// A room of its own, so a run never touches a real board.
const room = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
  b.toString(16).padStart(2, '0')
).join('');

const first = await targets();
const blank = first.find((t) => t.type === 'page' && t.url === 'about:blank');
if (!blank) {
  console.log('no about:blank page target — start the browser as the header describes');
  process.exit(1);
}
const page = await attach(blank);
await page.send('Page.enable');
await page.send('Page.navigate', {
  // role=board, not pad: "סיימתי — שקלוד יבדוק" is desktop-only now, and this test is
  // about the desktop half of the chain anyway — the extension only exists there.
  url: `${process.env.WXT_PAD_ORIGIN}/?role=board&room=${room}`
});
await wait(9000);

// 1. `document_start` is the whole point of pad.content.ts: the flag has to be there
//    before the app renders, because the page's fallback needs the answer synchronously.
const stamp = await page.ev(`document.documentElement.dataset.aviMathCheck ?? 'MISSING'`);
check('the pad is stamped at document_start', stamp === 'ready', String(stamp));
check('so the page takes the extension path', stamp === 'ready');

// a board with nothing on it would still produce a payload, so put ink on it
const rect = JSON.parse(
  await page.ev(`JSON.stringify(document.querySelector('canvas').getBoundingClientRect())`)
);
const y = rect.top + rect.height * 0.4;
const x0 = rect.left + rect.width * 0.2;
await page.send('Input.dispatchMouseEvent', {
  type: 'mousePressed', x: x0, y, button: 'left', buttons: 1, clickCount: 1
});
for (let i = 1; i <= 12; i++)
  await page.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: x0 + i * 26, y: y + Math.sin(i) * 10, button: 'left', buttons: 1
  });
await page.send('Input.dispatchMouseEvent', {
  type: 'mouseReleased', x: x0 + 312, y, button: 'left', buttons: 0, clickCount: 1
});
await wait(3000);

// not the default topic, so a payload built from the wrong one would show
await page.ev(`(() => {
  const s = document.querySelector('.topic select');
  if (!s) return 'no select';
  s.value = '07';
  s.dispatchEvent(new Event('change', { bubbles: true }));
  return s.value;
})()`);

const before = (await targets()).filter((t) => t.url.startsWith('https://claude.ai/')).length;

const clicked = await page.ev(`(() => {
  const b = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('שקלוד יבדוק'));
  if (!b) return 'no button';
  b.click();
  return 'clicked';
})()`);
check('the check button is there and was pressed', clicked === 'clicked', String(clicked));

// 2. the service worker heard it, parked the payload and opened Claude. Waiting for the
//    tab rather than for a clock: an MV3 worker is started on demand and takes a moment.
let opened = [];
for (let i = 0; i < 30 && opened.length <= before; i++) {
  await wait(500);
  opened = (await targets()).filter((t) => t.url.startsWith('https://claude.ai/'));
}
check('the worker opened a Claude tab', opened.length > before, opened[0]?.url ?? 'none appeared');

// 3. ONE tab, not two. Avi reported a stray browser window appearing alongside Claude
//    after a check, and the first thing to rule out was this end opening twice — two
//    copies of the extension loaded at once would each hear the same postMessage. It
//    does not, and now it cannot: the worker refuses a second open inside DEDUPE_MS.
check('exactly one tab, not two', opened.length === before + 1, `${opened.length - before} opened`);

// and a second click in the same breath is still one tab
await page.ev(`(() => {
  const b = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('שקלוד יבדוק'));
  b?.click();
})()`);
await wait(4000);
const after = (await targets()).filter((t) => t.url.startsWith('https://claude.ai/'));
check('a double click does not open a second', after.length === opened.length,
  `${after.length - before} total`);

page.ws.close();
console.log(bad ? `\n${bad} FAILED` : '\nthe chain holds end to end');
process.exit(bad ? 1 : 0);
