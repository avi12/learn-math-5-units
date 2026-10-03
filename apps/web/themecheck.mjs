/** The ink follows the theme, without being scrolled into obeying.
 *
 *   node themecheck.mjs <url> <debug-port>
 *
 * FOUND, 12.09.2026, from Avi: "אחרי שינוי theme הקנבס ייראה ריק ורק בעת גלילה התוכן
 * שוב נראה." The board is not empty and never was — the committed ink is still on it, in
 * the OTHER theme's colour. Dark ink is `#06182b` and light ink is `#e2f4fa`, and each
 * one sits on the other theme's surface at a contrast of nearly nothing, so a switch in
 * either direction reads as a board that lost its writing.
 *
 * The cause is one missing term in a cache key. `paintDry` rasterises the committed
 * strokes once and blits them after that, keyed on "everything the picture depends on" —
 * the stroke ids, the scroll offset, the pixel size. The palette is also something the
 * picture depends on, and it was not in the key, so the theme listener called `paint()`
 * and `paint()` handed back the bitmap it already had. Scrolling changes the offset,
 * which changes the key, which is why scrolling "fixed" it.
 *
 * So this measures the one thing that states the contract: after the theme changes and
 * NOTHING ELSE HAPPENS, is the ink on the canvas the colour this theme writes in? Pixel
 * counting cannot answer that — the stale ink is fully opaque, and `erasecheck`'s alpha
 * measure would call the board full. The colour is the whole bug.
 */
import { asTablet, assertPad, roomUrl, freshRoom } from './lib/pad.mjs';

const [, , url, port] = process.argv;
const room = freshRoom();
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (m, p = {}) =>
  new Promise((r, j) => {
    const i = ++id;
    pending.set(i, r);
    setTimeout(() => j(new Error('CDP timeout: ' + m)), 20000);
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
const ev = async (x) =>
  (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }))
    .result?.value;

let bad = 0;
const check = (n, ok, d = '') => {
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${n.padEnd(50)} ${d}`);
};

const theme = (v) =>
  send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: v }] });

/** The ink actually on the canvas, and the ink this theme says to write with.
 *
 *  `drawn` is the most opaque pixel's colour: anti-aliasing puts a spread of alphas along
 *  a stroke, and the fully opaque core is the only place the colour is the colour and not
 *  a blend with nothing. `want` comes from the same token the app draws from, so this is
 *  the app's own statement of the answer and not a hex typed into a test. */
const sample = () =>
  ev(`(() => {
    const c = document.querySelector('.host canvas');
    const g = c.getContext('2d', { willReadFrequently: true });
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let best = -1, at = -1, lit = 0;
    for (let i = 3; i < d.length; i += 4) {
      if (d[i] > 8) lit++;
      if (d[i] > best) { best = d[i]; at = i - 3; }
    }
    const want = getComputedStyle(document.documentElement).getPropertyValue('--fg').trim();
    return JSON.stringify({
      lit,
      alpha: best,
      drawn: at < 0 ? null : [d[at], d[at + 1], d[at + 2]],
      want,
      surface: getComputedStyle(document.documentElement).getPropertyValue('--surface').trim()
    });
  })()`);

const hex = (s) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(s.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const far = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));

await theme('dark');
await asTablet(send);
await send('Page.navigate', { url: 'about:blank' });
await wait(300);
await send('Page.navigate', { url: roomUrl(url, room) });
await wait(6000);
await assertPad(ev);

// One stroke, drawn through the real handlers, and left to dry.
const rect = JSON.parse(
  await ev(`JSON.stringify(document.querySelector('.host canvas').getBoundingClientRect())`)
);
const y = rect.top + rect.height * 0.4;
const x0 = rect.left + rect.width * 0.2;
await send('Input.dispatchMouseEvent', {
  type: 'mousePressed', x: x0, y, button: 'left', buttons: 1, clickCount: 1
});
for (let i = 1; i <= 10; i++)
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: x0 + i * 28, y: y + (i % 2 ? 6 : -6), button: 'left', buttons: 1
  });
await send('Input.dispatchMouseEvent', {
  type: 'mouseReleased', x: x0 + 280, y, button: 'left', buttons: 0, clickCount: 1
});
await wait(1500);

const before = JSON.parse(await sample());
check('dark: there is ink on the board', before.lit > 200, `${before.lit} px`);
check(
  'dark: and it is the dark theme’s ink',
  before.drawn && hex(before.want) && far(before.drawn, hex(before.want)) <= 12,
  `drew rgb(${before.drawn}) want ${before.want}`
);

// The switch, and nothing else. No scroll, no click, no resize — those all move the
// cache key on their own and would hide exactly the bug this is here for.
await theme('light');
await wait(900);

const after = JSON.parse(await sample());
check('light: the ink is still there', after.lit > 200, `${after.lit} px`);
check(
  'light: and it repainted in the light theme’s ink',
  after.drawn && hex(after.want) && far(after.drawn, hex(after.want)) <= 12,
  `drew rgb(${after.drawn}) want ${after.want}`
);
// The failure this reproduces, stated as its own line: stale ink is ink that has become
// the background it sits on, which is why it read as an empty board.
check(
  'light: and it is not the colour of the surface it sits on',
  after.drawn && hex(after.surface) && far(after.drawn, hex(after.surface)) > 40,
  `drew rgb(${after.drawn}) on ${after.surface}`
);

// Back again, because a cache that is fixed in one direction is not fixed.
await theme('dark');
await wait(900);
const back = JSON.parse(await sample());
check(
  'dark again: it follows the switch back',
  back.drawn && hex(back.want) && far(back.drawn, hex(back.want)) <= 12,
  `drew rgb(${back.drawn}) want ${back.want}`
);

// Leave the room as it was found. The dialog is the page's own, so this is a click and
// then a wait for it to be open — a click at a button that is not there yet is the silent
// no-op that leaves the next run counting this run's ink.
await ev(
  `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'נקה')?.click()`
);
for (let i = 0; i < 20 && !(await ev(`!!document.querySelector('dialog.ask[open]')`)); i++)
  await wait(100);
await ev(`document.querySelector('dialog.ask[open] [data-ask="ok"]')?.click()`);
await wait(1200);

ws.close();
console.log(bad ? `\n${bad} FAILED` : '\nthe ink follows the theme');
process.exit(bad ? 1 : 0);
