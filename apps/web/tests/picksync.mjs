/** The exercise choice has to cross between the devices, like the ink does.
 *
 *   npm run preview
 *   chrome --headless=new --remote-debugging-port=<port> about:blank
 *   node picksync.mjs http://localhost:4173 <port>
 *
 * The canvas was the only thing in the room, and that was half a room. The tablet is
 * what you write on, the desktop is what you read from, and the picker is what
 * "שקלוד יבדוק" sends — block, exercise and section. A desktop still on one exercise
 * while the tablet writes another asks Claude to mark the wrong question against the
 * wrong criteria, silently. That is worse than not asking.
 *
 * So this opens TWO pages in one room and drives the picker on each in turn. Both
 * directions, because both roles show the control: pad and board are the same app.
 *
 * The three things that can go wrong here are all echo-shaped, and each has a check:
 *   - a change on A must reach B                       (the point)
 *   - a change on B must reach A                       (not one-way)
 *   - the section travels with it, and is not lost     (it is a separate field)
 *   - B's arrival must not bounce back and overwrite A (the loop)
 */
import { asTablet, roomUrl, freshRoom } from './lib/pad.mjs';

const [, , url, port] = process.argv;
if (!url || !port) {
  console.error('usage: node picksync.mjs <url> <debug-port>');
  process.exit(2);
}

/** One CDP connection per page, so the two tabs are driven independently. */
async function attach(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const send = (m, p = {}) =>
    new Promise((res, rej) => {
      const i = ++id;
      pending.set(i, res);
      setTimeout(() => rej(new Error('CDP timeout: ' + m)), 20000);
      ws.send(JSON.stringify({ id: i, method: m, params: p, sessionId: undefined }));
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
const check = (n, ok, d = '') => {
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${n.padEnd(52)} ${d}`);
};

const room = freshRoom();
const target = roomUrl(url, room);

// The first tab is whatever the browser already has open; the second is asked for.
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const first = list.find((t) => t.type === 'page');
const madeUrl = await (
  await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })
).json();

const A = await attach(first.webSocketDebuggerUrl);
const B = await attach(madeUrl.webSocketDebuggerUrl);

// A is the tablet, B is the desktop mirror — the real pairing, not two of the same.
await asTablet(A.send);
await A.send('Page.navigate', { url: target });
await B.send('Page.navigate', { url: target });
await wait(9000);

/** The picker's value, and the section beside it. Read off the DOM rather than out of a
 *  component: what matters is what the control is showing to the person holding it. */
const state = (p) =>
  p.ev(`(() => {
    const s = [...document.querySelectorAll('.question .topic select')];
    return JSON.stringify({ pick: s[1]?.value ?? null, section: s[2]?.value ?? '' });
  })()`);

/** Set the picker the way a person does — change the value and fire the event Svelte
 *  is bound to. Assigning `.value` alone updates nothing. */
const setPick = (p, value) =>
  p.ev(`(() => {
    const s = document.querySelectorAll('.question .topic select')[1];
    if (!s) return 'no select';
    const has = [...s.options].some((o) => o.value === ${JSON.stringify(value)});
    if (!has) return 'no such option';
    s.value = ${JSON.stringify(value)};
    s.dispatchEvent(new Event('change', { bubbles: true }));
    return 'ok';
  })()`);

/** Two real options from the list, whatever the workbook currently ships. Hard-coding
 *  `01:1.1` would tie this test to the workbook's contents instead of to the sync. */
// The EXERCISE select only — the second of the card's selects (chapter, exercise,
// section). A query across all of them mixes chapter ids and section letters into the
// values, and picking "ג" as an exercise makes this test fail on itself, not on the sync.
const options = JSON.parse(
  await A.ev(`JSON.stringify(
    [...document.querySelectorAll('.question .topic select')[1].options].map((o) => o.value).filter((v) => !v.endsWith(':'))
  )`)
);
check('the picker has options to choose from', options.length > 10, `${options.length}`);
const [one, two] = [options[1], options[options.length - 2]];

const a0 = JSON.parse(await state(A));
const b0 = JSON.parse(await state(B));
check('both devices start on the same exercise', a0.pick === b0.pick, `${a0.pick}`);

// ---- tablet -> desktop -------------------------------------------------------
check('setting the picker on the tablet', (await setPick(A, one)) === 'ok', one);
await wait(3000);
const b1 = JSON.parse(await state(B));
check('the desktop followed', b1.pick === one, `desktop shows ${b1.pick}`);

// ---- desktop -> tablet -------------------------------------------------------
check('setting it back on the desktop', (await setPick(B, two)) === 'ok', two);
await wait(3000);
const a2 = JSON.parse(await state(A));
check('the tablet followed', a2.pick === two, `tablet shows ${a2.pick}`);

// ---- and it settled, rather than bouncing ------------------------------------
await wait(2500);
const a3 = JSON.parse(await state(A));
const b3 = JSON.parse(await state(B));
check('no echo — it stayed where it was put', a3.pick === two && b3.pick === two,
  `tablet ${a3.pick}, desktop ${b3.pick}`);

// ---- the section is its own field and must travel too ------------------------
const withSections = JSON.parse(
  await A.ev(`(async () => {
    const s = document.querySelectorAll('.question .topic select')[1];
    for (const o of [...s.options].map((o) => o.value).filter((v) => !v.endsWith(':'))) {
      s.value = o;
      s.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 60));
      const sec = document.querySelectorAll('.question .topic select')[2];
      if (sec && sec.options.length > 1) return JSON.stringify({ pick: o, letter: sec.options[1].value });
    }
    return JSON.stringify(null);
  })()`)
);
if (!withSections) {
  check('an exercise with sections exists to test with', false);
} else {
  await wait(2500);
  await A.ev(`(() => {
    const sec = document.querySelectorAll('.question .topic select')[2];
    sec.value = ${JSON.stringify(withSections.letter)};
    sec.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await wait(3000);
  const b4 = JSON.parse(await state(B));
  check('the section letter crossed too', b4.section === withSections.letter,
    `desktop section ${JSON.stringify(b4.section)}, wanted ${JSON.stringify(withSections.letter)}`);
  check('and it landed on the same exercise', b4.pick === withSections.pick, b4.pick);
}

A.ws.close();
B.ws.close();
await fetch(`http://127.0.0.1:${port}/json/close/${madeUrl.id}`);
console.log(bad ? `\n${bad} FAILED` : '\nthe choice travels with the room');
process.exit(bad ? 1 : 0);
