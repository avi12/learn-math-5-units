/** What the rubber costs on a board the size of a real one.
 *
 *   npm run preview
 *   chrome --headless=new --remote-debugging-port=<port> about:blank
 *   node erasecost.mjs <url> <port> [strokes] [cpuThrottle]
 *
 * Avi (19.09.2026): "כשאני מנקה מהקנבס בעזרת הלחצן על העט, ככל שהקנבס יותר גדול כך יקח
 * יותר זמן להחיל את העריכה של הקנבס".
 *
 * Three costs hide behind that one sentence, and they are measured apart here:
 *
 *   ASKING    `rub()` asks every stroke on the board whether the rubber touches it, once
 *             per pointer move. Ask a thousand strokes and unpack a thousand point
 *             strings while the hand is moving, and the hand is waiting.
 *   SWEEPING  every move that takes something out changes the picture, so the dry-ink
 *             cache is thrown away and the WHOLE board is rasterised again — including
 *             everything above and below the window.
 *   APPLYING  how long until the ink is really gone. Firestore compensates locally, so
 *             this was never a network round trip — but each delete came back as its own
 *             snapshot, and each snapshot rebuilt the order, re-measured the ink and
 *             repainted, in the middle of the gesture.
 *
 * The board is seeded straight into Firestore over its REST API rather than drawn: a
 * thousand strokes through CDP input is twenty minutes, and the room's rules already
 * allow an unauthenticated write to a 32-hex room. That is the only way this script can
 * measure the size of board the complaint is actually about.
 */
import { asTablet, assertPad, roomUrl, freshRoom, DB, DOCS } from './lib/pad.mjs';

const [, , url, port, count, cpu = '1'] = process.argv;
if (!url || !port || !count) {
  console.error('usage: node erasecost.mjs <url> <debug-port> <strokes> [cpuThrottle]');
  console.error('');
  console.error('  `strokes` has no default ON PURPOSE. Seeding writes one document per');
  console.error('  stroke and the free plan allows 20,000 writes a day, so a few runs at a');
  console.error('  thousand strokes take a real bite out of it — and when it runs out, the');
  console.error('  pad itself cannot save anything until it resets at midnight Pacific.');
  console.error('  That happened once. Pick the number deliberately.');
  process.exit(2);
}
const N = Number(count);
const room = freshRoom();

// ---- seed a board ----------------------------------------------------------
/** One handwritten word: a short wobble, about a tenth of the width across. */
function word(x, y) {
  const pts = [];
  for (let i = 0; i < 24; i++)
    pts.push(`${(x + i * 0.005).toFixed(3)},${(y + Math.sin(i / 2) * 0.008).toFixed(3)},0.50`);
  return pts.join(';');
}

const ids = [];
async function seed(n) {
  const writes = [];
  for (let i = 0; i < n; i++) {
    // Eleven normalised units is about seventeen exported pages — the shape of the board
    // Avi was erasing on when he wrote in.
    const y = 0.05 + (i / n) * 11;
    const x = 0.05 + (i % 7) * 0.13;
    const docId = `seed${String(i).padStart(28, '0')}`;
    ids.push(docId);
    writes.push({
      update: {
        name: `${DOCS}/rooms/${room}/strokes/${docId}`,
        fields: {
          t: { stringValue: 'ink' },
          c: { stringValue: 'ink' },
          w: { integerValue: '6' },
          p: { stringValue: word(x, y) },
          n: { integerValue: String(i + 1) }
        }
      }
    });
  }
  // Paced, and it has to be: a run of back-to-back 400-write batches trips Firestore's
  // burst limit and comes back 429 "Quota exceeded", which reads like the daily cap and
  // is not — a single write straight after still succeeds. One batch a second is enough.
  for (let i = 0; i < writes.length; i += 300) {
    let done = false;
    for (let go = 0; go < 6 && !done; go++) {
      const r = await fetch(`${DB}:commit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ writes: writes.slice(i, i + 300) })
      });
      if (r.ok) done = true;
      else if (r.status === 429) await new Promise((res) => setTimeout(res, 4000));
      else throw new Error(`seed failed: ${r.status} ${(await r.text()).slice(0, 200)}`);
    }
    if (!done) throw new Error('seed failed: still rate limited after six tries');
    await new Promise((res) => setTimeout(res, 1000));
  }
}

async function wipe() {
  const deletes = ids.map((docId) => ({
    delete: `${DOCS}/rooms/${room}/strokes/${docId}`
  }));
  for (let i = 0; i < deletes.length; i += 400)
    await fetch(`${DB}:commit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ writes: deletes.slice(i, i + 400) })
    }).catch(() => {});
}

console.log(`seeding ${N} strokes into a fresh room — ${N} writes of the 20,000/day free quota…`);
await seed(N);

// ---- drive the board -------------------------------------------------------
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (m, p = {}) =>
  new Promise((r, j) => {
    const i = ++id;
    pending.set(i, r);
    setTimeout(() => j(new Error('CDP timeout: ' + m)), 60000);
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
await send('Page.enable');
await send('Runtime.enable');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
  if (r?.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + x);
  return r.result?.value;
};

await send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 900, deviceScaleFactor: 2, mobile: true });
await asTablet(send);
await send('Page.navigate', { url: roomUrl(url, room) });
await wait(10000);
await assertPad(ev);
if (Number(cpu) > 1) await send('Emulation.setCPUThrottlingRate', { rate: Number(cpu) });

const rect = JSON.parse(await ev(`JSON.stringify(document.querySelector('canvas').getBoundingClientRect())`));
const ink = async () =>
  await ev(`(() => {
    const c = document.querySelector('canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 10) n++;
    return n;
  })()`);
const pickTool = (name) =>
  ev(
    `[...document.querySelectorAll('.tools .btn')].find((b) => b.textContent.trim() === ${JSON.stringify(name)})?.click(), 1`
  );

console.log(`board loaded: ${await ev(`document.querySelectorAll('canvas').length`)} canvas, ${await ink()} ink pixels on screen`);
await pickTool('מחק');

/** Time spent INSIDE the pointermove handlers, per move.
 *
 *  Real CDP input and not `dispatchEvent`, and that is not a detail: `move()` reads
 *  `e.getCoalescedEvents()`, which returns an EMPTY list for an untrusted event — so a
 *  synthetic move takes the erase branch, repaints, and never rubs at all. A benchmark
 *  built on synthetic moves measures the blit and reports that erasing is free. This one
 *  did, for two runs.
 *
 *  The clock is a pair of listeners on `window`: capture fires before anything else sees
 *  the event, bubble fires after Svelte's delegated handler on the document root has
 *  returned. The gap between them is the work the board did for that move. */
const probe = () =>
  ev(`(() => {
    window.__t = 0; window.__n = 0; window.__s = 0; window.__max = 0;
    if (!window.__probed) {
      window.__probed = true;
      addEventListener('pointermove', () => { window.__t = performance.now(); }, true);
      addEventListener('pointermove', () => {
        if (!window.__t) return;
        const d = performance.now() - window.__t;
        window.__s += d; window.__n++; if (d > window.__max) window.__max = d;
      });
    }
    return 1;
  })()`);
const readProbe = () => ev(`JSON.stringify({ n: window.__n, avg: window.__n ? window.__s / window.__n : 0, max: window.__max })`);

async function perMove({ label, x0, y0, dx, dy, moves = 40 }) {
  await probe();
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= moves; i++)
    await send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: x0 + i * dx,
      y: y0 + i * dy,
      button: 'left',
      buttons: 1
    });
  const r = JSON.parse(await readProbe());
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: x0 + dx * moves,
    y: y0 + dy * moves,
    button: 'left',
    buttons: 0,
    clickCount: 1
  });
  await wait(900);
  console.log(`  ${label.padEnd(36)} ${r.avg.toFixed(2)} ms / move  (worst ${r.max.toFixed(1)}, n=${r.n})`);
  return r.avg;
}

console.log('');
console.log('-- asking: down a column with no ink in it, nothing is erased --');
const asking = await perMove({
  label: `${N} strokes on the board`,
  x0: rect.left + rect.width * 0.965,
  y0: rect.top + rect.height * 0.1,
  dx: 0,
  dy: 5
});

console.log('');
console.log('-- sweeping: through the ink, so the picture changes every move --');
const sweeping = await perMove({
  label: `${N} strokes on the board`,
  x0: rect.left + rect.width * 0.05,
  y0: rect.top + rect.height * 0.35,
  dx: 9,
  dy: 2
});

console.log('');
console.log('-- applying: how long until it is gone, pen still down --');
const before = await ink();
const y = rect.top + rect.height * 0.62;
const x0 = rect.left + rect.width * 0.05;
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y, button: 'left', buttons: 1, clickCount: 1 });
for (let i = 1; i <= 10; i++)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0 + i * 55, y, button: 'left', buttons: 1 });
const t0 = Date.now();
let applied = -1;
for (let i = 0; i < 300; i++) {
  if ((await ink()) < before) {
    applied = Date.now() - t0;
    break;
  }
  await wait(8);
}
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x0 + 550, y, button: 'left', buttons: 0, clickCount: 1 });
console.log(`  ink gone after                       ${applied < 0 ? 'still there while held' : applied + ' ms'}`);

console.log('');
console.log(`  asking     ${asking.toFixed(2)} ms / move`);
console.log(`  sweeping   ${sweeping.toFixed(2)} ms / move`);
console.log(`  applying   ${applied < 0 ? 'not while held' : applied + ' ms'}`);
console.log('  a pen reports at 120-240Hz, so the budget for one move is 4-8 ms.');

await wait(1500);
await wipe();
ws.close();
process.exit(0);
