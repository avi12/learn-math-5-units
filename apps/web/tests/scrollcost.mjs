/** What scrolling costs on a board the size of a real one.
 *
 *   npm run preview
 *   chrome --headless=new --remote-debugging-port=<port> about:blank
 *   node scrollcost.mjs <url> <port> <strokes> [cpuThrottle]
 *
 * Avi (03.10.2026): only render what is on the canvas "and maybe a bit beyond", so
 * scrolling inside that does no work. The dry bitmap is rasterised half a screen past
 * each edge (OVERSCAN in Surface.svelte); a wheel notch inside it is one blit.
 *
 * The clock is a capture/bubble pair of `wheel` listeners on window, around the
 * board's own handler, which repaints synchronously. Real CDP wheel input, small notches
 * (as a trackpad sends them), down the board and back. Seeding is the same as
 * erasecost.mjs: straight into Firestore, wiped at the end.
 */
import { asTablet, assertPad, roomUrl, freshRoom, DB, DOCS } from './lib/pad.mjs';

const [, , url, port, count, cpu = '1'] = process.argv;
if (!url || !port || !count) {
  console.error('usage: node scrollcost.mjs <url> <debug-port> <strokes> [cpuThrottle]');
  console.error('  `strokes` has no default ON PURPOSE - one write per stroke; see erasecost.mjs.');
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
console.log(`board loaded: ${await ev(`document.querySelectorAll('canvas').length`)} canvas`);

await ev(`(() => {
  window.__n = 0; window.__s = 0; window.__max = 0;
  addEventListener('wheel', () => { window.__t = performance.now(); }, { capture: true, passive: true });
  addEventListener('wheel', () => {
    const d = performance.now() - window.__t;
    window.__s += d; window.__n++; if (d > window.__max) window.__max = d;
  }, { passive: true });
  return 1;
})()`);

const x = rect.left + rect.width / 2;
const y = rect.top + rect.height / 2;
const notch = (deltaY) => send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY });
const railTop = () => ev(`(() => { const g = document.querySelector('.rail [class*=grip], .rail > *'); return g ? g.style.top || getComputedStyle(g).top : ''; })()`);

const before = await railTop();
for (let i = 0; i < 150; i++) await notch(40);
for (let i = 0; i < 150; i++) await notch(-40);
await wait(300);
const r = JSON.parse(await ev(`JSON.stringify({ n: window.__n, avg: window.__n ? window.__s / window.__n : 0, max: window.__max })`));
console.log(`  rail before ${before || '-'}, after a trip down and back ${await railTop() || '-'}`);
console.log(`  ${N} strokes: ${r.avg.toFixed(2)} ms / wheel notch  (worst ${r.max.toFixed(1)}, n=${r.n})`);

await wipe();
ws.close();
process.exit(0);
