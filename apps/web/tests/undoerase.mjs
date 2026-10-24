/** Undo has to give back what an erase took. `node undoerase.mjs <url> <debug-port>`
 *
 * Avi's case, verbatim: the S Pen's barrel button turns any stroke into an erase, it is
 * pressed by accident, and what it removes is gone. The old undo could not express this
 * at all — it deleted "the last stroke in the room", and an erase is not a stroke, it is
 * N deletions.
 *
 * So the checks are about the N: a rub that crosses three strokes must come back as
 * three, in one press of the button, and redo must take the same three away again. The
 * count is the whole point — putting one of three back would be worse than nothing.
 */
import { asTablet, assertPad, roomUrl, freshRoom } from './lib/pad.mjs';

const [, , url, port] = process.argv;
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = ({ method, params = {} }) =>
  new Promise((r, j) => {
    const i = ++id;
    pending.set(i, r);
    setTimeout(() => j(new Error('CDP timeout: ' + method)), 20000);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
};
await new Promise((r) => (ws.onopen = r));
await send({ method: 'Page.enable' });
await send({ method: 'Runtime.enable' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (x) =>
  (await send({ method: 'Runtime.evaluate', params: { expression: x, returnByValue: true, awaitPromise: true } })).result?.value;

let bad = 0;
const check = ({ name, ok, detail = '' }) => {
  if (!ok) {bad++;}
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(50)} ${detail}`);
};

await send({ method: 'Emulation.setDeviceMetricsOverride', params: {
  width: 1180, height: 900, deviceScaleFactor: 1, mobile: true
} });
await asTablet(send);
await send({ method: 'Page.navigate', params: { url: roomUrl({ url, room: freshRoom() }) } });
await wait(8000);
await assertPad(ev);

const ink = () => ev(`(() => {
  const c = document.querySelector('canvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 10) n++;
  return n;
})()`);

const rect = JSON.parse(await ev(`JSON.stringify(document.querySelector('canvas').getBoundingClientRect())`));

/** A horizontal stroke at a fraction of the board's height. */
async function stroke(fy) {
  const y = rect.top + rect.height * fy;
  const x0 = rect.left + rect.width * 0.25;
  await send({ method: 'Input.dispatchMouseEvent', params: { type: 'mousePressed', x: x0, y, button: 'left', buttons: 1, clickCount: 1 } });
  for (let i = 1; i <= 10; i++)
    {await send({ method: 'Input.dispatchMouseEvent', params: { type: 'mouseMoved', x: x0 + i * 30, y, button: 'left', buttons: 1 } });}
  await send({ method: 'Input.dispatchMouseEvent', params: { type: 'mouseReleased', x: x0 + 300, y, button: 'left', buttons: 0, clickCount: 1 } });
  await wait(1800);
}

const click = (label) =>
  ev(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(label)})?.click()`);
const redoDisabled = () =>
  ev(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'החזר')?.disabled`);

// three separate strokes, spread down the board
await stroke(0.3);
await stroke(0.45);
await stroke(0.6);
const three = await ink();
check({ name: 'three strokes on the board', ok: three > 1200, detail: `${three} px` });

// One vertical rub crossing all three — the accident this exists for. The eraser tool
// stands in for the barrel button: `down()` reaches the same `acting = 'erase'` path,
// and the button itself is penbutton.mjs's job.
await click('מחק');
await wait(400);
const x = rect.left + rect.width * 0.4;
const yTop = rect.top + rect.height * 0.25;
await send({ method: 'Input.dispatchMouseEvent', params: { type: 'mousePressed', x, y: yTop, button: 'left', buttons: 1, clickCount: 1 } });
for (let i = 1; i <= 14; i++)
  {await send({ method: 'Input.dispatchMouseEvent', params: { type: 'mouseMoved', x, y: yTop + i * 25, button: 'left', buttons: 1 } });}
await send({ method: 'Input.dispatchMouseEvent', params: { type: 'mouseReleased', x, y: yTop + 350, button: 'left', buttons: 0, clickCount: 1 } });
await wait(2200);

const erased = await ink();
check({ name: 'one rub took all three out', ok: erased < three * 0.2, detail: `${three} -> ${erased} px` });
check({ name: 'and undo has something to give back', ok: (await redoDisabled()) !== undefined });

await click('בטל אחרון');
await wait(2500);
const back = await ink();
check({ name: 'undo brought the whole erase back', ok: Math.abs(back - three) <= 2, detail: `${back} px, was ${three}` });

check({ name: 'redo is now offered', ok: (await redoDisabled()) === false });
await click('החזר');
await wait(2500);
const gone = await ink();
check({ name: 'redo erases the same three again', ok: gone < three * 0.2, detail: `${gone} px` });

await click('בטל אחרון');
await wait(2500);
const back2 = await ink();
check({ name: 'and undo returns them once more', ok: Math.abs(back2 - three) <= 2, detail: `${back2} px` });

// a rub over empty board is not a thing the hand did, so it must not become an undo step
await click('מחק');
const bx = rect.left + rect.width * 0.85;
await send({ method: 'Input.dispatchMouseEvent', params: { type: 'mousePressed', x: bx, y: rect.top + rect.height * 0.85, button: 'left', buttons: 1, clickCount: 1 } });
await send({ method: 'Input.dispatchMouseEvent', params: { type: 'mouseMoved', x: bx + 20, y: rect.top + rect.height * 0.86, button: 'left', buttons: 1 } });
await send({ method: 'Input.dispatchMouseEvent', params: { type: 'mouseReleased', x: bx + 20, y: rect.top + rect.height * 0.86, button: 'left', buttons: 0, clickCount: 1 } });
await wait(1500);
await click('בטל אחרון');
await wait(2200);
const after = await ink();
check({ name: 'a rub that hit nothing is not an undo step', ok: after < three * 0.9, detail: `${after} px — the drawing undo ran, not an empty erase` });

ws.close();
console.log(bad ? `\n${bad} FAILED` : '\nundo gives back what the eraser took');
process.exit(bad ? 1 : 0);
