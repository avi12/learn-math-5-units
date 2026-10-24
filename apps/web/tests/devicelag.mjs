/** What one pen move costs ON THE TABLET, as a single stroke grows.
 *
 *   adb forward tcp:9555 localabstract:webview_devtools_remote_<pid>
 *   node devicelag.mjs 9555
 *
 * penlag.mjs measures the cost of the ink ALREADY on the board, on a desktop. This one
 * measures the stroke in hand, on the device that lags: the wet stroke is redrawn from
 * its first point on every move, so a long stroke costs more per move than a short one.
 * It opens a fresh room (nothing lands on the real board) and goes back to the page it
 * found when it is done.
 */
import { freshRoom, roomUrl } from './lib/pad.mjs';

const [, , port] = process.argv;
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = list.find((t) => t.type === 'page');
const home = target.url;
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = ({ method, params = {} }) =>
  new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
};
await new Promise((r) => (ws.onopen = r));
const ev = async (x) =>
  (await send({ method: 'Runtime.evaluate', params: { expression: x, returnByValue: true, awaitPromise: true } })).result?.value;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await send({ method: 'Page.navigate', params: { url: roomUrl({ url: home, room: freshRoom() }) } });
await wait(6000);

/** One stroke of `n` moves through the real handlers, each move timed, a frame between
 *  moves as a real pen would have. Reported per quarter of the stroke, so growth shows. */
const probe = (n) => `(async () => {
  const c = document.querySelector('canvas');
  const box = c.getBoundingClientRect();
  const mk = (type, i) => new PointerEvent(type, {
    pointerType: 'pen', pointerId: 77, isPrimary: true,
    buttons: type === 'pointerup' ? 0 : 1, pressure: type === 'pointerup' ? 0 : 0.5,
    bubbles: true, cancelable: true,
    clientX: box.left + box.width * (0.1 + 0.8 * i / ${n}),
    clientY: box.top + box.height * 0.5 + Math.sin(i / 4) * 30
  });
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const t0 = performance.now();
  c.dispatchEvent(mk('pointerdown', 0));
  const down = performance.now() - t0;
  const ms = [];
  for (let i = 1; i <= ${n}; i++) {
    const t = performance.now();
    c.dispatchEvent(mk('pointermove', i));
    ms.push(performance.now() - t);
    if (i % 2 === 0) await frame();
  }
  c.dispatchEvent(mk('pointerup', ${n} + 1));
  const q = (a, b) => { const s = ms.slice(a, b); return +(s.reduce((x, y) => x + y, 0) / s.length).toFixed(2); };
  const k = ${n} / 4;
  return JSON.stringify({ down: +down.toFixed(2), quarters: [q(0, k), q(k, 2 * k), q(2 * k, 3 * k), q(3 * k, ${n})] });
})()`;

console.log('moves  down(ms)  mean ms per move, by quarter of the stroke');
for (const n of [40, 120, 300]) {
  const r = JSON.parse(await ev(probe(n)));
  console.log(`${String(n).padEnd(6)} ${String(r.down).padEnd(9)} ${r.quarters.join('  ')}`);
  await wait(1500);
}

await send({ method: 'Page.navigate', params: { url: home } });
ws.close();
