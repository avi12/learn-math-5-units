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
import { catchFromPage, PadMessage } from './lib/extension.mjs';

const [, , url, port, shots] = process.argv;
if (!url || !port) {
  console.error('usage: node questioncheck.mjs <url> <debug-port> [shots-dir]');
  process.exit(2);
}
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = ({ method, params = {} }) =>
  new Promise((r, j) => {
    const i = ++id;
    pending.set(i, r);
    setTimeout(() => j(new Error('CDP timeout: ' + method)), 30000);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result ?? m.error);
    pending.delete(m.id);
  }
};
await new Promise((r) => (ws.onopen = r));
await send({ method: 'Page.enable' });
await send({ method: 'Runtime.enable' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (x) => {
  const r = await send({ method: 'Runtime.evaluate', params: { expression: x, returnByValue: true, awaitPromise: true } });
  return r?.exceptionDetails ? 'EXC ' + r.exceptionDetails.text : r.result?.value;
};
let bad = 0;
const check = ({ name, ok, detail = '' }) => {
  if (!ok) {bad++;}
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(56)} ${detail}`);
};

/** Set a select the way a person does: value, then the event Svelte listens to. */
const setSelect = ({ nth, value }) =>
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
await send({ method: 'Emulation.setDeviceMetricsOverride', params: { width: 1180, height: 1000, deviceScaleFactor: 1, mobile: false } });

// The sideways scan clicks through every exercise, and every pick is written to the room.
// Hundreds of writes in seconds are still queued when the page reloads as the tablet, so
// the room ends on a stale pick. The scans therefore run in rooms of their own.
await send({ method: 'Page.navigate', params: { url: roomUrl({ url, room: freshRoom() }) } });
await wait(7000);
const sd = await sideways();
check({ name: 'desktop: no exercise scrolls sideways', ok: sd.bad.length === 0 && sd.seen >= 94,
  detail: `${sd.seen} exercises${sd.bad.length ? ' — ' + sd.bad.slice(0, 4).join('; ') : ''}` });

await send({ method: 'Page.navigate', params: { url: roomUrl({ url, room: freshRoom() }) } });
await wait(7000);
const vd = await videos();
check({ name: 'desktop: every exercise names how-to-solve videos', ok: vd.seen >= 94 && vd.empty.length === 0,
  detail: `${vd.seen} exercises, ${vd.links} links${vd.empty.length ? ' — none on ' + vd.empty.slice(0, 4).join(', ') : ''}` });
check({ name: 'each link is a real watch URL, with title, channel and length',
  ok: vd.strange.length === 0, detail: vd.strange.slice(0, 3).join('; ') });
check({ name: 'the links follow the question, not the chapter', ok: vd.distinct >= 80, detail: `${vd.distinct} distinct sets` });
check({ name: 'and none of them widens the page', ok: vd.wide.length === 0, detail: vd.wide.slice(0, 3).join('; ') });

await send({ method: 'Page.navigate', params: { url: roomUrl({ url, room }) } });
await wait(7000);

// ---- the desktop -------------------------------------------------------------
const c0 = await card();
check({ name: 'one question card', ok: c0.cards === 1, detail: `${c0.cards}` });
check({ name: 'it shows a question', ok: (c0.text ?? '').length > 10, detail: (c0.text ?? '').slice(0, 40) });

const chapters = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('.question .topic select')[0].options].map((o) => o.value))`));
check({ name: 'the workbook’s ten chapters, and nothing else', ok: chapters.length === 10 && chapters.every((c) => /^\d\d$/.test(c)), detail: chapters.join(',') });

// block 07 carries its workbook exercises, addressed by rung and number, and nothing else
check({ name: 'choose chapter 07', ok: (await setSelect({ nth: 0, value: '07' })) === 'ok' });
await wait(400);
const rows07 = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('.question .topic select')[1].options].map((o) => o.value))`));
check({ name: 'chapter 07 holds its workbook exercises', ok: rows07.includes('07:3.1') && rows07.length === 10, detail: `${rows07.length} rows` });
check({ name: 'and no exercise written from an exam question', ok: rows07.every((v) => /^07:(\d\.\d+)?$/.test(v)), detail: rows07.join(',') });
const c1 = await card();
check({ name: 'changing the chapter moves the pick into it', ok: c1.pick?.startsWith('07:'), detail: c1.pick });

// a bagrut-level one, with sections
const target = '07:3.2';
check({ name: 'choose a bagrut-level exercise', ok: (await setSelect({ nth: 1, value: target })) === 'ok', detail: target });
await wait(500);
const c2 = await card();
check({ name: 'the card shows that question', ok: c2.meta?.includes('מדרגה 3') && c2.text !== c1.text, detail: c2.meta });
check({ name: 'and does not name an exam paper', ok: !/שאלון|בהשראת/.test(`${c2.meta} ${c2.text}`) });
check({ name: 'its maths is rendered, not raw TeX', ok: c2.maths > 0 && !c2.rawTex, detail: `${c2.maths} formulas` });
if (shots) {
  const png = await send({ method: 'Page.captureScreenshot', params: { format: 'png' } });
  writeFileSync(`${shots}/q-board.png`, Buffer.from(png.data, 'base64'));
}

// next / previous
const before = (await card()).pick;
await ev(`[...document.querySelectorAll('.question .steps .btn')][1].click()`);
await wait(300);
const after = (await card()).pick;
check({ name: 'next moves to another exercise', ok: after && after !== before, detail: `${before} -> ${after}` });
await ev(`[...document.querySelectorAll('.question .steps .btn')][0].click()`);
await wait(300);
check({ name: 'previous comes back', ok: (await card()).pick === before, detail: (await card()).pick });


// the finish button marks against the question's own criteria
await setSelect({ nth: 0, value: '07' });
await wait(300);
await setSelect({ nth: 1, value: target });
await wait(300);
await ev(`(() => {
  document.documentElement.dataset.aviMathCheck = 'ready';
  return 1;
})()`);
await ev(catchFromPage(PadMessage.CHECK));
const btn = `[...document.querySelectorAll('.question button')].find((b) => b.textContent.includes('שקלוד יבדוק'))`;
check({ name: 'the finish button is in the card on the desktop', ok: (await ev(`!!${btn}`)) === true });
await ev(`${btn}.click(), 1`);
for (let i = 0; i < 40 && !(await ev(`!!window.__caught`)); i++) {await wait(250);}
const prompt = String(await ev(`window.__caught?.prompt ?? ''`));
check({ name: 'a prompt went out', ok: prompt.length > 500, detail: `${prompt.length} chars` });
check({ name: 'no slot left unfilled', ok: !/\{\{[A-Z]+\}\}/.test(prompt) });
check({ name: 'it names the exercise', ok: prompt.includes('מדרגה 3') && prompt.includes('תרגיל 2') });
check({ name: "it carries chapter 07's criteria", ok: prompt.includes('ההשוואה לאפס של המונה בלבד מנומקת') });

// A device still on an exercise that was removed (an exam-question one, 17.09.2026) opens
// on its chapter's first exercise — not on "not from the workbook", which would send Claude
// to mark a question nobody chose. In a room of its own, so the tablet below is unaffected.
await ev(`localStorage.setItem('avi-math-pick', '07:35571_2022_1_q6.bagrut'), 1`);
await send({ method: 'Page.navigate', params: { url: roomUrl({ url, room: freshRoom() }) } });
await wait(7000);
const c3 = await card();
check({ name: 'a removed exercise gives way to its chapter’s first', ok: c3.pick === '07:1.1' && c3.maths > 0, detail: c3.pick });

// ---- the tablet ----------------------------------------------------------------
await asTablet(send);
await send({ method: 'Emulation.setDeviceMetricsOverride', params: { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false } });
await send({ method: 'Page.navigate', params: { url: roomUrl({ url, room }) } });
await wait(7000);
const t0 = await card();
check({ name: 'the tablet shows the card too', ok: t0.cards === 1 && (t0.text ?? '').length > 10 });
check({ name: 'on the same question the desktop chose', ok: t0.pick === target, detail: t0.pick });
check({ name: 'no finish button on the tablet', ok: (await ev(`!!${btn}`)) === false });
// "אבל רק בדסקטופ" — and the tablet's card is folded to 17svh, so a link row there would
// be taking the board's pixels for something you would not follow mid-stroke anyway.
check({ name: 'no video links on the tablet',
  ok: (await ev(`document.querySelectorAll('.question .qvids a').length`)) === 0 });
const board = JSON.parse(await ev(`JSON.stringify(document.querySelector('canvas').getBoundingClientRect())`));
check({ name: 'the board still gets most of the screen', ok: board.height > 800 * 0.4, detail: `${Math.round(board.height)}px of 800` });
if (shots) {
  const png = await send({ method: 'Page.captureScreenshot', params: { format: 'png' } });
  writeFileSync(`${shots}/q-pad.png`, Buffer.from(png.data, 'base64'));
}
// the longest chapter name; the closed control stays one line
check({ name: 'choose chapter 01 on the tablet', ok: (await setSelect({ nth: 0, value: '01' })) === 'ok' });
await wait(600);
const board01 = JSON.parse(await ev(`JSON.stringify(document.querySelector('canvas').getBoundingClientRect())`));
const selH = await ev(`Math.round(document.querySelectorAll('.question .topic select')[0].getBoundingClientRect().height)`);
check({ name: 'its name stays on one line', ok: selH < 50, detail: `${selH}px tall` });
check({ name: 'and the board keeps its room', ok: board01.height > 800 * 0.4, detail: `${Math.round(board01.height)}px of 800` });

await send({ method: 'Page.navigate', params: { url: roomUrl({ url, room: freshRoom() }) } });
await wait(7000);
const st = await sideways();
check({ name: 'tablet: no exercise scrolls sideways', ok: st.bad.length === 0 && st.seen >= 94,
  detail: `${st.seen} exercises${st.bad.length ? ' — ' + st.bad.slice(0, 4).join('; ') : ''}` });

console.log(bad ? `\n${bad} FAILED` : '\none question at a time, on both devices');
ws.close();
process.exit(bad ? 1 : 0);
