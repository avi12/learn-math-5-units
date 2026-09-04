/** Two equations on the board must come back as two rows of LaTeX.
 *
 *   node multiline.mjs <url> <debug-port>
 *
 * Checks three things, cheapest first:
 *   1. MathLive accepts the `aligned` block the recogniser joins lines with, and hands
 *      it back unchanged — if it silently rewrites or drops it, the join is wrong;
 *   2. two separated scribbles come back as a two-row aligned block;
 *   3. the status counted the lines while it worked, which is what proves the split
 *      reached the model rather than the join inventing rows.
 */
const [, , url, port] = process.argv;

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (m, p = {}) =>
  new Promise((r) => {
    const i = ++id;
    pending.set(i, r);
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
await send('Emulation.setDeviceMetricsOverride', { width: 1150, height: 1400, deviceScaleFactor: 1 });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (x) => {
  const r = await send('Runtime.evaluate', {
    expression: x,
    returnByValue: true,
    awaitPromise: true
  });
  if (r?.exceptionDetails) return `THREW: ${r.exceptionDetails.text}`;
  return r?.result?.value;
};

let failures = 0;
const report = (ok, name, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(46)} ${detail}`);
};

await send('Page.navigate', { url: `${url}?role=pad` });
await wait(7000);
await ev(
  `[...document.querySelectorAll('button')].find(b=>b.textContent.includes('נוסחה ב-LaTeX'))?.click()`
);
await wait(2500);

// ---- 1. does MathLive keep an aligned block? -------------------------------------
const ALIGNED = String.raw`\begin{aligned}y=x^{2}+n^{3}4z \\ f(x)=\end{aligned}`;
const back = await ev(`(() => {
  const f = document.querySelector('math-field');
  if (!f) return 'NO FIELD';
  f.value = ${JSON.stringify(ALIGNED)};
  return f.value;
})()`);
report(
  typeof back === 'string' && back.includes('aligned') && back.includes('f(x)'),
  'MathLive keeps the aligned block',
  JSON.stringify(back)
);

// ---- 2 + 3. two scribbles -> two lines --------------------------------------------
const box = await ev(
  `(() => { const r = document.querySelector('canvas').getBoundingClientRect();
     return {x: r.x, y: r.y, w: r.width, h: r.height}; })()`
);
const pt = (type, x, y) =>
  send('Input.dispatchMouseEvent', {
    type, x, y, button: 'left',
    buttons: type === 'mouseReleased' ? 0 : 1,
    clickCount: 1, pointerType: 'pen', force: 0.5
  });

/** a short scribble whose vertical centre is `row` of the canvas height */
async function scribble(row, from = 0.15, to = 0.45) {
  const y = box.y + box.h * row;
  const x0 = box.x + box.w * from;
  const x1 = box.x + box.w * to;
  await pt('mousePressed', x0, y);
  const steps = 26;
  for (let s = 1; s <= steps; s++) {
    await pt('mouseMoved', x0 + ((x1 - x0) * s) / steps, y + Math.sin(s / 2) * box.h * 0.05);
    await wait(9);
  }
  await pt('mouseReleased', x1, y);
  await wait(600); // let the stroke land in Firestore
}

// Record every status transition instead of sampling for it: one line takes well under
// a second to read, so a poll can step straight over "reading line 1 of 2" and conclude,
// wrongly, that it never appeared.
await ev(`(() => {
  window.__states = [];
  const el = document.querySelector('.state');
  const push = () => {
    const t = el.textContent.trim();
    if (t && window.__states[window.__states.length - 1] !== t) window.__states.push(t);
  };
  push();
  new MutationObserver(push).observe(el, { subtree: true, characterData: true, childList: true });
  return true;
})()`);

await scribble(0.2);
await scribble(0.6);
await wait(1200);

// wait for the answer
let tex = '';
for (let i = 0; i < 120; i++) {
  await wait(500);
  tex = (await ev(`document.querySelector('.tex')?.textContent`)) ?? '';
  const state = (await ev(`document.querySelector('.state')?.textContent?.trim()`)) ?? '';
  if (state.includes('\u05e0\u05db\u05e9\u05dc')) break;
  const idle = !state.includes('\u05de\u05d6\u05d4\u05d4') && !state.includes('\u05de\u05d5\u05e8\u05d9\u05d3');
  if (tex && tex.trim() !== String.raw`\;` && idle) break;
}
report(tex.includes('aligned'), 'the result is a two-row aligned block', JSON.stringify(tex));

// every status the bar showed, captured by the observer rather than sampled
const states = (await ev(`window.__states`)) ?? [];
const counted = states.filter((t) => t.includes('\u05e9\u05d5\u05e8\u05d4'));
report(
  counted.some((t) => t.includes('2')),
  'the status counted the lines',
  JSON.stringify(counted)
);
// the download percentages are hundreds of lines of nothing; only the rest is evidence
const notable = states.filter((t) => !t.includes('מוריד'));
console.log('      states, download progress elided:', JSON.stringify(notable));

console.log(`\n${failures ? `${failures} FAILED` : 'all passed'}`);
ws.close();
process.exit(failures ? 1 : 0);
