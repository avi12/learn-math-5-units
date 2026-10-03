/** One question at a time, on the screen. `node questioncheck.mjs <url> <debug-port> [shots-dir]`
 *
 * Avi (17.09.2026): "כל פעם רק שאלה אחת מופיעה ואני בוחר מה היא, כך שגם השאלה מוצגת לי,
 * וכשסיימתי לפתור אני יכול ללחוץ על כפתור הסיום כדי לשלוח פרומפט לקלוד".
 *
 * What is asserted is what he asked for, on both devices:
 *   - the card is there and shows exactly one question, rendered (MathML, not raw TeX);
 *   - choosing a chapter and an exercise changes the question on the card;
 *   - the chapters carry the workbook's exercises and nothing written from an exam question
 *     (Avi removed those on 17.09.2026: "תמחק כל שאלה שהיא שייכת לשאלון");
 *   - next/previous step through them;
 *   - the finish button marks against the chapter's criteria.
 * With a third argument it also saves a screenshot of each role, for looking at.
 */
import { writeFileSync } from 'node:fs';
import { asTablet, roomUrl, freshRoom } from './lib/pad.mjs';

const [, , url, port, shots] = process.argv;
if (!url || !port) {
  console.error('usage: node questioncheck.mjs <url> <debug-port> [shots-dir]');
  process.exit(2);
}
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (m, p = {}) =>
  new Promise((r, j) => {
    const i = ++id;
    pending.set(i, r);
    setTimeout(() => j(new Error('CDP timeout: ' + m)), 30000);
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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
  return r?.exceptionDetails ? 'EXC ' + r.exceptionDetails.text : r.result?.value;
};
let bad = 0;
const check = (name, ok, detail = '') => {
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(56)} ${detail}`);
};

/** Set a select the way a person does: value, then the event Svelte listens to. */
const setSelect = (nth, value) =>
  ev(`(() => {
    const s = document.querySelectorAll('.question .topic select')[${nth}];
    if (!s) return 'no select';
    if (![...s.options].some((o) => o.value === ${JSON.stringify(value)})) return 'no such option';
    s.value = ${JSON.stringify(value)};
    s.dispatchEvent(new Event('change', { bubbles: true }));
    return 'ok';
  })()`);
const card = () =>
  ev(`JSON.stringify({
    meta: document.querySelector('.question .qmeta')?.textContent.trim() ?? null,
    text: document.querySelector('.question .qtext')?.textContent.trim() ?? null,
    maths: document.querySelectorAll('.question .qtext math').length,
    rawTex: /\\$[^$]+\\$/.test(document.querySelector('.question .qtext')?.textContent ?? ''),
    cards: document.querySelectorAll('.question').length,
    chapter: document.querySelectorAll('.question .topic select')[0]?.value,
    pick: document.querySelectorAll('.question .topic select')[1]?.value
  })`).then(JSON.parse);

/** Nothing scrolls sideways, on EVERY exercise in every chapter. Avi, on a short root:
 *  "לא טוב שיש גלילה אופקית". Two ways it can happen, both measured: a box that can scroll
 *  and is wider inside than out, and a formula run that pokes past the question's edge
 *  (which is what an `overflow-x: hidden` would otherwise cut off silently). */
const sideways = () =>
  ev(`(async () => {
    const [chapter] = document.querySelectorAll('.question .topic select');
    const bad = [];
    let seen = 0;
    for (const c of [...chapter.options].map((o) => o.value)) {
      chapter.value = c;
      chapter.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 30));
      const ex = document.querySelectorAll('.question .topic select')[1];
      for (const v of [...ex.options].map((o) => o.value)) {
        ex.value = v;
        ex.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const q = document.querySelector('.question .qtext');
        if (!q) continue;
        seen++;
        const box = q.getBoundingClientRect();
        const scrollers = [q, ...q.querySelectorAll('*')].filter((el) => {
          const o = getComputedStyle(el).overflowX;
          return (o === 'auto' || o === 'scroll') && el.scrollWidth > el.clientWidth + 1;
        });
        const poking = [...q.querySelectorAll('math')].filter((b) => {
          const r = b.getBoundingClientRect();
          return r.left < box.left - 2 || r.right > box.right + 2;
        });
        if (scrollers.length || poking.length)
          bad.push(v + (scrollers.length ? ' scrolls' : '') + (poking.length ? ' pokes out ' +
            Math.round(Math.max(...poking.map((b) => b.getBoundingClientRect().width))) + 'px' : ''));
      }
    }
    return JSON.stringify({ seen, bad });
  })()`).then(JSON.parse);

/** Every exercise names videos that explain how to solve IT, and nothing is invented.
 *  Avi: "בעבור כל שאלה תוסיף קישורים לסרטונים רלוונטיים שמסבירים איך לפתור". Walked the
 *  same way as the sideways scan — every exercise of every chapter — because "for every
 *  question" is a claim about all 94 of them, not about the one that happens to be open.
 *  The page width is measured on each: a sixty-character title is exactly the thing that
 *  would push the card sideways. */
const videos = () =>
  ev(`(async () => {
    const [chapter] = document.querySelectorAll('.question .topic select');
    const empty = [], strange = [], wide = [];
    let seen = 0, links = 0;
    const sets = new Map();
    for (const c of [...chapter.options].map((o) => o.value)) {
      chapter.value = c;
      chapter.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 30));
      const ex = document.querySelectorAll('.question .topic select')[1];
      for (const v of [...ex.options].map((o) => o.value)) {
        ex.value = v;
        ex.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        if (v.endsWith(':')) continue;               // "not from the workbook" has none
        seen++;
        const rows = [...document.querySelectorAll('.question .qvids a')];
        if (!rows.length) { empty.push(v); continue; }
        links += rows.length;
        sets.set(v, rows.map((a) => a.getAttribute('href')).join(' '));
        for (const a of rows) {
          const href = a.getAttribute('href') ?? '';
          const title = a.querySelector('.vtitle')?.textContent?.trim() ?? '';
          const who = a.querySelector('.vwho')?.textContent?.trim() ?? '';
          if (!/^https:\\/\\/www\\.youtube\\.com\\/watch\\?v=[\\w-]{11}$/.test(href) ||
              title.length < 8 || who.length < 4 || !/\\d:\\d\\d/.test(who))
            strange.push(v + ' ' + href + ' ' + title.slice(0, 20));
          if (a.target !== '_blank') strange.push(v + ' opens in place');
        }
        const el = document.scrollingElement;
        if (el.scrollWidth > el.clientWidth + 1) wide.push(v + ' ' + (el.scrollWidth - el.clientWidth) + 'px');
      }
    }
    return JSON.stringify({ seen, links, empty, strange, wide,
      distinct: new Set(sets.values()).size });
  })()`).then(JSON.parse);

const room = freshRoom();
await send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 1000, deviceScaleFactor: 1, mobile: false });

// The sideways scan clicks through every exercise, and every pick is written to the room.
// Hundreds of writes in seconds are still queued when the page reloads as the tablet, so
// the room ends on a stale pick. The scans therefore run in rooms of their own.
await send('Page.navigate', { url: roomUrl(url, freshRoom()) });
await wait(7000);
const sd = await sideways();
check('desktop: no exercise scrolls sideways', sd.bad.length === 0 && sd.seen >= 94,
  `${sd.seen} exercises${sd.bad.length ? ' — ' + sd.bad.slice(0, 4).join('; ') : ''}`);

await send('Page.navigate', { url: roomUrl(url, freshRoom()) });
await wait(7000);
const vd = await videos();
check('desktop: every exercise names how-to-solve videos', vd.seen >= 94 && vd.empty.length === 0,
  `${vd.seen} exercises, ${vd.links} links${vd.empty.length ? ' — none on ' + vd.empty.slice(0, 4).join(', ') : ''}`);
check('each link is a real watch URL, with title, channel and length',
  vd.strange.length === 0, vd.strange.slice(0, 3).join('; '));
check('the links follow the question, not the chapter', vd.distinct >= 80, `${vd.distinct} distinct sets`);
check('and none of them widens the page', vd.wide.length === 0, vd.wide.slice(0, 3).join('; '));

await send('Page.navigate', { url: roomUrl(url, room) });
await wait(7000);

// ---- the desktop -------------------------------------------------------------
const c0 = await card();
check('one question card', c0.cards === 1, `${c0.cards}`);
check('it shows a question', (c0.text ?? '').length > 10, (c0.text ?? '').slice(0, 40));

const chapters = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('.question .topic select')[0].options].map((o) => o.value))`));
check('the workbook’s ten chapters, and nothing else', chapters.length === 10 && chapters.every((c) => /^\d\d$/.test(c)), chapters.join(','));

// block 07 carries its workbook exercises, addressed by rung and number, and nothing else
check('choose chapter 07', (await setSelect(0, '07')) === 'ok');
await wait(400);
const rows07 = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('.question .topic select')[1].options].map((o) => o.value))`));
check('chapter 07 holds its workbook exercises', rows07.includes('07:3.1') && rows07.length === 10, `${rows07.length} rows`);
check('and no exercise written from an exam question', rows07.every((v) => /^07:(\d\.\d+)?$/.test(v)), rows07.join(','));
const c1 = await card();
check('changing the chapter moves the pick into it', c1.pick?.startsWith('07:'), c1.pick);

// a bagrut-level one, with sections
const target = '07:3.2';
check('choose a bagrut-level exercise', (await setSelect(1, target)) === 'ok', target);
await wait(500);
const c2 = await card();
check('the card shows that question', c2.meta?.includes('מדרגה 3') && c2.text !== c1.text, c2.meta);
check('and does not name an exam paper', !/שאלון|בהשראת/.test(`${c2.meta} ${c2.text}`));
check('its maths is rendered, not raw TeX', c2.maths > 0 && !c2.rawTex, `${c2.maths} formulas`);
if (shots) {
  const png = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${shots}/q-board.png`, Buffer.from(png.data, 'base64'));
}

// next / previous
const before = (await card()).pick;
await ev(`[...document.querySelectorAll('.question .steps .btn')][1].click()`);
await wait(300);
const after = (await card()).pick;
check('next moves to another exercise', after && after !== before, `${before} -> ${after}`);
await ev(`[...document.querySelectorAll('.question .steps .btn')][0].click()`);
await wait(300);
check('previous comes back', (await card()).pick === before, (await card()).pick);


// the finish button marks against the question's own criteria
await setSelect(0, '07');
await wait(300);
await setSelect(1, target);
await wait(300);
await ev(`(() => {
  document.documentElement.dataset.aviMathCheck = 'ready';
  window.__caught = null;
  window.addEventListener('message', (e) => {
    if (e.source === window && e.data && e.data.type === 'avi-math-check@1') window.__caught = e.data;
  });
  return 1;
})()`);
const btn = `[...document.querySelectorAll('.question button')].find((b) => b.textContent.includes('שקלוד יבדוק'))`;
check('the finish button is in the card on the desktop', (await ev(`!!${btn}`)) === true);
await ev(`${btn}.click(), 1`);
for (let i = 0; i < 40 && !(await ev(`!!window.__caught`)); i++) await wait(250);
const prompt = String(await ev(`window.__caught?.prompt ?? ''`));
check('a prompt went out', prompt.length > 500, `${prompt.length} chars`);
check('no slot left unfilled', !/\{\{[A-Z]+\}\}/.test(prompt));
check('it names the exercise', prompt.includes('מדרגה 3') && prompt.includes('תרגיל 2'));
check("it carries chapter 07's criteria", prompt.includes('ההשוואה לאפס של המונה בלבד מנומקת'));

// A device still on an exercise that was removed (an exam-question one, 17.09.2026) opens
// on its chapter's first exercise — not on "not from the workbook", which would send Claude
// to mark a question nobody chose. In a room of its own, so the tablet below is unaffected.
await ev(`localStorage.setItem('avi-math-pick', '07:35571_2022_1_q6.bagrut'), 1`);
await send('Page.navigate', { url: roomUrl(url, freshRoom()) });
await wait(7000);
const c3 = await card();
check('a removed exercise gives way to its chapter’s first', c3.pick === '07:1.1' && c3.maths > 0, c3.pick);

// ---- the tablet ----------------------------------------------------------------
await asTablet(send);
await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: roomUrl(url, room) });
await wait(7000);
const t0 = await card();
check('the tablet shows the card too', t0.cards === 1 && (t0.text ?? '').length > 10);
check('on the same question the desktop chose', t0.pick === target, t0.pick);
check('no finish button on the tablet', (await ev(`!!${btn}`)) === false);
// "אבל רק בדסקטופ" — and the tablet's card is folded to 17svh, so a link row there would
// be taking the board's pixels for something you would not follow mid-stroke anyway.
check('no video links on the tablet',
  (await ev(`document.querySelectorAll('.question .qvids a').length`)) === 0);
const board = JSON.parse(await ev(`JSON.stringify(document.querySelector('canvas').getBoundingClientRect())`));
check('the board still gets most of the screen', board.height > 800 * 0.4, `${Math.round(board.height)}px of 800`);
if (shots) {
  const png = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${shots}/q-pad.png`, Buffer.from(png.data, 'base64'));
}
// the longest chapter name; the closed control stays one line
check('choose chapter 01 on the tablet', (await setSelect(0, '01')) === 'ok');
await wait(600);
const board01 = JSON.parse(await ev(`JSON.stringify(document.querySelector('canvas').getBoundingClientRect())`));
const selH = await ev(`Math.round(document.querySelectorAll('.question .topic select')[0].getBoundingClientRect().height)`);
check('its name stays on one line', selH < 50, `${selH}px tall`);
check('and the board keeps its room', board01.height > 800 * 0.4, `${Math.round(board01.height)}px of 800`);

await send('Page.navigate', { url: roomUrl(url, freshRoom()) });
await wait(7000);
const st = await sideways();
check('tablet: no exercise scrolls sideways', st.bad.length === 0 && st.seen >= 94,
  `${st.seen} exercises${st.bad.length ? ' — ' + st.bad.slice(0, 4).join('; ') : ''}`);

console.log(bad ? `\n${bad} FAILED` : '\none question at a time, on both devices');
ws.close();
process.exit(bad ? 1 : 0);
