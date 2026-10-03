/** How long the grid takes to follow the square-size slider. `node slidercost.mjs <url> <port> [cpu]`
 *
 * Avi (03.10.2026): "כשאני באינטראקציה עם הסליידר לוקח זמן למשבצות עד שהן גדלות וקטנות".
 * Real CDP mouse input along the slider (a synthetic `input` event skips the browser's own
 * range handling), CPU slowed to tablet speed. For each step: the time from the `input`
 * event to the first frame after it, which is when the new squares can be on screen. */
import { asTablet, assertPad, freshRoom, roomUrl } from './lib/pad.mjs';

const [, , url, port, cpu = '6'] = process.argv;
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0;
const w = new Map();
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (w.has(d.id)) {
    w.get(d.id)(d);
    w.delete(d.id);
  }
};
const send = (method, params = {}) => {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((r) => w.set(id, r));
};
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 820, deviceScaleFactor: 2, mobile: true });
await asTablet(send);
await send('Page.navigate', { url: roomUrl(`${url}?role=pad`, freshRoom()) });
await sleep(4000);
await assertPad(ev);
await send('Emulation.setCPUThrottlingRate', { rate: Number(cpu) });

const box = await ev(`(() => {
  const r = [...document.querySelectorAll('.tools label')].find((l) => l.textContent.includes('גודל משבצת')).querySelector('input');
  r.value = '1'; r.dispatchEvent(new Event('input', { bubbles: true }));
  const b = r.getBoundingClientRect();
  window.__lag = [];
  r.addEventListener('input', () => {
    const t = performance.now();
    requestAnimationFrame(() => requestAnimationFrame(() => window.__lag.push(performance.now() - t)));
  });
  return { x: b.left, y: b.top + b.height / 2, w: b.width };
})()`);
await sleep(1500);
// RTL range: the max end is on the left
const xs = Array.from({ length: 31 }, (_, i) => box.x + box.w - 2 - (i / 30) * (box.w - 4));
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: xs[0], y: box.y, button: 'left', buttons: 1, clickCount: 1 });
for (const x of [...xs, ...xs.slice().reverse()]) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: box.y, button: 'left', buttons: 1 });
  await sleep(16);
}
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: xs[0], y: box.y, button: 'left', buttons: 0, clickCount: 1 });
await sleep(1500);
const lag = await ev(`window.__lag`);
const avg = lag.reduce((a, b) => a + b, 0) / (lag.length || 1);
console.log(`cpu ×${cpu}: ${lag.length} steps, input→painted avg ${avg.toFixed(1)} ms, worst ${Math.max(...lag).toFixed(1)} ms`);
console.log(lag.map((v) => v.toFixed(0)).join(' '));
process.exit(0);
