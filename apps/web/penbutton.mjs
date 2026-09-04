/** The S Pen side button erases. `node penbutton.mjs <url> <debug-port>`
 *
 * The gesture Avi asked for: touch the board while holding the pen's side button and it
 * rubs out instead of writing, whatever the toolbar says. There is no way to hold a real
 * S Pen from here, so the button is driven the way the device drives it — a pen pointer
 * whose `buttons` carries bit 1, which is what Pointer Events calls the barrel button.
 *
 * The test writes with the pen, then goes back over the same place with the button held,
 * and expects the ink to be gone. It also checks the toolbar is untouched afterwards:
 * the button changes THIS stroke, not the chosen tool.
 */
const [, , url, port] = process.argv;
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
    pending.get(m.id)(m.result ?? m.error);
    pending.delete(m.id);
  }
};
await new Promise((r) => (ws.onopen = r));
await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setTouchEmulationEnabled', { enabled: false }).catch(() => {});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true });
  return r?.exceptionDetails ? 'EXC ' + r.exceptionDetails.text : r.result?.value;
};

let bad = 0;
const check = (name, ok, detail = '') => {
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(46)} ${detail}`);
};

await send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 820, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url });
await wait(6000);

const rect = JSON.parse(await ev('JSON.stringify(document.querySelector("canvas").getBoundingClientRect())'));
const ink = async () =>
  await ev(`(() => {
    const c = document.querySelector('canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 10) n++;
    return n;
  })()`);

/** One pen stroke, with or without the side button held.
 *
 *  CDP will not build an event whose `buttons` disagrees with `button` — asking for the
 *  tip and the barrel together (button left, buttons 3) produces no event at all, which
 *  is measured, not assumed. The barrel alone is `button: 'right', buttons: 2`, and that
 *  is also how Chrome on Android delivers a stylus touch with the button held: as a
 *  secondary-button pointer, which is why the canvas suppresses the context menu. */
async function penStroke(yFrac, held) {
  const y = rect.top + rect.height * yFrac;
  const x0 = rect.left + rect.width * 0.2;
  const x1 = rect.left + rect.width * 0.7;
  const button = held ? 'right' : 'left';
  const buttons = held ? 2 : 1;
  const common = { pointerType: 'pen', force: 0.6, button };
  await send('Input.dispatchMouseEvent', { ...common, type: 'mousePressed', x: x0, y, buttons, clickCount: 1 });
  for (let i = 1; i <= 14; i++) {
    await send('Input.dispatchMouseEvent', {
      ...common,
      type: 'mouseMoved',
      x: x0 + ((x1 - x0) * i) / 14,
      y,
      buttons
    });
  }
  await send('Input.dispatchMouseEvent', { ...common, type: 'mouseReleased', x: x1, y, buttons: 0, clickCount: 1 });
}

// ---- write with the pen ----------------------------------------------------
const before = await ink();
await penStroke(0.4, false);
for (let i = 0; i < 40 && (await ink()) <= before; i++) await wait(250);
const written = await ink();
check('the pen writes', written > before, `${before} -> ${written} ink pixels`);
console.log('      pen reported:', JSON.stringify(await ev('document.querySelector(".probe")?.innerText ?? ""')));

// ---- go back over it with the button held ----------------------------------
await penStroke(0.4, true);
for (let i = 0; i < 40 && (await ink()) >= written; i++) await wait(250);
const after = await ink();
check('the side button rubs out instead', after < written, `${written} -> ${after} ink pixels`);
console.log('      pen reported:', JSON.stringify(await ev('document.querySelector(".probe")?.innerText ?? ""')));

// ---- the button arriving late still erases ---------------------------------
// Chrome does not always put the barrel on pointerdown. Write, then start a plain stroke
// and turn the button on one move later: it has to become an erase anyway.
await penStroke(0.6, false);
for (let i = 0; i < 40 && (await ink()) === 0; i++) await wait(250);
const second = await ink();
{
  const y = rect.top + rect.height * 0.6;
  const x0 = rect.left + rect.width * 0.2;
  await send('Input.dispatchMouseEvent', { pointerType: 'pen', force: 0.6, type: 'mousePressed', x: x0, y, button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 14; i++) {
    await send('Input.dispatchMouseEvent', {
      pointerType: 'pen', force: 0.6, type: 'mouseMoved',
      x: x0 + (rect.width * 0.5 * i) / 14, y, button: 'right', buttons: 2
    });
  }
  await send('Input.dispatchMouseEvent', { pointerType: 'pen', type: 'mouseReleased', x: x0 + rect.width * 0.5, y, button: 'right', buttons: 0, clickCount: 1 });
}
for (let i = 0; i < 40 && (await ink()) >= second; i++) await wait(250);
const third = await ink();
check('a button pressed after contact still erases', third < second, `${second} -> ${third} ink pixels`);
console.log('      pen reported:', JSON.stringify(await ev('document.querySelector(".probe")?.innerText ?? ""')));

// ---- the native wrapper's hook ---------------------------------------------
// This is the contract android/ speaks: window.__spen(true|false). Chrome will never
// send the button itself, so the wrapper reads MotionEvent.buttonState and calls this —
// and the page has to erase on a stroke that carries no button bits at all.
await penStroke(0.25, false);
for (let i = 0; i < 40 && (await ink()) === 0; i++) await wait(250);
const fourth = await ink();
check('the hook exists', (await ev('typeof window.__spen')) === 'function', await ev('typeof window.__spen'));
await ev('window.__spen(true), 1');
await penStroke(0.25, false); // an ORDINARY stroke: no button bits anywhere
for (let i = 0; i < 40 && (await ink()) >= fourth; i++) await wait(250);
const fifth = await ink();
check('a stroke erases while the hook says down', fifth < fourth, `${fourth} -> ${fifth} ink pixels`);
await ev('window.__spen(false), 1');
console.log('      pen reported:', JSON.stringify(await ev('document.querySelector(".probe")?.innerText ?? ""')));

// ---- and the toolbar is untouched ------------------------------------------
const stillInk = await ev(
  `[...document.querySelectorAll('button[data-tool]')].find((b) => b.dataset.active === 'true')?.dataset.tool ?? ''`
);
check('the chosen tool is unchanged', stillInk === 'ink', JSON.stringify(stillInk));

console.log(bad ? `\n${bad} FAILED` : '\nall checks passed');
ws.close();
process.exit(bad ? 1 : 0);
