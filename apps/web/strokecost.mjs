/** Where does the per-stroke cost actually go? `node strokecost.mjs <url> <port> [throttle]`
 *
 * The WebGPU question turns on this. A GPU raises fill rate and lowers per-draw cost on
 * BATCHED geometry. It does nothing for string parsing, object allocation, or a high
 * count of tiny separate draw calls.
 *
 * `drawStroke` currently does both of the latter: `unpack()` splits a string and allocates
 * one object per point, on every stroke on every frame; and for an ink stroke it issues a
 * `beginPath`/`stroke` pair PER SEGMENT so pressure can vary along it.
 *
 * This replays the same work three ways at the same throttle so the parts are separable.
 */
const [, , url, port, rate = '1'] = process.argv;
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

await send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 900, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url });
await new Promise((r) => setTimeout(r, 6000));
if (Number(rate) > 1) await send('Emulation.setCPUThrottlingRate', { rate: Number(rate) });

const out = await ev(`(() => {
  const c = document.querySelector('canvas');
  const ctx = c.getContext('2d');
  const W = c.width, H = c.height;

  // 64 strokes of 40 points, in the app's own packed-string format
  const STROKES = [];
  for (let s = 0; s < 64; s++) {
    const pts = [];
    for (let i = 0; i < 40; i++)
      pts.push([(0.05 + i * 0.02).toFixed(3), (0.05 + (s % 20) * 0.045 + Math.sin(i / 4) * 0.01).toFixed(3), '0.50']);
    STROKES.push(pts.map((p) => p.join(',')).join(';'));
  }

  const unpack = (p) => p.split(';').map((s) => {
    const [x, y, pr] = s.split(',');
    return { x: +x, y: +y, pr: +pr };
  });

  // pre-parsed, so the parse cost can be taken out of the drawing cost
  const PARSED = STROKES.map(unpack);

  const time = (fn, n) => { fn(); const t0 = performance.now(); for (let i = 0; i < n; i++) fn(); return (performance.now() - t0) / n; };

  // 1. parsing alone — no canvas touched at all
  const parseOnly = time(() => { for (const s of STROKES) unpack(s); }, 30);

  // 2. what the app does now: parse + one beginPath/stroke PER SEGMENT
  const perSegment = time(() => {
    ctx.clearRect(0, 0, W, H);
    for (const s of STROKES) {
      const pts = unpack(s);
      for (let i = 1; i < pts.length; i++) {
        ctx.beginPath();
        ctx.lineWidth = 6;
        ctx.moveTo(pts[i - 1].x * W, pts[i - 1].y * W);
        ctx.lineTo(pts[i].x * W, pts[i].y * W);
        ctx.stroke();
      }
    }
  }, 20);

  // 3. same pixels, pre-parsed, ONE path per stroke (constant width)
  const onePathEach = time(() => {
    ctx.clearRect(0, 0, W, H);
    for (const pts of PARSED) {
      ctx.beginPath();
      ctx.lineWidth = 6;
      ctx.moveTo(pts[0].x * W, pts[0].y * W);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x * W, pts[i].y * W);
      ctx.stroke();
    }
  }, 20);

  // 4. pre-built Path2D objects, reused — the ceiling for a CPU-side fix
  const PATHS = PARSED.map((pts) => {
    const p = new Path2D();
    p.moveTo(pts[0].x * W, pts[0].y * W);
    for (let i = 1; i < pts.length; i++) p.lineTo(pts[i].x * W, pts[i].y * W);
    return p;
  });
  const prebuilt = time(() => {
    ctx.clearRect(0, 0, W, H);
    ctx.lineWidth = 6;
    for (const p of PATHS) ctx.stroke(p);
  }, 20);

  return JSON.stringify({
    strokes: 64, pointsEach: 40, drawCallsNow: 64 * 39,
    parseOnlyMs: +parseOnly.toFixed(2),
    perSegmentMs: +perSegment.toFixed(2),
    onePathEachMs: +onePathEach.toFixed(2),
    prebuiltPath2DMs: +prebuilt.toFixed(2)
  });
})()`);
console.log(`throttle ${rate}x -> ${out}`);
ws.close();
