/** The page's own confirm and prompt, in the real page.
 *
 *   node askcheck.mjs <url> <debug-port>
 *
 * `window.confirm` and `window.prompt` were doing this job. They are the browser's own
 * chrome, so they cannot wear the skin, they block the main thread, and — the one that
 * actually bites — inside the Android wrapper they do not exist unless the
 * WebChromeClient answers them: a WebView with no chrome client replies "no" instantly
 * and by itself, so "נקה" would quietly do nothing on the tablet.
 *
 * `lib/Ask.svelte` replaces them with a <dialog>. What has to hold is what the natives
 * gave for free and a hand-rolled modal usually forgets: cancel leaves the world alone,
 * ESCAPE is also a cancel AND settles the promise (a caller left awaiting for ever is
 * the classic bug here), and confirming really does the thing.
 */
import { asTablet, assertPad, roomUrl, freshRoom } from './lib/pad.mjs';

const [, , url, port] = process.argv;
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
let id = 0;
const p = new Map();
const send = (m, q = {}) =>
  new Promise((r, j) => {
    const i = ++id;
    p.set(i, r);
    setTimeout(() => j(new Error('t ' + m)), 20000);
    ws.send(JSON.stringify({ id: i, method: m, params: q }));
  });
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && p.has(m.id)) {
    p.get(m.id)(m.result);
    p.delete(m.id);
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
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${n.padEnd(46)} ${d}`);
};

await send('Emulation.setDeviceMetricsOverride', {
  width: 1180, height: 900, deviceScaleFactor: 1, mobile: true
});
await asTablet(send);
await send('Page.navigate', { url: roomUrl(url, freshRoom()) });
await wait(7000);
await assertPad(ev);

const ink = () =>
  ev(`(() => {
    const c = document.querySelector('canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 10) n++;
    return n;
  })()`);

const draw = async () => {
  const r = JSON.parse(
    await ev(`JSON.stringify(document.querySelector('canvas').getBoundingClientRect())`)
  );
  const y = r.top + r.height * 0.4;
  const x0 = r.left + r.width * 0.2;
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y, button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 10; i++)
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0 + i * 24, y: y + Math.sin(i) * 9, button: 'left', buttons: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x0 + 240, y, button: 'left', buttons: 0, clickCount: 1 });
  await wait(2500);
};

const clickClear = () =>
  ev(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'נקה')?.click()`);
const openDialog = async () => {
  for (let i = 0; i < 20; i++) {
    if (await ev(`!!document.querySelector('dialog.ask[open]')`)) return true;
    await wait(100);
  }
  return false;
};

// ---- it is an element, not the browser's box --------------------------------
check(
  'the page owns confirm and prompt, not the browser',
  (await ev(`!!document.querySelector('dialog.ask')`)) === true
);

// ---- cancel leaves the board alone -------------------------------------------
await draw();
const drawn = await ink();
check('there is ink to lose', drawn > 500, `${drawn} px`);
await clickClear();
check('the dialog opens on נקה', await openDialog());
await ev(`document.querySelector('dialog.ask[open] [data-ask="cancel"]')?.click()`);
await wait(1200);
check('cancel closes it', (await ev(`!!document.querySelector('dialog.ask[open]')`)) === false);
check('and the board is untouched', (await ink()) === drawn, `${await ink()} px`);

// ---- Escape is a cancel too, and must settle the promise ---------------------
await clickClear();
check('the dialog opens again', await openDialog());
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await wait(1200);
check('Escape closes it', (await ev(`!!document.querySelector('dialog.ask[open]')`)) === false);
check('and still nothing was cleared', (await ink()) === drawn, `${await ink()} px`);

// ---- confirming actually clears ----------------------------------------------
await clickClear();
check('the dialog opens a third time', await openDialog());
await ev(`document.querySelector('dialog.ask[open] [data-ask="ok"]')?.click()`);
await wait(2500);
check('confirming clears the board', (await ink()) === 0, `${await ink()} px`);

ws.close();
console.log(bad ? `\n${bad} FAILED` : '\nthe dialog behaves');
process.exit(bad ? 1 : 0);
