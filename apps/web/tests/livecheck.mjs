/** Gemini Live, the pad's half: the direct link between the devices, and the picture.
 *
 *   pnpm run preview
 *   chrome --headless=new --remote-debugging-port=<port> about:blank
 *   node livecheck.mjs http://localhost:4173 <port> [frame.jpg]
 *
 * Two pages in one room, a tablet and a desktop, as the session has them:
 *
 *   - a pen HOVERING over the tablet's board reaches the desktop over the direct link
 *     (lib/directlink.ts) and is drawn there, and goes away when the pen leaves;
 *   - a note Gemini writes arrives on the desktop and stays there — the tablet never
 *     shows it — and a note closed, or pushed out by a newer one, folds away;
 *   - the session's state crosses, so the tablet can show that Gemini is listening;
 *   - and the picture Gemini is handed (lib/frame.ts) is a real JPEG of the right size,
 *     with the hover in it. Pass a path to keep the picture and look at it — what is IN
 *     the picture is for eyes, not for a pixel count.
 *
 * What is NOT here: Gemini itself. The extension's half runs against a stand-in Gemini
 * page in apps/extension/livechain.mjs; the real client needs a Google sign-in.
 */
import { writeFileSync } from 'node:fs';
import { askPage, PadMessage } from './lib/extension.mjs';
import { asTablet, freshRoom, roomUrl } from './lib/pad.mjs';

const [, , url, port, out] = process.argv;
if (!url || !port) {
  console.error('usage: node livecheck.mjs <url> <debug-port> [frame.jpg]');
  process.exit(2);
}

async function attach(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const send = ({ method, params = {} }) =>
    new Promise((res, rej) => {
      const i = ++id;
      pending.set(i, res);
      setTimeout(() => rej(new Error('CDP timeout: ' + method)), 20000);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m.result);
      pending.delete(m.id);
    }
  };
  await new Promise((r) => (ws.onopen = r));
  await send({ method: 'Page.enable' });
  await send({ method: 'Runtime.enable' });
  const ev = async (x) =>
    (await send({ method: 'Runtime.evaluate', params: { expression: x, returnByValue: true, awaitPromise: true } }))
      .result?.value;
  return { ws, send, ev };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const say = ({ name, ok, detail = '' }) => {
  if (!ok) {bad++;}
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(56)} ${detail}`.trimEnd());
};

const room = freshRoom();
const target = roomUrl({ url, room });
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const first = list.find((t) => t.type === 'page');
const made = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const A = await attach(first.webSocketDebuggerUrl); // the tablet
const B = await attach(made.webSocketDebuggerUrl); // the desktop

await asTablet(A.send);
await A.send({ method: 'Page.navigate', params: { url: `${target}&role=pad` } });
await B.send({ method: 'Page.navigate', params: { url: `${target}&role=board` } });
await wait(9000);

const boxOf = (p) =>
  p
    .ev(
      `(() => { const c = document.querySelector('canvas'); if (!c) return null;
         const r = c.getBoundingClientRect();
         return JSON.stringify({ x: r.x + c.clientLeft, y: r.y + c.clientTop, w: c.clientWidth, h: c.clientHeight }); })()`
    )
    .then((s) => (s ? JSON.parse(s) : null));

const boxA = await boxOf(A);
const boxB = await boxOf(B);
say({ name: 'both pages have a board', ok: !!boxA && !!boxB });
if (!boxA || !boxB) {
  process.exit(1);
}

/** CDP input reaches only the tab in front; see mirrorscroll.mjs. */
const front = (p) => p.send({ method: 'Page.bringToFront' });
/** A pen event. A release names the button it lets go of — a release with no button
 *  lifts nothing, the nib stays down, and every later move draws. A hover names none. */
const pen = ({ type, x, y, buttons }) =>
  A.send({ method: 'Input.dispatchMouseEvent', params: {
    type,
    x,
    y,
    button: buttons || type === 'mouseReleased' ? 'left' : 'none',
    buttons,
    clickCount: type === 'mouseMoved' ? 0 : 1,
    pointerType: 'pen',
    force: buttons ? 0.5 : 0
  } });

async function stroke({ fx, fy, len = 0.4 }) {
  const x0 = boxA.x + boxA.w * fx;
  const y = boxA.y + boxA.h * fy;
  await pen({ type: 'mousePressed', x: x0, y, buttons: 1 });
  for (let s = 1; s <= 8; s++) {
    await pen({ type: 'mouseMoved', x: x0 + (boxA.w * len * s) / 8, y: y + Math.sin(s) * 6, buttons: 1 });
    await wait(12);
  }
  await pen({ type: 'mouseReleased', x: x0 + boxA.w * len, y, buttons: 0 });
  await wait(250);
}

const scrollA = (screens) =>
  A.ev(
    `document.querySelector('canvas').dispatchEvent(
       new WheelEvent('wheel', { deltaY: ${boxA.h * screens}, bubbles: true, cancelable: true })), 1`
  );

/** Violet pixels on the desktop's board: the pen mark (`--cat-3`) and nothing else uses it. */
const violet = () =>
  B.ev(`(() => {
    const c = document.querySelector('canvas');
    const want = getComputedStyle(document.documentElement).getPropertyValue('--cat-3').trim();
    const [r0, g0, b0] = [1, 3, 5].map((i) => parseInt(want.slice(i, i + 2), 16));
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4)
      if (d[i + 3] > 200 && Math.abs(d[i] - r0) < 30 && Math.abs(d[i + 1] - g0) < 30 && Math.abs(d[i + 2] - b0) < 30) n++;
    return n; })()`);

// ---- a bagrut-level exercise with sections, so the panel has something to fit ----
await B.ev(`(() => {
  const s = document.querySelector('.topic.exercise select');
  const o = [...s.options].find((o) => /:3\\.1$/.test(o.value));
  s.value = o.value;
  s.dispatchEvent(new Event('change', { bubbles: true }));
  return s.value; })()`);
await wait(1500);

// ---- ink down two screens of the strip, so the picture needs columns ----
await front(A);
for (const [i, fy] of [0.15, 0.4, 0.7].entries()) {
  await stroke({ fx: 0.1 + i * 0.05, fy });
}
await scrollA(0.9);
await wait(300);
for (const fy of [0.3, 0.55, 0.85]) {
  await stroke({ fx: 0.15, fy, len: 0.55 });
}
await wait(2500);

// ---- hover ----
console.log('--- the pen hovering on the tablet ---');
const before = await violet();
await front(A);
const hx = boxA.x + boxA.w * 0.6;
const hy = boxA.y + boxA.h * 0.5;
for (let s = 0; s < 6; s++) {
  await pen({ type: 'mouseMoved', x: hx + s * 3, y: hy, buttons: 0 });
  await wait(40);
}
await wait(1500);
const during = await violet();
say({ name: 'the hover reaches the desktop and is drawn', ok: during > before + 40, detail: `${before} -> ${during} px` });

let frame = null;
const ask = () => B.ev(askPage({ type: PadMessage.FRAME })).then((s) => JSON.parse(s));
frame = await ask();
say({ name: 'the picture is a JPEG', ok: frame?.mimeType === 'image/jpeg' && frame.base64.length > 20000,
  detail: frame ? `${frame.width}x${frame.height}, ${Math.round((frame.base64.length * 3) / 4 / 1024)} KB` : 'none' });
if (frame && out) {
  writeFileSync(out, Buffer.from(frame.base64, 'base64'));
  console.log(`      picture kept at ${out}`);
}

// Gemini asks about once a second for the whole session: each picture has to be quick,
// and has to show what was written since the last one.
const timed = async () => {
  const t0 = Date.now();
  const f = await ask();
  return { f, ms: Date.now() - t0 };
};
const p1 = await timed();
await front(A);
await stroke({ fx: 0.5, fy: 0.5, len: 0.3 });
await wait(1500);
const p2 = await timed();
say({ name: 'a picture is drawn well inside the 2.5 s the relay waits', ok: Math.max(p1.ms, p2.ms) < 1500, detail: `${p1.ms} / ${p2.ms} ms` });
say({ name: 'a stroke written since changes the next picture', ok: !!p2.f && p1.f?.base64 !== p2.f.base64 });

// leaving the board ends the hover
await front(A);
await pen({ type: 'mouseMoved', x: boxA.x + boxA.w * 0.6, y: boxA.y - 40, buttons: 0 });
await wait(1500);
const after = await violet();
say({ name: 'and goes away when the pen leaves', ok: after <= before + 5, detail: `${during} -> ${after} px` });
// While the pen is there the picture is a close-up around it; a moment after it goes,
// the whole board is back (frame.ts `FOCUS_LINGER_MS`). Kept beside the first, for eyes.
await wait(2500);
const whole = await ask();
say({ name: 'the pen gone a while, the picture shows the whole board again', ok: !!whole && whole.base64 !== p2.f?.base64 });
if (whole && out) {
  const wholeOut = out.replace(/(\.\w+)?$/, '-board$1');
  writeFileSync(wholeOut, Buffer.from(whole.base64, 'base64'));
  console.log(`      picture kept at ${wholeOut}`);
}

// ---- notes on the desktop, state to the tablet ----
console.log('--- what Gemini writes, on the desktop only ---');
await B.ev(askPage({ type: PadMessage.LIVE_STATUS, data: { state: 'live' } }));
await B.ev(askPage({ type: PadMessage.LIVE_NOTE, data: { id: 'n1', title: 'נוסחת השורשים',
  body: 'הפתרונות של $ax^{2}+bx+c=0$:' + String.fromCharCode(10) + '$x_{1,2}=' + String.fromCharCode(92) + 'frac{-b' + String.fromCharCode(92) + 'pm' + String.fromCharCode(92) + 'sqrt{b^{2}-4ac}}{2a}$' } }));
await wait(2500);
const noteOf = (p) =>
  p.ev(`JSON.stringify({
    title: document.querySelector('.notes .note h3')?.textContent ?? '',
    maths: document.querySelectorAll('.notes .note math').length,
    state: document.querySelector('.notes .lstate')?.textContent?.trim() ?? '' })`).then(JSON.parse);
const nb = await noteOf(B);
const na = await noteOf(A);
say({ name: 'the desktop shows the note, formulas typeset', ok: nb.title === 'נוסחת השורשים' && nb.maths >= 2, detail: `${nb.maths} formulas` });
say({ name: 'the tablet does not show it', ok: !na.title && !na.maths, detail: na.title });
say({ name: 'and that Gemini is listening', ok: na.state.includes('מקשיב'), detail: na.state });
// no picture asked for since Live came up: Gemini is no longer looking, and both say so
await wait(6500);
const blindA = (await noteOf(A)).state;
say({ name: 'a Gemini that stopped asking for pictures is shown as not looking', ok: blindA.includes('הפסיק'), detail: blindA });
await ask();
await wait(2000);
const seesA = (await noteOf(A)).state;
say({ name: 'and a new picture clears it', ok: !seesA.includes('הפסיק'), detail: seesA });
const button = await B.ev(
  `[...document.querySelectorAll('.qfoot button')].map((b) => b.textContent.trim()).join(' | ')`
);
say({ name: 'the desktop offers to end the session', ok: button.includes('סיום השיעור'), detail: button });

// a hidden tab runs no transitions, and a note leaves only when its fold has run
await front(B);
await B.ev(`document.querySelector('.notes .note .close')?.click(), 1`);
const folding = await B.ev(`!!document.querySelector('.notes .note[data-leaving]')`);
await wait(800);
say({ name: 'a closed note folds away rather than vanishing', ok: folding && !(await B.ev(`!!document.querySelector('.notes')`)) });
for (const n of ['n2', 'n3', 'n4', 'n5']) {
  await B.ev(askPage({ type: PadMessage.LIVE_NOTE, data: { id: n, title: n, body: 'x' } }));
}
await wait(1500);
const kept = await B.ev(`[...document.querySelectorAll('.notes .note h3')].map((h) => h.textContent).join(' ')`);
say({ name: 'a fourth note pushes the oldest out', ok: kept === 'n5 n4 n3', detail: kept });
await B.ev(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'הבא')?.click(), 1`);
const folds = await B.ev(`document.querySelectorAll('.notes .note[data-leaving]').length`);
await wait(800);
say({
  name: 'the next question folds them all away',
  ok: folds === 3 && !(await B.ev(`!!document.querySelector('.notes')`)),
  detail: `${folds} folding`
});
await B.ev(askPage({ type: PadMessage.LIVE_STATUS, data: { state: 'ended' } }));
await wait(1500);
say({ name: 'the session ending reaches the tablet', ok: !(await A.ev(`!!document.querySelector('.notes .lstate')`)) });

// ---- leave nothing behind ----
await A.ev(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'נקה')?.click()`);
for (let i = 0; i < 20 && !(await A.ev(`!!document.querySelector('dialog.ask[open]')`)); i++) {await wait(100);}
await A.ev(`document.querySelector('dialog.ask[open] [data-ask="ok"]')?.click()`);
await wait(1500);

console.log(bad ? `\n${bad} FAILED` : '\nthe pen, the session and the picture all cross; the notes stay on the desktop');
process.exit(bad ? 1 : 0);
