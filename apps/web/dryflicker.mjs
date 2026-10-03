/** Does the stroke vanish for a moment when it dries? `node dryflicker.mjs <url> <port>`
 *
 * FOUND, 09.09.2026, reproducible 3/3: one frame at zero ink, every stroke.
 *   [[8121,2933],[8128,0],[8137,2933]]
 *
 * androidx.ink states the contract that every native ink stack ships a primitive for: the
 * wet stroke must be erased and the dry one appear IN THE SAME FRAME, or you get "a gap
 * where the stroke is not drawn during a frame, or a double draw where translucent
 * strokes appear more opaque than they should".
 *
 * Our `up()` sets `live = null`, writes the stroke to Firestore, and repaints. The dry ink
 * comes back through the snapshot listener. If that round trip is not local-first, there
 * is a window with the stroke on neither layer. This samples the ink count densely across
 * pointer-up to find out.
 */
import { asTablet, assertPad, roomUrl, freshRoom } from './lib/pad.mjs';

const [, , url, port] = process.argv;
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (m, p = {}) =>
  new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
};
await new Promise((r) => (ws.onopen = r));
await send('Page.enable');
await send('Runtime.enable');
const ev = async (x) =>
  (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.value;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 900, deviceScaleFactor: 1, mobile: true });
await asTablet(send);
await send('Page.navigate', { url: roomUrl(url, freshRoom()) });
await wait(8000);
await assertPad(ev);

const rect = JSON.parse(await ev(`JSON.stringify(document.querySelector('canvas').getBoundingClientRect())`));
const y = rect.top + rect.height * 0.4;
const x0 = rect.left + rect.width * 0.2;

// Sample the canvas every animation frame, from before pointerup until well after, from
// inside the page — polling over CDP is far too coarse to see one frame.
await ev(`(() => {
  window.__samples = [];
  const c = document.querySelector('canvas');
  const g = c.getContext('2d', { willReadFrequently: true });
  let n = 0;
  const tick = () => {
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let ink = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 10) ink++;
    window.__samples.push([Math.round(performance.now()), ink]);
    if (++n < 200) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})()`);

await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y, button: 'left', buttons: 1, clickCount: 1 });
for (let i = 1; i <= 12; i++)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0 + i * 30, y, button: 'left', buttons: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x0 + 360, y, button: 'left', buttons: 0, clickCount: 1 });
await wait(4000);

const s = await ev(`JSON.stringify(window.__samples)`);
const samples = JSON.parse(s).filter(([, ink]) => ink >= 0);
const drawn = samples.filter(([, ink]) => ink > 200);
if (!drawn.length) {
  console.log('no ink was ever seen — the probe, not the app');
} else {
  const first = samples.indexOf(drawn[0]);
  const peak = Math.max(...drawn.map(([, ink]) => ink));
  const after = samples.slice(first);
  // a gap = a frame at near-zero ink after the stroke was already visible
  const gaps = after.filter(([, ink]) => ink < peak * 0.25);
  // print the window around the first empty frame that follows a full stroke
  const full = after.findIndex(([, ink]) => ink > peak * 0.9);
  const zero = after.findIndex(([t, ink], i) => i > full && full >= 0 && ink === 0);
  if (zero > 0) {
    console.log('window around the empty frame (ms, ink):');
    console.log('  ' + JSON.stringify(after.slice(Math.max(0, zero - 4), zero + 5)));
  } else console.log('no empty frame after the stroke was fully drawn');
  console.log(`peak ink ${peak}px over ${after.length} frames after first ink`);
  console.log(`frames at <25% of peak after the stroke appeared: ${gaps.length}`);
  if (gaps.length) console.log('  ', JSON.stringify(gaps.slice(0, 6)));
  console.log(`final ${after[after.length - 1][1]}px`);
}
ws.close();
