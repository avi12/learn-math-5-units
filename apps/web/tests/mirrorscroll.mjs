/** An edit on the tablet must not move the desktop mirror.
 *
 *   npm run preview -- --port <p>
 *   chrome --headless=new --remote-debugging-port=<port> about:blank
 *   node mirrorscroll.mjs http://localhost:<p>/ <port>
 *
 * Avi, 19.09.2026: "הרגע ביצעתי בקנבס בטבלט עריכה וזה גרם לקנבס בדסקטופ לגלול פתאום לטופ".
 *
 * The cause was a clamp. How far down the board may be scrolled is not a constant — it
 * is half a screen past the LOWEST STROKE, so the ceiling drops the moment the bottom of
 * the strip is erased. The mirror used to clamp its own scroll position against that
 * ceiling on every snapshot, and an assignment like that is destructive: where the
 * reader was is gone, and writing the ink back afterwards cannot bring it home. Erase
 * enough and the ceiling reaches zero, which is the jump to the top Avi saw.
 *
 * So the check is the thing he could see. Two pages in one room, a strip several screens
 * tall, the desktop parked where a person reading back would park it, and then an erase
 * on the tablet BELOW what the desktop is showing. Ink the desktop cannot even see must
 * not move the desktop.
 *
 * Measured as pixels on the desktop's canvas, not as a number read out of the component:
 * "the view did not move" means the same ink is in the same place on the glass, and a
 * component field could be right while the canvas was wrong.
 *
 * WHAT THIS FILE DOES NOT COVER, and why not. Two things used to move a mirror on someone
 * else's edit: the follow, which drags a reader DOWN to wherever the writing is, and the
 * ceiling clamp, which pulls them UP to half a screen past the lowest ink. This drives the
 * follow. The clamp cannot be driven here, and that is a property of the clamp rather than
 * a gap in the effort: it can only reach a reader whose own view already contains the ink
 * being erased, because a view sitting entirely ABOVE the erase is by definition above the
 * new ceiling too. Getting under the ceiling means erasing nearly everything, and at that
 * point `maxTop` is zero, the rail is hidden on BOTH builds, and the instrument that would
 * read the difference is gone. It was tried, at length. The clamp's removal is argued in
 * Surface.svelte rather than measured here.
 *
 * A fresh random room, cleared at the end.
 */
import { asTablet, roomUrl, freshRoom, DB } from './lib/pad.mjs';

const [, , url, port] = process.argv;
if (!url || !port) {
  console.error('usage: node mirrorscroll.mjs <url> <debug-port>');
  process.exit(2);
}

async function attach(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const send = (m, p = {}) =>
    new Promise((res, rej) => {
      const i = ++id;
      pending.set(i, res);
      setTimeout(() => rej(new Error('CDP timeout: ' + m)), 20000);
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
  const ev = async (x) =>
    (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }))
      .result?.value;
  return { ws, send, ev };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const say = (n, ok, d = '') => {
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${n.padEnd(54)} ${d}`.trimEnd());
};

const room = freshRoom();
const target = roomUrl(url, room);

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const first = list.find((t) => t.type === 'page');
const made = await (
  await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })
).json();

const A = await attach(first.webSocketDebuggerUrl); // tablet, holds the pen
const B = await attach(made.webSocketDebuggerUrl); // desktop, the mirror

await asTablet(A.send);
// ?role= rather than trusting the viewport: this file is about the mirror, and a mirror
// that quietly came up as a second pad would pass every assertion below by not being one.
await A.send('Page.navigate', { url: `${target}&role=pad` });
await B.send('Page.navigate', { url: `${target}&role=board` });
await wait(9000);

/** The canvas box in CSS pixels, on whichever page is asked. */
const boxOf = (p) =>
  p
    .ev(
      `(() => { const c = document.querySelector('canvas'); if (!c) return null;
         const r = c.getBoundingClientRect();
         return JSON.stringify({ x: r.x, y: r.y, w: r.width, h: r.height }); })()`
    )
    .then((s) => (s ? JSON.parse(s) : null));

const boxA = await boxOf(A);
const boxB = await boxOf(B);
say('both pages have a board', !!boxA && !!boxB, boxA && `tablet ${Math.round(boxA.w)}px`);
if (!boxA || !boxB) {
  console.log('\nno canvas, so nothing below could mean anything.');
  process.exit(1);
}

/** CDP input only reaches the page the browser has in front. Opening the mirror's tab
 *  puts IT in front, and every `Input.dispatchMouseEvent` aimed at the tablet after that
 *  simply never comes back — not an error, a hang, which is what killed two runs of
 *  this file before the cause was found. (picksync drives two tabs happily because it
 *  never sends input to either; it sets values from inside the page.) So `pen()` puts
 *  the tablet in front, once, before a gesture — not between the events of one, which
 *  would be moving the window out from under a pointer that is already down. */
const pen = (p) => p.send('Page.bringToFront');

const pt = (p, box, type, x, y) =>
  p.send('Input.dispatchMouseEvent', {
    type,
    x,
    y,
    button: 'left',
    buttons: type === 'mouseReleased' ? 0 : 1,
    clickCount: 1,
    pointerType: 'pen',
    force: 0.5
  });

/** One horizontal stroke at a fraction of the way down the VISIBLE board. */
async function stroke(p, box, f) {
  await pen(p);
  const y = box.y + box.h * f;
  const x0 = box.x + box.w * 0.2;
  await pt(p, box, 'mousePressed', x0, y);
  for (let s = 1; s <= 8; s++) {
    await pt(p, box, 'mouseMoved', x0 + (box.w * 0.5 * s) / 8, y);
    await wait(15);
  }
  await pt(p, box, 'mouseReleased', x0 + box.w * 0.5, y);
  await wait(350);
}

/** Scroll by whole screens. `wheel` divides deltaY by the canvas WIDTH, because the
 *  board's units are normalised to its width — so a screen is its height in CSS px.
 *
 *  A real WheelEvent dispatched inside the page, not CDP's `Input.dispatchMouseEvent`
 *  with type mouseWheel: that one does not survive touch emulation, which scrolltest
 *  already records. On the tablet page it does not merely fail — the call never comes
 *  back, and the first version of this file died on a CDP timeout. `cancelable` because
 *  the handler calls preventDefault. */
const scroll = (p, box, screens) =>
  p.ev(
    `document.querySelector('canvas').dispatchEvent(
       new WheelEvent('wheel', { deltaY: ${box.h * screens}, bubbles: true, cancelable: true })), 1`
  );

/** What the glass is showing: how much ink, and where the topmost of it sits. Two
 *  numbers rather than one, because a view that moved can keep its pixel count. */
const picture = (p) =>
  p
    .ev(
      `(() => { const c = document.querySelector('canvas');
         const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
         let n = 0, topRow = -1;
         for (let y = 0; y < c.height; y++)
           for (let x = 0; x < c.width; x++)
             if (d[(y * c.width + x) * 4 + 3] > 10) { n++; if (topRow < 0) topRow = y; }
         return JSON.stringify({ n, topRow, h: c.height }); })()`
    )
    .then((s) => JSON.parse(s));

/** Empty the room. The page asks with its own <dialog>, so the answer is a click and not
 *  a stubbed `window.confirm` — and the dialog opens a microtask after the button, so
 *  this waits for it rather than for a clock. Clicking a button that is not there yet is
 *  a silent no-op that would leave the room full for whatever runs next. */
async function clearBoard() {
  await A.ev(
    `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'נקה')?.click()`
  );
  for (let i = 0; i < 20 && !(await A.ev(`!!document.querySelector('dialog.ask[open]')`)); i++)
    await wait(100);
  await A.ev(`document.querySelector('dialog.ask[open] [data-ask="ok"]')?.click()`);
  await wait(1500);
}

/** How many strokes the ROOM holds. The erase has to be confirmed somewhere that belongs
 *  to neither page: the obvious version — "the tablet's screen is empty now" — is wrong
 *  on the broken build and only on the broken build, because the clamp moves the tablet
 *  too, so ink from further up scrolls into the view the rubber just cleared. */
const strokeCount = async () => {
  const r = await fetch(
    `${DB}/rooms/${room}/strokes?pageSize=300`
  );
  if (!r.ok) return -1;
  return ((await r.json()).documents ?? []).length;
};

/** The desktop rail's position, 0-100. `aria-valuenow` is `top / total`, so a reading of
 *  0 means the view is at the very top of the board however long the board is — which is
 *  precisely the symptom, and it stays comparable across an edit that changes `total`. */
const railAt = (p) =>
  p.ev(
    `(() => { const r = document.querySelector('[role="scrollbar"]');
       return r ? Number(r.getAttribute('aria-valuenow')) : -1; })()`
  );

/** Wait for ink to reach a page rather than sleeping a guessed number of seconds. A run
 *  where the strokes had not arrived yet measured an empty mirror and failed on that. */
async function untilInk(p, budgetMs = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < budgetMs) {
    if ((await picture(p)).n > 200) return Date.now() - t0;
    await wait(500);
  }
  return -1;
}

// ---- a board several DESKTOP screens tall -----------------------------------
// The two devices do not have the same screen. Measured here: the tablet's board is
// 728x150 CSS px because the question card is above it, so one tablet screen is 0.21 of
// a board width; the desktop mirror is 425x283, so one of ITS screens is 0.67 — three
// times taller. A strip that looks long on the tablet is one screen on the desktop, and
// then the mirror has nowhere to be parked and nothing below can fail. It is the
// DESKTOP's screen that has to be the unit here.
//
// And the board only lets you scroll half a screen past the lowest ink, so each cycle
// can only add about a third of a tablet screen: write near the bottom, scroll by less.
console.log('--- the tablet writes a board several desktop screens long ---');
for (let i = 0; i < 36; i++) {
  await stroke(A, boxA, 0.85);
  await scroll(A, boxA, 0.4);
  await wait(120);
}
say('ink reached the mirror', (await untilInk(B)) >= 0);

// ---- the reader parks the desktop by hand ------------------------------------
// Avi's case exactly: he had scrolled the desktop there himself.
console.log('--- the reader scrolls the desktop back up ---');
await scroll(B, boxB, -1.5);
await wait(1200);
const before = await picture(B);
const railBefore = await railAt(B);
say('the desktop is parked on ink', before.n > 200, `${before.n}px, topmost row ${before.topRow}`);
// The guard that makes the assertion below mean anything: a mirror already sitting at the
// top cannot be observed jumping to the top. An earlier run of this file built a board
// only 1.1 desktop screens long, the scroll up hit the top, and the "jump" it then
// measured was the mirror moving DOWN.
say('and it is well below the top of the board', railBefore > 10, `rail at ${railBefore}%`);

// ---- the tablet erases, and the ceiling collapses ----------------------------
console.log('--- the tablet rubs out the bottom of the board ---');
const wrote = await strokeCount();
await A.ev(`document.querySelector('button[data-tool="erase"]').click()`);
await wait(200);
say(
  'the rubber is selected on the tablet',
  (await A.ev(`document.querySelector('button[data-active="true"][data-tool="erase"]') !== null`)) ===
    true
);

for (const f of [0.3, 0.55, 0.8]) {
  await pen(A);
  const y = boxA.y + boxA.h * f;
  await pt(A, boxA, 'mousePressed', boxA.x + boxA.w * 0.1, y);
  for (let s = 1; s <= 16; s++) {
    await pt(A, boxA, 'mouseMoved', boxA.x + boxA.w * (0.1 + (0.8 * s) / 16), y);
    await wait(15);
  }
  await pt(A, boxA, 'mouseReleased', boxA.x + boxA.w * 0.9, y);
  await wait(400);
}
await wait(3500);

const after = await picture(B);
const railAfter = await railAt(B);
const left = await strokeCount();
console.log(`desktop before  : ${JSON.stringify(before)}  rail ${railBefore}%`);
console.log(`desktop after   : ${JSON.stringify(after)}  rail ${railAfter}%`);

say('the erase reached the room', left >= 0 && left < wrote, `${wrote} strokes -> ${left}`);

// The assertion, in Avi's words: the desktop must not be thrown to the beginning of the
// board because the tablet was edited. The rail says it plainly — 0 is the top, whatever
// the erase did to the board's length.
say(
  'the desktop was not thrown to the top of the board',
  railAfter > 0,
  `rail ${railBefore}% -> ${railAfter}%`
);
// And the stronger form: it is showing the same region it was showing. The rubber never
// reached that region, so nothing about it has changed.
say(
  'it is still showing the same region',
  Math.abs(after.n - before.n) <= Math.max(20, before.n * 0.02) &&
    Math.abs(after.topRow - before.topRow) <= 4,
  `${before.n}px@${before.topRow} -> ${after.n}px@${after.topRow}`
);

// ---- and the ceiling still stops a deliberate scroll -------------------------
// The clamp did not go away, it moved to where asking happens.
console.log('--- the end of the board is still the end ---');
await scroll(B, boxB, 40);
await wait(1000);
say('a scroll past the end lands back on the board', (await picture(B)).n > 100);

// ---- leave nothing behind ----------------------------------------------------

await clearBoard();

console.log(bad ? `\n${bad} FAILED` : '\nan edit on one device leaves the other where it was');
process.exit(bad ? 1 : 0);
