/** The rubber and the board size, in the real page on a tablet-shaped screen.
 *
 *   npm run preview
 *   chrome --headless=new --remote-debugging-port=<port> about:blank
 *   node erasecheck.mjs http://localhost:4173 <port>
 *
 * `erasetest.mjs` proves the hit test; this proves the wiring — that a sweep with the
 * rubber selected actually removes the stroke under it and leaves the others alone. It
 * counts INK PIXELS in three bands of the canvas rather than trusting a screenshot: ink
 * in the swept band must go to zero and the other two bands must not move.
 *
 * It used to assert the layout too — that there was a gutter left to drag the page by,
 * because on a tablet held sideways the canvas was as tall as the screen and swallowed
 * every touch. The strip replaced that design: the pad does not scroll at all now, and
 * scrolling happens inside the board. `scrolltest.mjs` owns the layout assertions, and
 * this file is about the rubber alone. The measurements are still printed as context.
 *
 * A fresh random room, so nothing here touches a real one; it is cleared at the end.
 */
import { asTablet, assertPad, roomUrl, freshRoom } from './lib/pad.mjs';
const [, , url, port] = process.argv;
const room = freshRoom();

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
// a tablet held sideways — the case that ran out of room
await send('Emulation.setDeviceMetricsOverride', {
  width: 1180,
  height: 820,
  deviceScaleFactor: 2,
  mobile: true
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (x) =>
  (await send('Runtime.evaluate', { expression: x, returnByValue: true })).result?.value;

await asTablet(send);
await send('Page.navigate', { url: roomUrl(url, room) });
await wait(6000);
await assertPad(ev);

const box = await ev(
  `(() => { const c = document.querySelector('canvas'); if (!c) return null;
     const r = c.getBoundingClientRect();
     return { x: r.x, y: r.y, w: r.width, h: r.height,
              vw: innerWidth, vh: innerHeight, page: document.documentElement.scrollHeight }; })()`
);
if (!box) {
  console.log('no canvas — is the preview server up?');
  process.exit(1);
}

let failures = 0;
const say = (ok, line, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${detail ? line.padEnd(46) : line} ${detail}`.trimEnd());
};

console.log('--- the board on a 1180x820 tablet ---');
console.log(`canvas          : ${Math.round(box.w)} x ${Math.round(box.h)} at y=${Math.round(box.y)}`);
console.log(`viewport        : ${box.vw} x ${box.vh}, page ${box.page}px tall`);
const gutter = Math.round((box.vw - box.w) / 2);
const below = Math.round(box.vh - (box.y + box.h));
console.log(`side gutter     : ${gutter}px      below the board: ${below}px`);

const pt = async (type, x, y) =>
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

/** A horizontal stroke across the middle of the board at height `f` of it. */
async function stroke(f) {
  const y = box.y + box.h * f;
  const x0 = box.x + box.w * 0.2;
  await pt('mousePressed', x0, y);
  for (let s = 1; s <= 12; s++) {
    await pt('mouseMoved', x0 + (box.w * 0.5 * s) / 12, y);
    await wait(20);
  }
  await pt('mouseReleased', x0 + box.w * 0.5, y);
  await wait(250);
}

/** Ink pixels in a horizontal band of the canvas, as a fraction of its area.
 *
 *  ALPHA, not colour. This used to read the pixel at (1,1) as "the background" and count
 *  whatever differed from it by more than 90 across r+g+b — on the stated belief that
 *  "the board paints itself in the theme colour". It does not: the live canvas is
 *  transparent and the board colour comes from CSS underneath it, so that corner pixel is
 *  (0,0,0,0). In the dark theme the ink is near-white and the sum came out huge, so the
 *  check passed and the belief was never tested. In the light theme the ink is #06182b —
 *  a distance of 73 from zero, under the threshold — and every band read zero on a board
 *  with three strokes plainly on it.
 *
 *  Measured while chasing exactly that: 17336 ink pixels by alpha, 0 by the old measure,
 *  same stroke. It only ever worked because earlier probes in the same browser had left
 *  `prefers-color-scheme: dark` emulated on the target; a fresh browser reads light and
 *  the file failed on its first assertion. Alpha asks the question the file means to ask
 *  and does not care what colour anything is. */
const ink = (f) =>
  ev(`(() => {
    const c = document.querySelector('canvas');
    const h = Math.round(c.height * 0.12);
    const y = Math.round(c.height * ${f} - h / 2);
    const d = c.getContext('2d').getImageData(0, y, c.width, h).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 10) n++;
    return n;
  })()`);

console.log('');
console.log('--- three strokes, then the rubber over the middle one ---');
for (const f of [0.25, 0.5, 0.75]) await stroke(f);
await wait(600);
const before = { top: await ink(0.25), mid: await ink(0.5), bottom: await ink(0.75) };
console.log('ink before      :', JSON.stringify(before));
const landed = before.top > 200 && before.mid > 200 && before.bottom > 200;
say(landed, 'all three strokes are on the board');

// Everything below compares ink after against ink before, and on an empty board both
// are zero — so "the swept stroke is gone" and "the other two are untouched" BOTH pass
// on a board that was never drawn on. Measured: with the strokes failing to land, this
// file reported three greens and had tested nothing. Stop here instead.
if (!landed) {
  console.log('\nno ink landed, so nothing below could mean anything — stopping here.');
  console.log(`\n${failures} FAILED`);
  ws.close();
  process.exit(1);
}

// the click and the read have to be separated: data-active is written by the next render
await ev(
  `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'מחק')?.click()`
);
await wait(400);
const picked = await ev(
  `document.querySelector('button[data-active="true"][data-tool="erase"]') !== null`
);
say(picked === true, 'the rubber button is there and takes the selection');

// sweep along the middle stroke
{
  const y = box.y + box.h * 0.5;
  await pt('mousePressed', box.x + box.w * 0.18, y);
  for (let s = 1; s <= 20; s++) {
    await pt('mouseMoved', box.x + box.w * (0.18 + (0.56 * s) / 20), y);
    await wait(20);
  }
  await pt('mouseReleased', box.x + box.w * 0.74, y);
}
await wait(1500);

const after = { top: await ink(0.25), mid: await ink(0.5), bottom: await ink(0.75) };
console.log('ink after       :', JSON.stringify(after));
say(after.mid === 0, 'the swept stroke is gone');
// Not exact equality. The erase repaints the whole strip, and a redrawn antialiased
// stroke does not land on bit-identical pixels: measured drift is 1-2 pixels in 17340,
// which failed this check while the rubber was working perfectly. What the check is for
// is a rubber that reaches strokes it was never swept over, and that empties a band or
// takes a visible bite out of it — so 1% is both far above the noise and far below any
// erase worth catching.
const intact = (a, b) => Math.abs(a - b) <= Math.max(20, b * 0.01);
say(
  intact(after.top, before.top) && intact(after.bottom, before.bottom),
  'the other two are untouched',
  `top ${before.top}->${after.top}, bottom ${before.bottom}->${after.bottom}`
);

// leave nothing behind in the database
// The page asks with its own <dialog> now, so the answer is a click and not a stubbed
// `window.confirm`. Waiting for the dialog to be open rather than for a clock: it is
// shown a microtask after the button, and clicking a button that is not there yet is a
// silent no-op that would leave the room uncleared for the next run to count.
await ev(
  `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'נקה')?.click()`
);
for (let i = 0; i < 20 && !(await ev(`!!document.querySelector('dialog.ask[open]')`)); i++)
  await wait(100);
await ev(`document.querySelector('dialog.ask[open] [data-ask="ok"]')?.click()`);
await wait(1500);

console.log(`\n${failures ? `${failures} FAILED` : 'all passed'}`);
ws.close();
process.exit(failures ? 1 : 0);
