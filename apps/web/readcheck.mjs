/** The SHAPE of a multi-line read, with the real model, in a real browser.
 *
 *   npm run preview
 *   chrome --headless=new --remote-debugging-port=<port> about:blank
 *   node readcheck.mjs http://localhost:4173 <port> [minutes]
 *
 * This does not test whether the model reads handwriting correctly — synthetic strokes
 * are not handwriting, and accuracy is the model's business. It tests the plumbing that
 * was wrong on Avi's board: a two-line drawing must come back as TWO ROWS inside
 * `aligned`, never as one run-on expression with dollar signs in it, and never with
 * `\chi` standing in for x. It also fails if the whole-board fallback swallows the split,
 * which is what produced four equations glued into one line.
 *
 * Runs in a fresh random room and clears it afterwards. First run downloads ~305MB.
 */
const [, , url, port, mins = '12'] = process.argv;
const room = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
  b.toString(16).padStart(2, '0')
).join('');

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (m, p = {}) =>
  new Promise((r) => {
    const i = ++id;
    pending.set(i, r);
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
await send('Emulation.setDeviceMetricsOverride', { width: 1150, height: 1400, deviceScaleFactor: 1 });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (x) =>
  (await send('Runtime.evaluate', { expression: x, returnByValue: true })).result?.value;

await send('Page.navigate', { url: `${url}/?role=pad&room=${room}` });
await wait(6000);
const box = await ev(
  `(() => { const r = document.querySelector('canvas').getBoundingClientRect();
     return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`
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

async function draw(points) {
  const P = ([fx, fy]) => [box.x + box.w * fx, box.y + box.h * fy];
  const [sx, sy] = P(points[0]);
  await pt('mousePressed', sx, sy);
  for (const p of points.slice(1)) {
    const [x, y] = P(p);
    await pt('mouseMoved', x, y);
    await wait(10);
  }
  const [ex, ey] = P(points[points.length - 1]);
  await pt('mouseReleased', ex, ey);
  await wait(150);
}

// two lines, wide apart: "x = 1" over "y = 2"
await draw([[0.20, 0.16], [0.30, 0.30]]);
await draw([[0.30, 0.16], [0.20, 0.30]]);
await draw([[0.36, 0.20], [0.48, 0.20]]);
await draw([[0.36, 0.26], [0.48, 0.26]]);
await draw([[0.56, 0.16], [0.56, 0.30]]);

await draw([[0.20, 0.56], [0.26, 0.68]]);
await draw([[0.32, 0.56], [0.22, 0.78]]);
await draw([[0.36, 0.62], [0.48, 0.62]]);
await draw([[0.36, 0.68], [0.48, 0.68]]);
await draw([[0.54, 0.58], [0.62, 0.58], [0.54, 0.68], [0.62, 0.68]]);
await wait(1200);

await ev(
  `[...document.querySelectorAll('button')].find(b=>b.textContent.includes('נוסחה ב-LaTeX'))?.click()`
);

const deadline = Date.now() + Number(mins) * 60_000;
let last = '';
let tex = '';
while (Date.now() < deadline) {
  await wait(5000);
  const state = (await ev(`document.querySelector('.state')?.textContent?.trim()`)) ?? '';
  tex = (await ev(`document.querySelector('.tex')?.textContent?.trim()`)) ?? '';
  if (state !== last) {
    console.log(`[${new Date().toISOString().slice(11, 19)}] ${state}`);
    last = state;
  }
  if (tex && tex !== '\\;' && !state.includes('מזהה') && !state.includes('מוריד')) break;
}

console.log('');
console.log('status :', last);
console.log('latex  :', tex);

let failures = 0;
const say = (ok, line) => {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${line}`);
};

say(Boolean(tex) && tex !== '\\;', 'something came back');
say(!tex.includes('$'), 'no dollar signs left in the answer');
say(!tex.includes('\\chi'), 'no \\chi standing in for x');
say(!last.includes('נכשל'), 'the read did not error');
// two written lines: either two rows in aligned, or a stated miss — never a silent one
const twoRows = tex.includes('\\begin{aligned}') && tex.includes('\\\\');
say(twoRows || last.includes('לא נקרא'), 'two lines came back as two rows, or the miss was reported');

await ev('window.confirm = () => true');
await ev(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'נקה')?.click()`);
await wait(1500);

console.log(`\n${failures ? `${failures} FAILED` : 'all passed'}`);
ws.close();
process.exit(failures ? 1 : 0);
