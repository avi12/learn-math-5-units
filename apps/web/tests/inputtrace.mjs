/** A performance trace of one real stylus stroke on the tablet, summarised.
 *
 *   adb forward tcp:9555 localabstract:webview_devtools_remote_<pid>
 *   node inputtrace.mjs 9555 [out.json]
 *
 * inputlag.mjs says how long contact-to-ink takes; this says what the main thread was
 * doing meanwhile. Fresh room, real input through `adb shell input stylus swipe`, and the
 * page it found is restored at the end. The raw trace is written out for DevTools.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { freshRoom, roomUrl } from './lib/pad.mjs';

const [, , port, out = 'inputtrace.json'] = process.argv;
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = list.find((t) => t.type === 'page');
const home = target.url;
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const events = [];
let done;
const finished = new Promise((r) => (done = r));
const send = (m, p = {}) =>
  new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  if (m.method === 'Tracing.dataCollected') events.push(...m.params.value);
  if (m.method === 'Tracing.tracingComplete') done();
};
await new Promise((r) => (ws.onopen = r));
const ev = async (x) =>
  (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.value;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await send('Page.navigate', { url: roomUrl(home, freshRoom()) });
await wait(6000);
const box = JSON.parse(await ev(`JSON.stringify({ ...document.querySelector('canvas').getBoundingClientRect().toJSON(), dpr: devicePixelRatio, off: screen.height - innerHeight })`));
const dev = (cx, cy) => [Math.round(cx * box.dpr), Math.round((cy + box.off) * box.dpr)];

await send('Tracing.start', {
  categories: 'devtools.timeline,disabled-by-default-devtools.timeline,v8.execute,blink.user_timing,input,latencyInfo',
  transferMode: 'ReportEvents'
});
await wait(500);
const y = box.top + box.height * 0.4;
execFileSync('adb', ['shell', 'input', 'stylus', 'swipe', ...dev(box.left + box.width * 0.15, y), ...dev(box.left + box.width * 0.85, y), 400].map(String));
await wait(1000);
await send('Tracing.end');
await finished;
writeFileSync(out, JSON.stringify(events));

// The renderer main thread: the one that ran the pointer handlers.
const dispatch = events.find((e) => e.name === 'EventDispatch' && e.args?.data?.type === 'pointerdown');
const main = events.filter((e) => e.pid === dispatch?.pid && e.tid === dispatch?.tid);
const t0 = dispatch.ts;
const tasks = main.filter((e) => e.name === 'RunTask' && e.dur > 3000 && e.ts > t0 - 300000 && e.ts < t0 + 600000);
for (const task of tasks) {
  const inside = main.filter((e) => e.ts >= task.ts && e.ts < task.ts + task.dur && e.dur > 1000 && e.name !== 'RunTask');
  const what = inside
    .map((e) => `${e.name}${e.args?.data?.type ? `(${e.args.data.type})` : ''}${e.args?.data?.functionName ? `(${e.args.data.functionName})` : ''} ${(e.dur / 1000).toFixed(1)}`)
    .slice(0, 8).join(' > ');
  console.log(`${((task.ts - t0) / 1000).toFixed(1).padStart(7)}ms  ${(task.dur / 1000).toFixed(1).padStart(6)}ms  ${what}`);
}

await send('Page.navigate', { url: home });
ws.close();
