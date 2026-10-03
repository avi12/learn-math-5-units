/** Does the board say so when the server stops taking the writing?
 *
 *   npm run preview -- --port <p>
 *   chrome --headless=new --remote-debugging-port=<port> about:blank
 *   node stallcheck.mjs http://localhost:<p>/ <port>
 *
 * Avi, 19.09.2026: "אני רואה שאין סנכרון בין הקנבס במחשב לטבלט". The cause was the daily
 * Firestore write quota, and the reason it cost a message rather than a glance is that
 * the pad said NOTHING. Ink on the glass, no banner, a listener reporting itself healthy
 * — because `resource-exhausted` is retryable to the SDK, so it backs off, serves the
 * local cache, and never calls the listener's error callback. Measured against the live
 * site while the quota was out: the error in the console twice, `fault` empty throughout.
 *
 * So the check is not "does the error callback fire". It is the thing a person can see:
 * write something the server will not take, and the board has to say the writing is not
 * leaving this device.
 *
 * The stall is produced with CDP offline rather than by exhausting a real quota, and
 * that is the same condition as far as the pad is concerned — `setDoc` resolves on the
 * SERVER acknowledging the document, and offline it simply never resolves. Nothing here
 * writes to Firestore beyond the strokes it draws.
 */
import { asTablet, assertPad, roomUrl, freshRoom, DB, DOCS } from './lib/pad.mjs';

const [, , url, port] = process.argv;
if (!url || !port) {
  console.error('usage: node stallcheck.mjs <url> <debug-port>');
  process.exit(2);
}

const ws = new WebSocket(
  (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page')
    .webSocketDebuggerUrl
);
let id = 0;
const pending = new Map();
const send = (m, p = {}) =>
  new Promise((res, rej) => {
    const i = ++id;
    pending.set(i, res);
    setTimeout(() => rej(new Error('CDP timeout: ' + m)), 30000);
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
await send('Network.enable');
const ev = async (x) =>
  (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }))
    .result?.value;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const say = (n, ok, d = '') => {
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${n.padEnd(52)} ${d}`.trimEnd());
};

const offline = (yes) =>
  send('Network.emulateNetworkConditions', {
    offline: yes,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1
  });

await asTablet(send);
await send('Emulation.setDeviceMetricsOverride', {
  width: 1180,
  height: 820,
  deviceScaleFactor: 1,
  mobile: false
});
await send('Page.navigate', { url: roomUrl(url, freshRoom()) });
await wait(7000);
await assertPad(ev);

const box = JSON.parse(
  await ev(`(() => { const r = document.querySelector('canvas').getBoundingClientRect();
    return JSON.stringify({ x: r.x, y: r.y, w: r.width, h: r.height }); })()`)
);

const pt = (type, x, y) =>
  send('Input.dispatchMouseEvent', {
    type,
    x,
    y,
    button: 'left',
    buttons: type === 'mouseReleased' ? 0 : 1,
    clickCount: 1,
    pointerType: 'pen',
    force: 0.5
  });

/** One stroke across the board at height `f` of it. */
async function stroke(f) {
  const y = box.y + box.h * f;
  const x0 = box.x + box.w * 0.2;
  await pt('mousePressed', x0, y);
  for (let s = 1; s <= 10; s++) {
    await pt('mouseMoved', x0 + (box.w * 0.5 * s) / 10, y);
    await wait(20);
  }
  await pt('mouseReleased', x0 + box.w * 0.5, y);
  await wait(300);
}

const banner = () =>
  ev(`(() => { const p = document.querySelector('.stall'); return p ? p.textContent.trim() : ''; })()`);

/** Poll rather than sleep the whole budget: the pass is "it appears within", and the
 *  time it actually took is worth printing when the margin is what is in question. */
async function until(want, budgetMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < budgetMs) {
    if (!!(await banner()) === want) return Date.now() - t0;
    await wait(500);
  }
  return -1;
}

/** Is Firestore taking writes at all right now? One document, written and deleted over
 *  the REST API, before anything on the page is judged.
 *
 *  Without this the run is unreadable. A spent daily write quota looks EXACTLY like a
 *  pad that has stopped talking to the server — which is the point of the feature and
 *  also the thing that makes its own test ambiguous. Ask the backend directly and say so,
 *  rather than leaving a red line that could be either. */
async function backendTakesWrites() {
  const name = `${DOCS}/rooms/${freshRoom()}/strokes/probe`;
  const r = await fetch(`${DB}:commit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      // The full shape firestore.rules demands (`stroke_ok` wants t, c, w and p). A
      // short payload comes back 403 from the rules on a perfectly healthy backend,
      // and this probe then reports the opposite of the truth.
      writes: [
        {
          update: {
            name,
            fields: {
              t: { stringValue: 'ink' },
              c: { stringValue: 'ink' },
              w: { integerValue: '6' },
              p: { stringValue: '0.1,0.1,0.5' },
              n: { integerValue: '1' }
            }
          }
        }
      ]
    })
  });
  if (r.ok)
    await fetch(`${DB}:commit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ writes: [{ delete: name }] })
    }).catch(() => {});
  return { ok: r.ok, status: r.status };
}

const backend = await backendTakesWrites();
if (!backend.ok) {
  console.log('');
  console.log(`!!  Firestore is refusing writes right now (HTTP ${backend.status}).`);
  console.log('    The two "server is reachable" assertions cannot pass in this run, and a');
  console.log('    red line on either of them is the backend, not the page. The stall');
  console.log('    assertions in between are still real — rerun the whole file once writes');
  console.log(
    backend.status === 429
      ? '    come back (the free daily quota resets at midnight Pacific).'
      : '    come back. This is NOT the quota (that is 429) — look at firestore.rules'
  );
  if (backend.status !== 429)
    console.log('    and at the payload this probe sends, which has to satisfy them.');
  console.log('');
}

// ---- 1. a healthy board says nothing ---------------------------------------
console.log('--- writing while the server is reachable ---');
await stroke(0.3);
// Longer than STALL_MS in room.ts, or this assertion cannot fail and is worth nothing:
// the first version waited three seconds against an eight-second clock and passed on a
// backend that was refusing every write.
await wait(11000);
const quiet = await banner();
say('nothing on the board while writes land', quiet === '', quiet && `showed: ${quiet.slice(0, 60)}`);

// ---- 2. cut the network and write --------------------------------------------
console.log('--- the server stops taking it ---');
await offline(true);
await stroke(0.5);
const appeared = await until(true, 20000);
say('the board says the writing is not leaving', appeared >= 0, appeared >= 0 ? `after ${appeared}ms` : 'never showed');

const text = await banner();
say('it says what went wrong', /לא מקבל|נשאר במכשיר/.test(text), text.slice(0, 70));
say('and what to do about it', /רשת/.test(text) && /מכסת/.test(text));

// It must not touch the canvas at all. The first version floated across the top of the
// board, and the screenshot that came back had it sitting on the top line of real
// working — a message about writing not reaching the server, covering the writing. A
// board whose whole point is that it gets filled has no safe place to float over.
const geom = await ev(`(() => {
  const p = document.querySelector('.stall'), c = document.querySelector('canvas');
  if (!p || !c) return JSON.stringify({ missing: true });
  const a = p.getBoundingClientRect(), b = c.getBoundingClientRect();
  return JSON.stringify({ gap: Math.round(b.top - a.bottom), above: a.bottom <= b.top + 0.5 });
})()`);
const g = JSON.parse(geom);
say('it does not cover any of the board', g.above === true, `gap to canvas: ${g.gap}px`);

// The ink is still on the glass — the writing is not lost, only unsent, and the page
// must not imply otherwise by dropping it.
const inkPx = await ev(`(() => { const c = document.querySelector('canvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 10) n++; return n; })()`);
say('the ink is still on the glass', inkPx > 200, `${inkPx}px`);

// ---- 3. it comes back ---------------------------------------------------------
console.log('--- the server comes back ---');
await offline(false);
const cleared = await until(false, 25000);
say('the banner goes when writes land again', cleared >= 0, cleared >= 0 ? `after ${cleared}ms` : 'still showing');

console.log(bad ? `\n${bad} FAILED` : '\nall good');
if (bad && !backend.ok)
  console.log('(Firestore was refusing writes for this run — see the note at the top.)');
process.exit(bad ? 1 : 0);
