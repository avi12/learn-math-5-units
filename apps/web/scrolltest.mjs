/** The scrolling board, end to end in a real browser.
 *
 *   node scrolltest.mjs <url> <debug-port> [downloadDir]
 *
 * Four things have to hold, and each one is a way the old fixed page was broken:
 *
 *   1. the pad never scrolls as a document — the board cannot be lost off the screen;
 *   2. the board fills what is left, so nothing is written into a 66% letterbox;
 *   3. ink written after scrolling lands where it was drawn, and is still there when
 *      you come back to it — the offset has to be applied to input and to paint alike;
 *   4. the exported PNG grows with the strip. This is the one that fails silently:
 *      a fixed 3:2 export of a three-screen drawing pastes the first screen and looks
 *      complete.
 *
 * Drawing is driven as a mouse so palm rejection stays out of the way, and the pan is
 * driven as two real touches, which is the gesture that has to work while writing.
 */
import fs from 'node:fs';
import { asTablet, assertPad, roomUrl, freshRoom } from './lib/pad.mjs';
const [, , url, port, dir = '.'] = process.argv;
// A room of its own. This file counts ink pixels in bands of the board, so anything a
// previous run left behind is counted too — and it was: the wheel and the pan checks
// went red on a second run of an unchanged file, on ink neither of them had drawn.
const room = freshRoom();

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (m, p = {}) =>
  new Promise((r, j) => {
    const i = ++id;
    pending.set(i, r);
    // a CDP call that never answers looks exactly like a slow one; without this the
    // whole run just stops and says nothing
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
function check(name, ok, detail = '') {
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(52)} ${detail}`);
}

// A tablet held sideways: the shape the old letterbox was worst on.
await send('Emulation.setDeviceMetricsOverride', {
  width: 1180,
  height: 820,
  deviceScaleFactor: 1,
  mobile: false
});
// Touch emulation is ON here, via asTablet() below: it is what makes the app's own role
// detection put this tab on the writing board. Two comments used to sit here saying that
// touch emulation makes CDP mouse events "silently swallowed" and that the board just
// looks broken — that was folklore, and it was measured: a dispatched mouse still arrives
// as pointerType 'mouse' and still draws, with touch emulation on, at dsf 1 and 2 alike.
// The two-finger pan is still driven as PointerEvents from inside the page, because the
// handler listens to PointerEvents and that is the code path worth exercising.
await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dir }).catch(() => {});

await asTablet(send);
await send('Page.navigate', { url: roomUrl(url, room) });
await wait(6000);
await assertPad(ev);

const box = async () => await ev(`JSON.stringify(document.querySelector('canvas').getBoundingClientRect())`);
const rect = JSON.parse(await box());

// ---- 1 & 2: pinned to the viewport, and filling it ------------------------
const scrollH = await ev(`document.documentElement.scrollHeight`);
const innerH = await ev(`innerHeight`);
check('the page does not scroll', scrollH <= innerH + 2, `scrollHeight ${scrollH} vs ${innerH}`);
check('the board ends above the fold', rect.bottom <= innerH + 1, `bottom ${Math.round(rect.bottom)}`);
check(
  'the board is taller than the old 66% cap',
  rect.height > innerH * 0.42,
  `${Math.round(rect.height)}px of ${innerH}`
);

// ---- draw ------------------------------------------------------------------
// Real CDP input, not PointerEvents dispatched from inside the page: down() calls
// setPointerCapture, and that throws NotFoundError for a pointerId the browser has no
// record of — a synthetic pointerdown therefore never gets as far as drawing anything.
async function strokeAt(yFrac, tag) {
  const y = rect.top + rect.height * yFrac;
  const x0 = rect.left + rect.width * 0.15;
  const x1 = rect.left + rect.width * 0.55;
  const was = await ink();
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y, button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 12; i++) {
    await send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: x0 + ((x1 - x0) * i) / 12,
      y: y + Math.sin(i) * 12,
      button: 'left',
      buttons: 1
    });
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y, button: 'left', buttons: 0, clickCount: 1 });
  // A committed stroke leaves the board until Firestore echoes it back, so the canvas is
  // genuinely blank for a moment after every release. Wait for ink rather than a clock.
  // Wait for THIS stroke, not for any ink at all: the board already carries the earlier
  // ones, so "is there ink" is true immediately and the test would race ahead of the
  // write it just made — which is precisely how the rail and the wheel looked broken.
  let waited = 0;
  for (let i = 0; i < 40 && (await ink()) <= was; i++, waited += 250) await wait(250);
  console.log(`      drew ${tag} at ${Math.round(yFrac * 100)}% of the board (${waited}ms to land)`);
}

/** Ink pixels in a horizontal band of the visible board, top and bottom as fractions. */
const ink = async (from = 0, to = 1) =>
  await ev(`(() => {
    const c = document.querySelector('canvas');
    const y0 = Math.round(c.height * ${from});
    const h = Math.max(1, Math.round(c.height * ${to}) - y0);
    const d = c.getContext('2d').getImageData(0, y0, c.width, h).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 10) n++;
    return n;
  })()`);

await strokeAt(0.08, 'stroke 1');
await strokeAt(0.92, 'stroke 2');

// Poll, don't sample once. The ink counted above is the WET stroke, drawn the instant the
// pen lifts, while the rail follows the committed strokes, which arrive with the Firestore
// echo — so "stroke 2 landed (0ms)" can be true a moment before the rail exists. Checked
// once, this passed and failed on alternate runs of an unchanged build.
let railBefore = false;
for (let i = 0; i < 24 && !railBefore; i++) {
  railBefore = await ev(`!!document.querySelector('.rail')`);
  if (!railBefore) await wait(250);
}
check('a rail appears once there is somewhere to go', railBefore);

// ---- 3: wheel down, write, come back --------------------------------------
// Ink in the top band is the only honest witness that the board moved: stroke 1 is up
// there, so if the strip scrolled it has to leave.
const topBefore = await ink(0, 0.25);
check('stroke 1 is at the top to begin with', topBefore > 100, `${topBefore} ink pixels`);

// a real WheelEvent on the canvas: CDP's own mouseWheel does not survive touch emulation
// (the same dispatch is reused as `wheelDown()` further down, once the strip is being built)
await ev(
  `document.querySelector('canvas').dispatchEvent(new WheelEvent('wheel', {deltaY: 400, bubbles: true, cancelable: true})), 1`
);
await wait(400);
const topAfter = await ink(0, 0.25);
check('the wheel moves down the strip', topAfter < topBefore / 2, `${topBefore} -> ${topAfter} ink pixels`);

await strokeAt(0.75, 'stroke 3, below the first screen');

// Two fingers drag the strip back up, dispatched inside the page. CDP touch input never
// reaches the document in this headless build — measured, n=0 events — and the handler
// only cares about PointerEvents, so this drives the real code path either way.
async function pan(fromY, toY) {
  return await ev(`(() => {
    const c = document.querySelector('canvas');
    const x1 = ${rect.left + rect.width * 0.4}, x2 = ${rect.left + rect.width * 0.6};
    const P = (type, id, y, primary) =>
      c.dispatchEvent(new PointerEvent(type, {
        pointerId: id, pointerType: 'touch', isPrimary: primary,
        clientX: id === 1 ? x1 : x2, clientY: y, bubbles: true, cancelable: true
      }));
    P('pointerdown', 1, ${fromY}, true);
    P('pointerdown', 2, ${fromY} + 30, false);
    for (let i = 1; i <= 8; i++) {
      const y = ${fromY} + ((${toY} - ${fromY}) * i) / 8;
      P('pointermove', 1, y, true);
      P('pointermove', 2, y + 30, false);
    }
    P('pointerup', 1, ${toY}, true);
    P('pointerup', 2, ${toY} + 30, false);
    return 1;
  })()`);
}
await pan(rect.top + rect.height * 0.25, rect.top + rect.height * 0.9);
await wait(400);

const inkTop = await ink(0, 0.25);
check(
  'two fingers pan back, and stroke 1 is where it was left',
  inkTop > topBefore / 2,
  `${inkTop} ink pixels back at the top (was ${topBefore})`
);

// ---- 4: the export grows with the strip ------------------------------------
// `exportCanvas` is a component export no script can reach, so the bitmap is measured
// where it surfaces: a file on disk. `Page.setDownloadBehavior` above is what makes that
// land.
//
// It used to be the download button that wrote that file. That button is gone — the board
// exists to get handwriting into a conversation, and that is a paste — so the file now
// comes from "העתק כתמונה" taking its fallback: headless Chrome has no focused document,
// the clipboard write throws, and `copyPng` writes the PNG instead. The measurement is
// unchanged and the fallback is now covered too.
//
// This block used to find the button, never click it, and pass on `'clicked'` — while the
// header above promised it measured the export. It was the one check of the four that
// could not have failed.
//
// What matters is the SHAPE. `exportCanvas` sizes the image as max(PAGE, bottom + pad),
// so a strip that came back as one 3:2 page would mean everything below the first screen
// was dropped — and that page would look like a complete drawing, which is why this fails
// silently in the first place.
const PAGE = 1 / 1.5; // ink.ts: ASPECT is 1.5, and PAGE is one exported page of it

// The strip has to be longer than a page before "longer than a page" can be asserted of
// the export, and one wheel step does not get there: `maxTop()` is `inkBottom - viewH/2`,
// so the board only ever scrolls half a screen past the last stroke. Writing at the
// bottom and scrolling again is the only way down, which is exactly how it is used. Three
// rounds clear a page with room to spare; the first measured run stopped at 0.49 of one.
const wheelDown = () =>
  ev(
    `document.querySelector('canvas').dispatchEvent(new WheelEvent('wheel', {deltaY: 900, bubbles: true, cancelable: true})), 1`
  );
for (let r = 1; r <= 3; r++) {
  await wheelDown();
  await wait(300);
  await strokeAt(0.85, `stroke ${r + 3}, extending the strip`);
}

// The clipboard is where the export lands, and the clipboard is the point: this button
// exists so the drawing can be pasted into a conversation with Claude. Reading it back is
// therefore not a proxy for the artifact, it IS the artifact.
//
// The first replacement for the old download-button check assumed `copyPng` would fall
// back to writing a file, because CLAUDE.md says the Clipboard API needs a focused
// document and headless has none. Measured on Chrome 152: the write succeeds, the toast
// says "הועתק ללוח", and no file is written. The note is out of date; this reads the
// bitmap instead.
await send('Browser.grantPermissions', {
  permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite']
}).catch(() => {});

// "העתק כתמונה" is desktop-only since 12.09.2026 (the paste happens in a conversation, and
// the conversation is on the desktop), and this script writes as the tablet. So it does what
// a person does: writes on the pad, then flips to the desktop view to copy. The role buttons
// flip in place, so the room and the strip drawn in it carry across. Without this the check
// had been failing on "no button" ever since the copy button left the tablet.
await ev(
  `[...document.querySelectorAll('.roles .btn')].find((b) => b.textContent.trim() === 'תצוגה')?.click()`
);
await wait(1200);

const clicked = await ev(`(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('העתק כתמונה'));
  if (!btn) return 'no button';
  btn.click();
  return 'clicked';
})()`);
check('the export button is there', clicked === 'clicked', String(clicked));

await wait(1500);
const shot = JSON.parse(
  (await ev(`(async () => {
    try {
      for (const it of await navigator.clipboard.read()) {
        if (!it.types.includes('image/png')) continue;
        const blob = await it.getType('image/png');
        const bmp = await createImageBitmap(blob);
        return JSON.stringify({ w: bmp.width, h: bmp.height, bytes: blob.size });
      }
      return JSON.stringify({ error: 'no image on the clipboard' });
    } catch (e) { return JSON.stringify({ error: String(e.message) }); }
  })()`)) || '{"error":"nothing came back"}'
);

check('the copy put a PNG on the clipboard', !shot.error && shot.bytes > 0,
  shot.error ?? `${shot.bytes} bytes`);

if (!shot.error) {
  check('the export is a real bitmap', shot.w > 0 && shot.h > 0, `${shot.w}x${shot.h}`);
  check(
    'the export is taller than one page',
    shot.h > shot.w * PAGE + 1,
    `${shot.w}x${shot.h} — one page would be ${shot.w}x${Math.round(shot.w * PAGE)}`
  );
}


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

console.log(bad ? `\n${bad} FAILED` : '\nall checks passed');
ws.close();
process.exit(bad ? 1 : 0);
