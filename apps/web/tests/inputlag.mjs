/** Where the time goes between the pen touching the tablet and the ink appearing.
 *
 *   adb forward tcp:9555 localabstract:webview_devtools_remote_<pid>
 *   node inputlag.mjs 9555
 *
 * devicelag.mjs times the handlers; they are cheap. This drives REAL input through the
 * OS (`adb shell input stylus swipe`) and listens in the page, in a fresh room:
 *   - how long after contact the first pointermove arrives, and how far the pen has moved
 *   - the event timing of pointerdown: contact to the frame that shows its handler's work
 *   - whether the platform offers predicted points
 * It goes back to the page it found when it is done.
 */
import { execFileSync } from 'node:child_process';
import { freshRoom, roomUrl } from './lib/pad.mjs';

const [, , port] = process.argv;
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = list.find((t) => t.type === 'page');
const home = target.url;
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (m, p = {}) =>
  new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
};
await new Promise((r) => (ws.onopen = r));
const ev = async (x) =>
  (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.value;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await send('Page.navigate', { url: roomUrl(home, freshRoom()) });
await wait(6000);

await ev(`(() => {
  const c = document.querySelector('canvas');
  const log = (window.__lag = { ev: [], timing: [] });
  for (const type of ['pointerdown', 'pointermove', 'pointerup']) {
    c.addEventListener(type, (e) => {
      const now = performance.now();
      log.ev.push({ type, ts: e.timeStamp, at: now, x: e.clientX, y: e.clientY, kind: e.pointerType,
        co: e.getCoalescedEvents?.().length ?? -1, pr: e.getPredictedEvents?.().length ?? -1 });
      requestAnimationFrame((t) => log.ev[log.ev.length - 1] && (log.ev.find((x) => x.at === now).raf = performance.now()));
    }, true);
  }
  new PerformanceObserver((l) => {
    for (const x of l.getEntries())
      if (x.name.startsWith('pointer')) log.timing.push({ name: x.name, start: x.startTime, ps: x.processingStart, pe: x.processingEnd, dur: x.duration });
  }).observe({ type: 'event', durationThreshold: 16, buffered: true });
})()`);

const box = JSON.parse(await ev(`JSON.stringify({ ...document.querySelector('canvas').getBoundingClientRect().toJSON(), dpr: devicePixelRatio, sy: screen.height, ih: innerHeight })`));
const dev = (cx, cy) => [Math.round(cx * box.dpr), Math.round((cy + (box.sy - box.ih)) * box.dpr)];
console.log('canvas', box);

for (const [i, src] of ['stylus', 'touchscreen'].entries()) {
  const y = box.top + box.height * (0.3 + 0.3 * i);
  const [x1, y1] = dev(box.left + box.width * 0.15, y);
  const [x2, y2] = dev(box.left + box.width * 0.85, y);
  execFileSync('adb', ['shell', 'input', src, 'swipe', x1, y1, x2, y2, 400].map(String));
  await wait(1200);
}

const log = JSON.parse(await ev(`JSON.stringify(window.__lag)`));
const strokes = [];
for (const e of log.ev) {
  if (e.type === 'pointerdown') strokes.push([]);
  strokes.at(-1)?.push(e);
}
for (const s of strokes) {
  const d = s[0];
  const m = s.filter((e) => e.type === 'pointermove');
  const first = m[0];
  const gaps = m.map((e) => e.at - e.ts);
  console.log(`\n${d.kind}: ${m.length} moves`);
  console.log(`  down: queued ${(d.at - d.ts).toFixed(1)}ms, next frame +${(d.raf - d.at).toFixed(1)}ms`);
  if (first)
    console.log(`  first move: ${(first.ts - d.ts).toFixed(1)}ms after contact, ${Math.hypot(first.x - d.x, first.y - d.y).toFixed(1)}px away`);
  console.log(`  move queue delay median ${gaps.sort((a, b) => a - b)[gaps.length >> 1]?.toFixed(1)}ms; coalesced/event ${m.map((e) => e.co).join(',')}`);
  console.log(`  predicted per move: ${[...new Set(m.map((e) => e.pr))].join(',')}`);
}
console.log('\nevent timing (contact -> next paint):', log.timing.map((t) => `${t.name} ${t.dur}ms`).join(' | ') || 'none over 16ms');

await send('Page.navigate', { url: home });
ws.close();
