/** Undo and redo, on a real board.
 *
 *   node redocheck.mjs <url> <debug-port>
 *
 * Undo deletes the last stroke from the room. Redo has to put the SAME document back —
 * same id, same `n` — so the stroke returns to its own place in the order rather than to
 * the end. On a board two devices are watching, "somewhere near the end" is not the same
 * stroke coming back.
 *
 * Measured to the pixel, within DRIFT. A repaint antialiases the ends of a stroke a little
 * differently — erasecheck prints the same ±1 on strokes it never touched — so exact
 * equality was asserting a property this canvas does not have. Two pixels of slack still
 * fails the thing worth failing: a redo that brings back the wrong stroke, or none, is
 * out by thousands.
 *
 * The other half is the rule that makes redo mean anything: drawing again empties the
 * stack. Without it, redo drops a stroke back into the middle of work done since, which
 * is worse than having no redo at all.
 */
import { asTablet, assertPad, roomUrl, freshRoom } from './lib/pad.mjs';

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
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${n.padEnd(48)} ${d}`);
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

const rect = JSON.parse(
  await ev(`JSON.stringify(document.querySelector('canvas').getBoundingClientRect())`)
);
async function stroke(f) {
  const y = rect.top + rect.height * f;
  const x0 = rect.left + rect.width * 0.2;
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y, button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 10; i++)
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0 + i * 26, y, button: 'left', buttons: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x0 + 260, y, button: 'left', buttons: 0, clickCount: 1 });
  await wait(2200);
}
const click = (label) =>
  ev(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(label)})?.click()`);
const redoDisabled = () =>
  ev(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'החזר')?.disabled`);

check('redo starts with nothing to give back', (await redoDisabled()) === true);

await stroke(0.3);
await stroke(0.6);
const two = await ink();
check('two strokes on the board', two > 800, `${two} px`);

await click('בטל אחרון');
await wait(2000);
const one = await ink();
check('undo took one away', one < two * 0.75, `${two} -> ${one} px`);
check('and redo now has something', (await redoDisabled()) === false);

await click('החזר');
await wait(2500);
const back = await ink();
const DRIFT = 2;
check('redo put it back, to the pixel', Math.abs(back - two) <= DRIFT,
  `${back} px, was ${two}`);
check('and the stack is empty again', (await redoDisabled()) === true);

// drawing again is what makes "forward" meaningless
await click('בטל אחרון');
await wait(2000);
check('undo again, so there is something to redo', (await redoDisabled()) === false);
await stroke(0.8);
check('a new stroke empties the stack', (await redoDisabled()) === true);

ws.close();
console.log(bad ? `\n${bad} FAILED` : '\nundo and redo agree');
process.exit(bad ? 1 : 0);
