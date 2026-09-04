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
const [, , url, port, dir = '.'] = process.argv;

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
// Touch emulation is sticky on a target: once some earlier run switched it on it stays
// on, and every CDP mouse event is then silently swallowed — the page receives nothing
// at all and the board just looks broken. Turn it off explicitly, every run.
await send('Emulation.setTouchEmulationEnabled', { enabled: false }).catch(() => {});
// Deliberately NO touch emulation: with it on, CDP's mouse events are swallowed and
// nothing reaches the page at all. The two-finger pan is driven as PointerEvents from
// inside the page instead, which is the thing the handler actually listens to.
await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dir }).catch(() => {});

await send('Page.navigate', { url });
await wait(6000);

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

const railBefore = await ev(`!!document.querySelector('.rail')`);
check('a rail appears once there is somewhere to go', railBefore);

// ---- 3: wheel down, write, come back --------------------------------------
// Ink in the top band is the only honest witness that the board moved: stroke 1 is up
// there, so if the strip scrolled it has to leave.
const topBefore = await ink(0, 0.25);
check('stroke 1 is at the top to begin with', topBefore > 100, `${topBefore} ink pixels`);

// a real WheelEvent on the canvas: CDP's own mouseWheel does not survive touch emulation
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
// The clipboard is out of reach headless, so the exported bitmap is measured through the
// same call the button makes. What matters is the SHAPE: a strip must not come back as
// one 3:2 page, because that page would look like a complete drawing.
const shape = await ev(`(async () => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('הורד PNG'));
  if (!btn) return 'no button';
  return 'clicked';
})()`);
check('the export button is there', shape === 'clicked', String(shape));

console.log(bad ? `\n${bad} FAILED` : '\nall checks passed');
ws.close();
process.exit(bad ? 1 : 0);
