/** Copying a long board in parts. `node partscheck.mjs <url> <debug-port>`
 *
 * Avi (19.09.2026), on a board six screens long: "הדחיסה על הקנבס אצל claude.ai גדולה
 * מדי… בנוסף לצילום קנבס מלא, תאפשר לצלם בחלקים".
 *
 * An image attached to a conversation is scaled down to roughly 1568px on its long edge.
 * For a strip that edge is the HEIGHT, so the taller the drawing the narrower it arrives,
 * and past a few screens the handwriting is gone. No export size fixes that — the answer
 * is fewer normalised units per image, which is what a part is: two pages, 1800×2400,
 * which that limit scales to 1176×1568 — still plainly handwriting.
 *
 * What is asserted is what he asked for, and what makes it trustworthy:
 *
 *   - the whole-strip copy still works and is still the default — "בנוסף", not instead;
 *   - the picker says which part of how many, and each press copies exactly that one;
 *   - every part is 1800×2400, so no part arrives at a worse resolution than another;
 *   - consecutive parts are different images, and none of them is blank;
 *   - the parts really cover the strip: the last one ends where the whole export ends,
 *     which is the silent failure worth guarding — a drawing that looks complete and is
 *     missing its answer;
 *   - the counter walks and wraps, so copy-paste-copy-paste needs no second control;
 *   - and none of it is on the tablet, where there is no conversation to paste into.
 */
import { asTablet, assertPad, roomUrl, freshRoom } from './lib/pad.mjs';

const [, , url, port] = process.argv;
if (!url || !port) {
  console.error('usage: node partscheck.mjs <url> <debug-port>');
  process.exit(2);
}
const room = freshRoom();

// ink.ts: ASPECT is 1.5, PAGE is one exported page of it, PART is how tall one copied
// part is (two pages), PART_OVERLAP is how much of a part repeats at the top of the next.
const PAGE = 1 / 1.5;
const PART = PAGE * 2;
const PART_OVERLAP = 0.03;
const W = 1800;

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (m, p = {}) =>
  new Promise((r, j) => {
    const i = ++id;
    pending.set(i, r);
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
const check = (name, ok, detail = '') => {
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(56)} ${detail}`);
};

await send('Emulation.setDeviceMetricsOverride', {
  width: 1180,
  height: 820,
  deviceScaleFactor: 1,
  mobile: false
});
await send('Browser.grantPermissions', {
  permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite']
}).catch(() => {});
await asTablet(send);
await send('Page.navigate', { url: roomUrl(url, room) });
await wait(6000);
await assertPad(ev);

const rect = JSON.parse(await ev(`JSON.stringify(document.querySelector('canvas').getBoundingClientRect())`));

const ink = async () =>
  await ev(`(() => {
    const c = document.querySelector('canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 10) n++;
    return n;
  })()`);

/** Real CDP input: `down()` calls setPointerCapture, which throws for a pointerId the
 *  browser has no record of, so a PointerEvent dispatched inside the page draws nothing. */
async function strokeAt(yFrac) {
  const y = rect.top + rect.height * yFrac;
  const x0 = rect.left + rect.width * 0.15;
  const x1 = rect.left + rect.width * 0.7;
  const was = await ink();
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y, button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 10; i++)
    await send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: x0 + ((x1 - x0) * i) / 10,
      y: y + Math.sin(i) * 10,
      button: 'left',
      buttons: 1
    });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y, button: 'left', buttons: 0, clickCount: 1 });
  for (let i = 0; i < 40 && (await ink()) <= was; i++) await wait(250);
}

const wheelDown = () =>
  ev(
    `document.querySelector('canvas').dispatchEvent(new WheelEvent('wheel', {deltaY: 1200, bubbles: true, cancelable: true})), 1`
  );

// ---- a strip several pages long -------------------------------------------
// One line at the very top first, so the top-band check further down has something to
// weigh. Without it that check compares zero to zero and cannot fail, which is the one
// kind of check worse than none.
await strokeAt(0.03);
// `maxTop()` is `inkBottom - viewH/2`, so writing at the bottom and scrolling again is
// the only way down — the same way a person gets there.
for (let r = 1; r <= 22; r++) {
  await strokeAt(0.9);
  await wheelDown();
  await wait(180);
}

// ---- the tablet has neither button ----------------------------------------
const onPad = await ev(`(() => {
  const t = [...document.querySelectorAll('button')].map((b) => b.textContent.trim());
  return JSON.stringify({
    whole: t.filter((s) => s.includes('העתק כתמונה')).length,
    part: t.filter((s) => s.includes('העתק חלק')).length
  });
})()`);
const pad = JSON.parse(onPad);
check('tablet: no whole-board copy', pad.whole === 0, `${pad.whole} buttons`);
check('tablet: no part copy either', pad.part === 0, `${pad.part} buttons`);

// The copy lives where the pasting is, so the test does what a person does: write on the
// pad, flip to the desktop view, copy there. The role buttons flip in place, so the room
// and the strip drawn in it carry across.
await ev(
  `[...document.querySelectorAll('.roles .btn')].find((b) => b.textContent.trim() === 'תצוגה')?.click()`
);
await wait(1500);

/** Click a button by the text it carries. */
const clickText = (s) =>
  ev(`(() => {
    const b = [...document.querySelectorAll('button')].find((b) => b.textContent.includes(${JSON.stringify(s)}));
    if (!b) return 'no button';
    b.click();
    return 'clicked';
  })()`);

/** Which part the toolbar is pointing at, as "1/3" — or null when there is nothing to
 *  split. Read off the PICKER, which is the control that holds the choice; the question
 *  card has selects of its own, so the toolbar is named explicitly. */
const label = () =>
  ev(`(() => {
    const s = document.querySelector('.tools .topic select');
    return s ? (Number(s.value) + 1) + '/' + s.options.length : null;
  })()`);

/** Choose a part the way a person does: click the OPTION. The picker is
 *  `appearance: base-select`, so the list is real DOM and that click is what a choice
 *  is; the value and the `change` that a trusted click would bring follow it. */
const choose = (i) =>
  ev(`(() => {
    const s = document.querySelector('.tools .topic select');
    if (!s) return 'no picker';
    s.options[${i}].click();
    s.value = String(${i});
    s.dispatchEvent(new Event('change', { bubbles: true }));
    return 'set';
  })()`);

/** Click the option that is ALREADY selected, and nothing else.
 *
 *  That is all a browser delivers in that case: the option is clicked, the popup closes,
 *  and no `change` and no `input` ever fire. The first version of this test dispatched
 *  `change` by hand anyway, so it passed against the build that had the bug in it — a
 *  check that could not fail. */
const repick = (i) =>
  ev(`(() => {
    const s = document.querySelector('.tools .topic select');
    if (!s) return 'no picker';
    s.options[${i}].click();
    return 'repicked';
  })()`);

/** Clicking the closed control to open the list — which is not a choice, and must not
 *  move the board on its own.
 *
 *  A REAL mouse click, not `el.click()`, and the difference is the whole point of the
 *  check: with `appearance: base-select` the closed control renders the selected
 *  option's own content inside itself, so a trusted click can land on an `<option>`
 *  before it is retargeted at the shadow boundary. `el.click()` targets the select by
 *  construction and could never tell us that. */
async function openPicker() {
  const r = JSON.parse(
    await ev(`(() => {
      const s = document.querySelector('.tools .topic select');
      if (!s) return JSON.stringify({ none: true });
      s.scrollIntoView({ block: 'center' });
      const b = s.getBoundingClientRect();
      return JSON.stringify({ x: b.left + b.width / 2, y: b.top + b.height / 2 });
    })()`)
  );
  if (r.none) return 'no picker';
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', buttons: 0, clickCount: 1 });
  return 'opened';
}

/** Close whatever the click above opened, without choosing. */
const escape = async () => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
};

/** Where the board is looking, as the rail reports it: top / total, in whole percent. */
const at = () =>
  ev(`Number(document.querySelector('[role="scrollbar"]')?.getAttribute('aria-valuenow') ?? -1)`);

const wheelUp = () =>
  ev(
    `document.querySelector('canvas').dispatchEvent(new WheelEvent('wheel', {deltaY: -4000, bubbles: true, cancelable: true})), 1`
  );

/** The image now on the clipboard, measured. `ink` counts pixels that differ from the
 *  export's own background — the export fills one, so the corner pixel IS the background
 *  and the comparison is honest in both palettes. `band` is the ink in the bottom 60
 *  ROWS — a fixed pixel height and not a fraction, because the whole export is three
 *  times taller than a part and a proportional band would compare two different regions.
 *  Both images end at the same place on the strip, so those 60 rows are the same pixels,
 *  and that is how the last part proves it reaches the end. `head` is the same 60 rows at
 *  the TOP, which anchors the other end against part one. */
const grab = async () =>
  JSON.parse(
    (await ev(`(async () => {
      try {
        for (const it of await navigator.clipboard.read()) {
          if (!it.types.includes('image/png')) continue;
          const blob = await it.getType('image/png');
          const bmp = await createImageBitmap(blob);
          const cv = new OffscreenCanvas(bmp.width, bmp.height);
          const cx = cv.getContext('2d');
          cx.drawImage(bmp, 0, 0);
          const d = cx.getImageData(0, 0, bmp.width, bmp.height).data;
          const bg = [d[0], d[1], d[2]];
          const rows = 60 * bmp.width * 4;
          const bandFrom = Math.max(0, d.length - rows);
          let ink = 0, band = 0, head = 0, sig = 0;
          for (let i = 0; i < d.length; i += 4) {
            const off = Math.max(Math.abs(d[i] - bg[0]), Math.abs(d[i + 1] - bg[1]), Math.abs(d[i + 2] - bg[2])) > 40;
            if (!off) continue;
            ink++;
            if (i < rows) head++;
            if (i >= bandFrom) band++;
            sig = (sig * 31 + i) % 2147483647;
          }
          return JSON.stringify({ w: bmp.width, h: bmp.height, bytes: blob.size, ink, head, band, sig });
        }
        return JSON.stringify({ error: 'no image on the clipboard' });
      } catch (e) { return JSON.stringify({ error: String(e.message) }); }
    })()`)) || '{"error":"nothing came back"}'
  );

// ---- the whole strip, unchanged -------------------------------------------
check('the whole-board button is on the desktop', (await clickText('העתק כתמונה')) === 'clicked');
await wait(1500);
const whole = await grab();
check('the whole board is on the clipboard', !whole.error, whole.error ?? `${whole.w}x${whole.h}`);
check(
  'and it is still the whole strip, taller than a page',
  !whole.error && whole.h > whole.w * PAGE + 1,
  `${whole.h}px tall; a page would be ${Math.round(whole.w * PAGE)}`
);

// ---- the parts -------------------------------------------------------------
const first = await label();
check('the part button appears once the strip is long', first !== null, `label "${first}"`);
const parts = Number(String(first).split('/')[1] || 0);
check('it says how many parts there are', parts >= 2, `${parts} parts`);

// Every part is one page, so the count follows from the height alone. Restated from
// ink.ts rather than imported, like `PAGE` in scrolltest.
const step = (PART - PART_OVERLAP) * W;
const want = whole.h <= PART * W + 1 ? 1 : Math.ceil((whole.h - PART * W) / step) + 1;
check('the count covers the strip', parts === want, `${parts}, expected ${want}`);

// Start the walk at part one, explicitly. The picker no longer holds a count of its own
// that begins at zero — it reports which part the BOARD is on, and the board is still
// where the writing left it, at the bottom of the strip. Showing the last part there is
// correct, so this is the test arriving at the first part rather than assuming it.
check('the walk can start at part one', (await choose(0)) === 'set');
await wait(600);

const shots = [];
for (let i = 1; i <= parts; i++) {
  const at = await label();
  check(`part ${i}: the button points at it`, at === `${i}/${parts}`, `says "${at}"`);
  await clickText('העתק חלק');
  await wait(1400);
  const g = await grab();
  shots.push(g);
  check(
    `part ${i}: two pages on the clipboard`,
    !g.error && g.w === W && g.h === Math.round(PART * W),
    g.error ?? `${g.w}x${g.h}`
  );
  check(`part ${i}: it is not blank`, !g.error && g.ink > 200, `${g.ink ?? '-'} ink pixels`);
}

check(
  'the parts are different images',
  new Set(shots.map((s) => s.sig)).size === parts,
  `${new Set(shots.map((s) => s.sig)).size} distinct of ${parts}`
);
// Both ends pinned, and they are pinned differently on purpose. Part one starts at the
// very top, so it is rendered at exactly the same offset as the whole export and its top
// 60 rows are the SAME pixels — that one is exact. The last part is rendered at a
// fractional offset, so its bottom rows are the same ink re-antialiased; a few percent of
// drift there is the renderer, not a missing part.
check(
  'part one starts where the whole export starts',
  whole.head > 200 && Math.abs(shots[0].head - whole.head) <= 2,
  `top band: part ${shots[0].head} vs whole ${whole.head}`
);
check(
  'the last part ends where the whole export ends',
  whole.band > 0 && Math.abs(shots[parts - 1].band - whole.band) <= Math.max(20, whole.band * 0.15),
  `bottom band: part ${shots[parts - 1].band} vs whole ${whole.band}`
);
// Avi (20.09.2026): "אני בוחר בחלק האחרון ואז אני מעתיק את החלק הזה הקנבס גולל פתאום
// לטופ". The counter used to wrap here, which was free while it was only a number — but
// the picker moves the BOARD now, and wrapping threw the reader to the top of the strip
// exactly when they copied the end of their working. The walk stops at the end.
check('the walk stops at the last part', (await label()) === `${parts}/${parts}`, await label());
// The label alone would not have caught what Avi saw: it is the BOARD that was thrown to
// the top, and a picker reading 1/N is only the symptom of it. 0% is the top of the strip.
check('and the board did not jump to the top', (await at()) > 0, `rail at ${await at()}%`);

// Jumping, which is the reason the counter is a picker: Avi's own board is 18 parts, and
// stepping to the one he wants would be seventeen presses.
check('you can jump straight to a part', (await choose(parts - 1)) === 'set');
check('and the picker went there', (await label()) === `${parts}/${parts}`, await label());
await clickText('העתק חלק');
await wait(1400);
const jumped = await grab();
check(
  'copying after a jump copies THAT part',
  !jumped.error && jumped.sig === shots[parts - 1].sig,
  jumped.error ?? `sig ${jumped.sig} vs ${shots[parts - 1].sig}`
);

// Avi (19.09.2026): "בחרתי אופציה אחרת ואז גללתי ואז ב-select שוב בחרתי, זה צריך לגלול
// לנקודה ההיא שוב פעם. כרגע זה לא גולל". Picking the part that is already picked fires no
// `change`, so the board has to be moved by the act of opening the picker.
await choose(parts - 1);
await wait(400);
const parked = await at();
const parkedLabel = await label();
await wheelUp();
await wait(500);
const wandered = await at();
check('scrolling moves the board off the part', wandered < parked - 1, `${parked}% -> ${wandered}%`);
// Avi (19.09.2026): "כשאני גולל בקנבס בדסקטופ, ה‑select של החלק הנוכחי להעתיק כתמונה
// צריך להתעדכן בהתאם". The picker is not a counter the toolbar keeps; it says which part
// is on the screen. Scroll off the part and it has to say so, or "העתק חלק" copies
// something other than what is being looked at.
const wanderedLabel = await label();
check(
  'and the picker goes with it',
  wanderedLabel !== parkedLabel,
  `${parkedLabel} -> ${wanderedLabel}`
);
// Opening the list is not choosing, and must not move anything by itself.
check('opening the picker alone moves nothing', (await openPicker()) === 'opened');
await wait(500);
check('and the board stayed where it was', (await at()) === wandered, `${await at()}% vs ${wandered}%`);
await escape();
await wait(300);
check('re-picking the same option', (await repick(parts - 1)) === 'repicked');
await wait(500);
const back = await at();
check(
  'picking the SAME part brings it back',
  Math.abs(back - parked) <= 1,
  `${wandered}% -> ${back}%, wanted ${parked}%`
);
// The round trip closes: the board went to the part's own top, and reading that position
// back through the same map lands on the part that was picked. If those were two maps
// instead of one, this is where they would disagree.
check(
  'and the picker reads that part back',
  (await label()) === parkedLabel,
  `${await label()}, wanted ${parkedLabel}`
);

// leave nothing behind in the database
await ev(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'נקה')?.click()`);
for (let i = 0; i < 20 && !(await ev(`!!document.querySelector('dialog.ask[open]')`)); i++) await wait(100);
await ev(`document.querySelector('dialog.ask[open] [data-ask="ok"]')?.click()`);
await wait(1500);
check('a cleared board has nothing to split', (await label()) === null, String(await label()));

console.log(bad ? `\n${bad} FAILED` : '\nthe long board copies in pages');
ws.close();
process.exit(bad ? 1 : 0);
