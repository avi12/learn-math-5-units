/** The check button, on both paths. `node checktest.mjs <url> <debug-port>`
 *
 * The extension cannot be loaded into a headless Chrome that is already running, so its
 * presence is faked the way it really announces itself — the stamp on <html> and a
 * listener on window.message — and what is verified is the page's half of the contract:
 *
 *   1. with an extension: the exact payload is posted, with a real PNG and the prompt
 *      for the TOPIC THAT IS SELECTED, not for whichever block happens to be first;
 *   2. without one: nothing is posted and the same prompt reaches the clipboard, so the
 *      button still does the whole job on a machine that has no extension.
 *
 * The criteria themselves are checked by identity, not by eyeballing: the prompt that
 * goes out has to contain the marking criteria the workbook wrote for that block.
 */
import { asTablet, assertPad } from './lib/pad.mjs';
const [, , url, port] = process.argv;
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (m, p = {}) =>
  new Promise((r, j) => {
    const i = ++id;
    pending.set(i, r);
    setTimeout(() => j(new Error('CDP timeout: ' + m)), 25000);
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
await send('Browser.grantPermissions', {
  origin: new URL(url).origin,
  permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite']
}).catch(() => {});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
  return r?.exceptionDetails ? 'EXC ' + r.exceptionDetails.text : r.result?.value;
};

let bad = 0;
const check = (name, ok, detail = '') => {
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(50)} ${detail}`);
};

await send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 900, deviceScaleFactor: 1, mobile: false });
await asTablet(send);
await send('Page.navigate', { url });
await wait(7000);
await assertPad(ev);

// ---- the control itself -----------------------------------------------------
// Since 17.09.2026 the picker is two controls over one value — the chapter, then the
// exercise inside it — on the question card, because the list now also holds every
// exercise written from an exam question (questioncheck.mjs tests that half). Inside a
// chapter it still mirrors the workbook: a group per rung, the rung's own pips, and the
// chapter's way out at the end.
check('the picker is on the pad', (await ev(`document.querySelectorAll('.question .topic select').length >= 2`)) === true);
const shape = JSON.parse(
  await ev(`(() => {
    const [chapter, s] = document.querySelectorAll('.question .topic select');
    const groups = [...s.querySelectorAll('optgroup')];
    return JSON.stringify({
      chapters: chapter.options.length,
      chapter: chapter.value,
      groups: groups.length,
      rungHeads: s.querySelectorAll('optgroup legend .grung').length,
      pipsOn: [...s.querySelectorAll('optgroup legend .pips')].map(
        (p) => p.querySelectorAll('i.on').length
      ),
      wayOut: [...s.options].filter((o) => o.value.endsWith(':')).length,
      lastIsWayOut: s.options[s.options.length - 1]?.value.endsWith(':'),
      firstRow: s.options[0]?.textContent?.trim() ?? ''
    });
  })()`)
);
check('the workbook’s ten chapters, and nothing else', shape.chapters === 10, `${shape.chapters} chapters`);
check('a group per rung inside the chapter', shape.groups === 3, `${shape.groups} groups in ${shape.chapter}`);
check('every rung says which rung it is', shape.rungHeads === 3, `${shape.rungHeads} rung headings`);
// the workbook marks the rungs with 1, 2 and 3 lit pips; the picker has to agree
check('the pips count up with the rung, as in the workbook',
  JSON.stringify(shape.pipsOn) === '[1,2,3]', shape.pipsOn.join(','));
check('one way out, at the end of the chapter', shape.wayOut === 1 && shape.lastIsWayOut === true);
check('a row says which exercise it is', /^תרגיל \d+$/.test(shape.firstRow), shape.firstRow);

const btn = `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('שקלוד יבדוק'))`;
// Desktop only, and that is the point of the button: it hands the drawing to a
// conversation through a Chrome extension, and the Android wrapper has no extension to
// hand it to. Asserted here on the pad so the gate is tested and not just relied on.
check('the finish button is NOT on the tablet', (await ev(`!!${btn}`)) === false);

// draw something, so the board is not blank
const rect = JSON.parse(await ev('JSON.stringify(document.querySelector("canvas").getBoundingClientRect())'));
const y = rect.top + rect.height * 0.4;
const x0 = rect.left + rect.width * 0.2;
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y, button: 'left', buttons: 1, clickCount: 1 });
for (let i = 1; i <= 12; i++) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0 + i * 26, y: y + Math.sin(i) * 10, button: 'left', buttons: 1 });
}
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x0 + 312, y, button: 'left', buttons: 0, clickCount: 1 });
await wait(2500);

// Now do what the person does: written on the tablet, finish on the desktop. The role
// buttons flip in place, so the room and everything drawn in it carry across — which is
// also why the drawing had to happen first. The board is read-only.
await ev(
  `[...document.querySelectorAll('.roles .btn')].find((b) => b.textContent.trim() === 'תצוגה')?.click()`
);
await wait(1200);
check('and it IS on the desktop', (await ev(`!!${btn}`)) === true);

// ---- 1: with an extension listening -----------------------------------------
// A block that is NOT the default and an exercise inside it, so a payload built from the
// wrong one is caught. One value carries both now — `block:tier.n` — which is the point
// of merging the two pickers: there is no state in which they disagree.
const picked = await ev(`(() => {
  const [chapter] = document.querySelectorAll('.question .topic select');
  chapter.value = '07';
  chapter.dispatchEvent(new Event('change', { bubbles: true }));
  return new Promise((r) => setTimeout(() => {
    const s = document.querySelectorAll('.question .topic select')[1];
    s.value = '07:3.1';
    s.dispatchEvent(new Event('change', { bubbles: true }));
    r(s.value);
  }, 300));
})()`);
check('a block and an exercise can be picked at once', picked === '07:3.1', String(picked));
await wait(500);

await ev(`(() => {
  document.documentElement.dataset.aviMathCheck = 'ready';
  window.__caught = null;
  window.addEventListener('message', (e) => {
    if (e.source === window && e.data && e.data.type === 'avi-math-check@1') window.__caught = e.data;
  });
  return 1;
})()`);
await ev(`${btn}.click(), 1`);
for (let i = 0; i < 40 && !(await ev(`!!window.__caught`)); i++) await wait(250);

const got = await ev(`(() => {
  const c = window.__caught;
  if (!c) return null;
  return { topic: c.topic, png: c.image.startsWith('data:image/png;base64,'), bytes: c.image.length, prompt: c.prompt };
})()`);
check('a payload is posted for the extension', !!got);
check('it carries a real PNG', got?.png === true, `${Math.round((got?.bytes ?? 0) / 1024)} kb data URL`);
check('the label carries the block and the exercise',
  got?.topic?.includes('נגזרת') && got?.topic?.includes('תרגיל 1'),
  JSON.stringify(got?.topic));
// the criteria the workbook wrote for block 07, verbatim
check(
  "the prompt carries that block's own criteria",
  String(got?.prompt).includes('ההשוואה לאפס של המונה בלבד מנומקת'),
  String(got?.prompt).length + ' chars'
);
check('and it does not still ask for pasted text', !String(got?.prompt).includes('כאן מדביקים'));

// Naming the exercise is the other half of "check me against the right thing". The
// slot is filled at click time, so an unfilled one would ship the literal token to
// Claude — worse than the topic-only prompt it replaced, because it reads as a bug.
const prompt = String(got?.prompt ?? '');
check(
  'the exercise slot was filled in',
  !prompt.includes('{{EXERCISE}}'),
  prompt.includes('{{EXERCISE}}') ? 'the raw token went out' : ''
);
const named = prompt.split('\n').find((l) => l.startsWith('התרגיל')) ?? '';
check('and the prompt says which exercise it is', named.length > 0, named.slice(0, 58));

// ---- 2: with no extension ---------------------------------------------------
await ev(`(() => {
  delete document.documentElement.dataset.aviMathCheck;
  window.__caught = null;
  return 1;
})()`);
await ev(`${btn}.click(), 1`);
await wait(2500);
check('nothing is posted when no extension is present', (await ev(`!!window.__caught`)) === false);
const clip = await ev(`navigator.clipboard.readText().catch(() => '')`);
check(
  'the prompt reaches the clipboard instead',
  String(clip).includes('בוחן בגרות') || String(clip).includes('35571'),
  String(clip).slice(0, 40).replace(/\n/g, ' ')
);

console.log(bad ? `\n${bad} FAILED` : '\nall checks passed');
ws.close();
process.exit(bad ? 1 : 0);
