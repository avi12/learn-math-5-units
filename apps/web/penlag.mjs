/** What one pointermove costs while a stroke is in progress, as the board fills.
 *
 *   npm run preview
 *   chrome --headless=new --remote-debugging-port=<port> about:blank
 *   node penlag.mjs http://localhost:4173 <port> [cpuThrottle]
 *
 * `move()` repaints EVERY committed stroke plus the live one, synchronously, once per
 * pointer event — not once per animation frame. A pen reports at 120-240Hz. If one
 * repaint costs more than a frame's share of that, the main thread falls behind the pen
 * and the ink trails it; the gap grows with the ink already on the board, which is what
 * "it lags more the longer I write" means.
 *
 * Desktop numbers are the floor. A 2017 tablet is roughly an order of magnitude slower.
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

await send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 900, deviceScaleFactor: 2, mobile: true });
await asTablet(send);
await send('Page.navigate', { url: roomUrl(url, freshRoom()) });
await wait(8000);
await assertPad(ev);

const rect = JSON.parse(await ev(`JSON.stringify(document.querySelector('canvas').getBoundingClientRect())`));
async function stroke(fy) {
  const y = rect.top + rect.height * fy;
  const x0 = rect.left + rect.width * 0.12;
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y, button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 18; i++)
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0 + i * 44, y: y + Math.sin(i) * 14, button: 'left', buttons: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x0 + 792, y, button: 'left', buttons: 0, clickCount: 1 });
  await wait(600);
}

/** Drive a whole stroke through the real handlers and time each move. */
const probe = `(() => {
  const c = document.querySelector('canvas');
  const box = c.getBoundingClientRect();
  const mk = (type, i) => new PointerEvent(type, {
    pointerType: 'pen', pointerId: 77, isPrimary: true,
    buttons: type === 'pointerup' ? 0 : 1, pressure: type === 'pointerup' ? 0 : 0.5,
    bubbles: true, cancelable: true,
    clientX: box.left + box.width * 0.1 + i * 6,
    clientY: box.top + box.height * 0.5 + Math.sin(i / 3) * 40
  });
  c.dispatchEvent(mk('pointerdown', 0));
  const ms = [];
  for (let i = 1; i <= 60; i++) {
    const t0 = performance.now();
    c.dispatchEvent(mk('pointermove', i));
    ms.push(performance.now() - t0);
  }
  c.dispatchEvent(mk('pointerup', 61));
  ms.sort((a, b) => a - b);
  const total = ms.reduce((a, b) => a + b, 0);
  return JSON.stringify({
    median: +ms[30].toFixed(2), p90: +ms[54].toFixed(2), max: +ms[59].toFixed(2),
    mean: +(total / ms.length).toFixed(2)
  });
})()`;

const ink = () => ev(`(() => {
  const c = document.querySelector('canvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 10) n++;
  return n;
})()`);

const rate = Number(process.argv[4] || 1);
if (rate > 1) await send('Emulation.setCPUThrottlingRate', { rate });
console.log(`CPU throttle: ${rate}x`);
console.log('strokes  median   p90     max     mean   (ms per pointermove)');
let drawn = 0;
for (const target of [0, 8, 16, 32, 64]) {
  while (drawn < target) { await stroke(0.08 + ((drawn * 0.055) % 0.82)); drawn++; }
  const r = JSON.parse(await ev(probe));
  console.log(
    `${String(target).padEnd(8)} ${String(r.median).padEnd(8)} ${String(r.p90).padEnd(7)} ` +
    `${String(r.max).padEnd(7)} ${r.mean}`
  );
}
console.log('ink pixels on the board at the end:', await ink());
ws.close();
