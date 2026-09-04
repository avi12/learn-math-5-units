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
 * It also reports the thing Avi hit: on a tablet held sideways the canvas used to be as
 * tall as the screen, and since it swallows every touch there was nothing left to drag
 * to scroll the page.
 *
 * A fresh random room, so nothing here touches a real one; it is cleared at the end.
 */
const [, , url, port] = process.argv;
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

await send('Page.navigate', { url: `${url}/?role=pad&room=${room}` });
await wait(6000);

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
const say = (ok, line) => {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${line}`);
};

console.log('--- the board on a 1180x820 tablet ---');
console.log(`canvas          : ${Math.round(box.w)} x ${Math.round(box.h)} at y=${Math.round(box.y)}`);
console.log(`viewport        : ${box.vw} x ${box.vh}, page ${box.page}px tall`);
const gutter = Math.round((box.vw - box.w) / 2);
const below = Math.round(box.vh - (box.y + box.h));
console.log(`side gutter     : ${gutter}px      below the board: ${below}px`);
say(gutter > 60 || below > 60, 'there is somewhere to put a finger that is not the canvas');
say(box.page > box.vh, 'the page really does scroll');

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

/** Ink pixels in a horizontal band of the canvas, as a fraction of its area. */
const ink = (f) =>
  ev(`(() => {
    const c = document.querySelector('canvas');
    const g = c.getContext('2d');
    const h = Math.round(c.height * 0.12);
    const y = Math.round(c.height * ${f} - h / 2);
    const d = g.getImageData(0, y, c.width, h).data;
    // the board paints itself in the theme colour; ink is whatever differs from corner 1
    const b = g.getImageData(1, 1, 1, 1).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (Math.abs(d[i] - b[0]) + Math.abs(d[i + 1] - b[1]) + Math.abs(d[i + 2] - b[2]) > 90) n++;
    }
    return n;
  })()`);

console.log('');
console.log('--- three strokes, then the rubber over the middle one ---');
for (const f of [0.25, 0.5, 0.75]) await stroke(f);
await wait(600);
const before = { top: await ink(0.25), mid: await ink(0.5), bottom: await ink(0.75) };
console.log('ink before      :', JSON.stringify(before));
say(before.top > 200 && before.mid > 200 && before.bottom > 200, 'all three strokes are on the board');

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
say(after.top === before.top && after.bottom === before.bottom, 'the other two are untouched');

// leave nothing behind in the database
await ev('window.confirm = () => true');
await ev(
  `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'נקה')?.click()`
);
await wait(1500);

console.log(`\n${failures ? `${failures} FAILED` : 'all passed'}`);
ws.close();
process.exit(failures ? 1 : 0);
