/** Does a deploy reach an open tab by itself, and does it wait for the pen?
 *
 *   npm run build && npm run preview -- --port <p>
 *   chrome --headless=new --remote-debugging-port=<port> about:blank
 *   node releasetest.mjs http://localhost:<p>/ <port>
 *
 * It runs against the LOCAL preview and fakes hosting's answer, which is a change from
 * what this file used to do. The old version ran against the live site and stamped a
 * pretend build into the `meta/release` Firestore document, because that document WAS
 * the mechanism. It is not any more — `src/lib/release.ts` reads the live build from
 * `build-id.txt` over HTTP and treats Firestore as a nudge with nothing in it. So the
 * thing to fake is the HTTP answer, and CDP can serve that without a deploy, without a
 * quota, and without touching anything Avi is using.
 *
 * That also makes the failure mode from 19.09.2026 testable, which it was not before:
 * the free Firestore quota ran out, the deploy could not stamp the document and the tabs
 * could not read it, and the whole mechanism was simply absent. Nothing here needs
 * Firestore to be reachable at all.
 *
 * What is checked:
 *   1. a tab told its own build sits still — the answer arrives on every poll, and
 *      reloading on it would mean reloading every thirty seconds, for ever;
 *   2. a tab told a newer build says so, and does NOT go while the pen is on the glass;
 *   3. pen up, and it reloads itself;
 *   4. a tab that keeps coming back on the old bundle gives up after two tries and says
 *      so, instead of spinning — a CDN edge really can serve the previous index.html;
 *   5. the request cannot be answered from a cache.
 */
import { asTablet, assertPad } from './lib/pad.mjs';
import { readFileSync } from 'node:fs';

const [, , url, port] = process.argv;
if (!url || !port) {
  console.error('usage: node releasetest.mjs <url> <debug-port>');
  process.exit(2);
}

/** What the bundle under test believes it is. Same file the page will ask hosting for. */
const OWN = readFileSync('dist/build-id.txt', 'utf-8').trim();

/** The build hosting will claim once the run wants a deploy to have happened.
 *
 *  NEW EVERY RUN, and that is not tidiness. release.ts counts reload attempts per build
 *  id in sessionStorage, which survives `location.reload()` inside the same tab — so a
 *  fixed id like 'newbuild1' arrives at the second run already used up, and the tab goes
 *  straight to "refresh manually" without ever offering to reload. Two checks failed
 *  that way, and the page was behaving correctly throughout. */
const NEXT = 'next' + Date.now().toString(36);

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (m, p = {}) =>
  new Promise((r, j) => {
    const i = ++id;
    pending.set(i, r);
    setTimeout(() => j(new Error('CDP timeout: ' + m)), 20000);
    ws.send(JSON.stringify({ id: i, method: m, params: p }));
  });

/** What hosting is currently pretending to serve, and what it was asked with. */
let serve = OWN;
const asked = [];

ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result ?? m.error);
    pending.delete(m.id);
    return;
  }
  if (m.method === 'Fetch.requestPaused') {
    const { requestId, request } = m.params;
    asked.push(request);
    void send('Fetch.fulfillRequest', {
      requestId,
      responseCode: 200,
      responseHeaders: [
        { name: 'content-type', value: 'text/plain' },
        { name: 'cache-control', value: 'no-store' }
      ],
      body: Buffer.from(serve, 'utf-8').toString('base64')
    });
  }
};
await new Promise((r) => (ws.onopen = r));
await send('Page.enable');
await send('Runtime.enable');
await send('Fetch.enable', {
  patterns: [{ urlPattern: '*build-id.txt*', requestStage: 'Request' }]
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true });
  return r?.exceptionDetails ? 'EXC ' + r.exceptionDetails.text : r.result?.value;
};

let bad = 0;
const check = (name, ok, detail = '') => {
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(50)} ${detail}`.trimEnd());
};

console.log('      bundle build:', OWN);

await send('Emulation.setDeviceMetricsOverride', {
  width: 1180,
  height: 820,
  deviceScaleFactor: 1,
  mobile: false
});
await asTablet(send);
await send('Page.navigate', { url });
await wait(9000);
await assertPad(ev);
// Belt as well as braces on the counter above: a tab reused from an earlier run carries
// its sessionStorage, and this file is about what a FRESH tab does with a deploy.
await ev('sessionStorage.removeItem("avi-math-release-tries")');

/** A value that only survives as long as the document does. */
const mark = () => ev('window.__alive = 1');
const alive = () => ev('window.__alive === 1');
const toast = () => ev('document.querySelector(".toast")?.textContent?.trim() ?? ""');

/** Wake the tab the way a person does, instead of waiting out the thirty-second poll.
 *  This is the real path — release.ts listens for focus precisely because a tablet that
 *  slept through the night has an interval that did not run.
 *
 *  It pokes REPEATEDLY until the page actually asks hosting, because release.ts drops a
 *  wake-up that arrives while a check is still in flight — deliberately, so a flurry of
 *  focus events cannot pile up requests. Through CDP interception a fetch can take well
 *  over a second, so a single poke followed by a fixed wait silently measured nothing.
 *  Waiting for the request itself is the honest form. */
async function poke(budgetMs = 12000) {
  const t0 = Date.now();
  const from = asked.length;
  while (Date.now() - t0 < budgetMs) {
    await ev('window.dispatchEvent(new Event("focus"))');
    await wait(900);
    if (asked.length > from) return true;
  }
  return false;
}

// ---- 1. told its own build, it sits still ----------------------------------
await mark();
await poke();
await poke();
check('a tab told its own build sits still', await alive(), 'no reload');

const seen = asked.length;
check('and it did ask', seen > 0, `${seen} request(s) to build-id.txt`);

// ---- 5. the answer cannot come out of a cache ------------------------------
const last = asked[asked.length - 1];
check(
  'the request is unanswerable from a cache',
  /[?&]t=\d+/.test(last.url) || last.headers?.['Cache-Control'] === 'no-store',
  last.url.replace(/^.*\/build-id/, 'build-id')
);

// ---- 2. a newer build, with the pen down -----------------------------------
const rect = JSON.parse(
  await ev('JSON.stringify(document.querySelector("canvas").getBoundingClientRect())')
);
const at = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
await send('Input.dispatchMouseEvent', {
  ...at,
  type: 'mousePressed',
  button: 'left',
  buttons: 1,
  clickCount: 1,
  pointerType: 'pen'
});

serve = NEXT;
const landed = await poke();
check('the tab asks hosting when it wakes', landed, `served ${NEXT}`);
await wait(6000);

check('the pen on the glass holds the page', await alive(), 'still here with the pen down');
check('but the tab has been told', (await toast()).includes('גרסה חדשה'), await toast());

// ---- 3. pen up, and it goes ------------------------------------------------
await send('Input.dispatchMouseEvent', {
  ...at,
  type: 'mouseReleased',
  button: 'left',
  buttons: 0,
  clickCount: 1,
  pointerType: 'pen'
});
await wait(9000);
check('pen up, and the tab reloads itself', !(await alive()), 'the marker is gone');

// ---- 4. it does not spin ---------------------------------------------------
// The tab came back on the same bundle — exactly what a CDN edge serving the previous
// index.html looks like — and hosting is still claiming something newer. One more try is
// allowed, then it has to stop and hand the decision over.
await wait(4000);
await assertPad(ev);
await mark();
await poke();
await wait(9000);
const survivedSecond = await alive();
if (!survivedSecond) {
  await wait(4000);
  await mark();
}
await poke();
await wait(9000);
check('it stops after two tries instead of spinning', await alive(), 'the marker survived');
check(
  'and says the browser is serving an old one',
  (await toast()).includes('ידנית'),
  await toast()
);

console.log(bad ? `\n${bad} FAILED` : '\nall checks passed');
ws.close();
process.exit(bad ? 1 : 0);
