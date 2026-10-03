/** The rail's grip stays inside the board. `node railcheck.mjs <url> <port> [corner.png]`
 *
 * Avi (19.09.2026), with a screenshot of the board's bottom-left corner: "זה נשבר ויזואלית".
 * A black bar hung out of the board, below its border, down as far as the toolbar.
 *
 * Two faults in one 16px-wide element, and both of them only show far down a long strip:
 *
 *   1. The grip is floored so it stays big enough for a nib to land on — `max(12%, …)` in
 *      the height, and `min-height: 26px` again in the CSS. A floor is height the POSITION
 *      knows nothing about, so at the bottom of the strip `top / total` put the grip's TOP
 *      where a grip of the true height belonged and the floored extra hung off the end.
 *      Nothing clipped it either: neither the rail nor the host had any `overflow`.
 *   2. It was called `.thumb`, and the skin styles `.thumb` as an image thumbnail —
 *      `filter: grayscale(1) contrast(1.08)`, "read as surveillance feed". So it was
 *      greyed: ink-navy `#06182b` came out `#0d0d0d` on the light palette, and on the dark
 *      one the electric cyan came out plain grey with its glow drained.
 *
 * The checks: the grip never leaves the rail at any scroll position, it sits flush with
 * the end when the strip is at its end, it never shrinks past the floor that made it
 * grabbable, and it is painted in `--primary` with nothing filtering it, in both palettes.
 *
 * With a third argument it also writes a PNG of that corner, which is the only form in
 * which either fault is really legible.
 */
import { writeFileSync } from 'node:fs';
import { asTablet, assertPad, roomUrl, freshRoom } from './lib/pad.mjs';

const [, , url, port, shot] = process.argv;
if (!url || !port) {
  console.error('usage: node railcheck.mjs <url> <debug-port> [corner.png]');
  process.exit(2);
}
const room = freshRoom();

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (m, p = {}) =>
  new Promise((r, j) => {
    const i = ++id;
    pending.set(i, r);
    setTimeout(() => j(new Error(`CDP timeout: ${m}`)), 20000);
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

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
  if (r?.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + x);
  return r.result?.value;
};
let bad = 0;
const check = (name, ok, detail = '') => {
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(54)} ${detail}`);
};

await send('Emulation.setDeviceMetricsOverride', {
  width: 1180,
  height: 820,
  deviceScaleFactor: 1,
  mobile: false
});
await asTablet(send);
await send('Page.navigate', { url: roomUrl(url, room) });
await wait(6000);
await assertPad(ev);

const rect = JSON.parse(await ev(`JSON.stringify(document.querySelector('canvas').getBoundingClientRect())`));

/** Ink pixels on the visible board — the witness that a stroke has landed. */
const ink = async () =>
  await ev(`(() => {
    const c = document.querySelector('canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 10) n++;
    return n;
  })()`);

/** Real CDP input: down() calls setPointerCapture, which throws for a pointerId the
 *  browser has no record of, so a PointerEvent dispatched from inside the page never
 *  gets as far as drawing. */
async function strokeAt(yFrac) {
  const y = rect.top + rect.height * yFrac;
  const x0 = rect.left + rect.width * 0.15;
  const x1 = rect.left + rect.width * 0.55;
  const was = await ink();
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y, button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 8; i++)
    await send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: x0 + ((x1 - x0) * i) / 8,
      y,
      button: 'left',
      buttons: 1
    });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y, button: 'left', buttons: 0, clickCount: 1 });
  for (let i = 0; i < 40 && (await ink()) <= was; i++) await wait(250);
}

/** CDP's own mouseWheel does not survive touch emulation; a real WheelEvent does. */
const wheelDown = () =>
  ev(
    `document.querySelector('canvas').dispatchEvent(new WheelEvent('wheel', {deltaY: 1200, bubbles: true, cancelable: true})), 1`
  );

/** The rail and the element inside it, by structure and not by class name: the class is
 *  exactly what this test watched change, so naming it here would make the rename look
 *  like a pass. */
const geom = async () =>
  JSON.parse(
    await ev(`(() => {
      const rail = document.querySelector('[role="scrollbar"]');
      if (!rail) return JSON.stringify({ none: true });
      const t = rail.firstElementChild;
      const R = rail.getBoundingClientRect(), T = t.getBoundingClientRect();
      const host = document.querySelector('canvas').getBoundingClientRect();
      const cs = getComputedStyle(t);
      return JSON.stringify({
        rail: { top: R.top, bottom: R.bottom, height: R.height, left: R.left },
        thumb: { top: T.top, bottom: T.bottom, height: T.height },
        board: { bottom: host.bottom },
        // How far down the strip the rail says it is. At the bottom that is
        // (total - viewH) / total, so 1 - it is the share of the strip on screen — the
        // height the grip would have had with no floor under it.
        at: Number(rail.getAttribute('aria-valuenow')) / 100,
        filter: cs.filter,
        bg: cs.backgroundColor,
        primary: getComputedStyle(document.documentElement).getPropertyValue('--primary').trim()
      });
    })()`)
  );

// ---- down the strip --------------------------------------------------------
// `maxTop()` is `inkBottom - viewH/2`, so the board only ever scrolls half a screen past
// the last stroke: writing at the bottom and scrolling again is the only way down, and
// each round buys about four tenths of a screen.
let spill = 0;
for (let r = 1; r <= 16; r++) {
  await strokeAt(0.92);
  await wheelDown();
  await wait(200);
  const g = await geom();
  if (!g.none) spill = Math.max(spill, g.thumb.bottom - g.rail.bottom);
}

// Then the short window, which is what makes the floor bind without writing for a minute.
// The strip is stored in units normalised by the board's WIDTH, so how long it is does
// not move when the window does — but `viewH` is the board's height over that same width,
// so a wide, short window is a much smaller slice of the same strip. Sixteen rounds and
// this reshape put the view under a tenth of the strip, which is where a thumb floored at
// 12% is taller than the room left under it.
await send('Emulation.setDeviceMetricsOverride', {
  width: 1400,
  height: 520,
  deviceScaleFactor: 1,
  mobile: false
});
await wait(600);
for (let i = 0; i < 4; i++) {
  await wheelDown();
  await wait(200);
}
const g = await geom();
spill = Math.max(spill, g.thumb.bottom - g.rail.bottom);
const frac = g.thumb.height / g.rail.height;
console.log(
  `      rail ${g.rail.height.toFixed(0)}px, thumb ${g.thumb.height.toFixed(0)}px ` +
    `(${(frac * 100).toFixed(1)}% of it)`
);

// The precondition, read off the rail's own aria value rather than the drawing: at the
// bottom of the strip `aria-valuenow` is (total - viewH) / total, so what is left is the
// share of the strip on screen — the height the grip would have had with no floor under
// it. Under 12% and the floor is the thing deciding the height, which is the only state
// in which any of this could ever have gone wrong.
check(
  'the strip got long enough for the floor to bind',
  1 - g.at < 0.115,
  `on screen ${((1 - g.at) * 100).toFixed(1)}% of the strip, grip drawn at ${(frac * 100).toFixed(1)}%`
);

check(
  'the thumb stays inside the rail',
  spill <= 0.5,
  `worst overhang ${spill.toFixed(1)}px past the rail's bottom`
);
check(
  'the thumb stays inside the board',
  g.thumb.bottom <= g.board.bottom + 0.5,
  `thumb ends at ${g.thumb.bottom.toFixed(0)}, board at ${g.board.bottom.toFixed(0)}`
);
check(
  'the thumb is still big enough to land a nib on',
  frac >= 0.12 - 0.002,
  `${g.thumb.height.toFixed(0)}px, ${(frac * 100).toFixed(1)}% of the rail`
);
check('the thumb is not sitting above the rail', g.thumb.top >= g.rail.top - 0.5);

// The corner Avi photographed, so a fix can be looked at and not only asserted.
if (shot) {
  const png = await send('Page.captureScreenshot', {
    format: 'png',
    clip: {
      x: Math.max(0, g.rail.left - 36),
      y: Math.max(0, g.rail.bottom - 84),
      width: 200,
      height: 130,
      scale: 3
    }
  });
  writeFileSync(shot, Buffer.from(png.data, 'base64'));
  console.log(`      wrote ${shot}`);
}
check(
  'at the end of the strip it sits flush with the rail',
  Math.abs(g.thumb.bottom - g.rail.bottom) <= 0.5,
  `${(g.thumb.bottom - g.rail.bottom).toFixed(1)}px`
);

// ---- painted, not greyed ---------------------------------------------------
const rgb = (hex) => {
  const h = hex.replace('#', '');
  return `rgb(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)})`;
};
check('nothing filters the thumb', g.filter === 'none', g.filter);
check('the thumb is painted in --primary', g.bg === rgb(g.primary), `${g.bg} vs ${g.primary}`);

await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
await wait(300);
const d = await geom();
check('nothing filters it on the dark palette', d.filter === 'none', d.filter);
check('and it is cyan there, not grey', d.bg === rgb(d.primary), `${d.bg} vs ${d.primary}`);
await send('Emulation.setEmulatedMedia', { features: [] });

// leave nothing behind in the database
await ev(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'נקה')?.click()`);
for (let i = 0; i < 20 && !(await ev(`!!document.querySelector('dialog.ask[open]')`)); i++) await wait(100);
await ev(`document.querySelector('dialog.ask[open] [data-ask="ok"]')?.click()`);
await wait(1500);

console.log(bad ? `\n${bad} FAILED` : '\nall checks passed');
ws.close();
process.exit(bad ? 1 : 0);
