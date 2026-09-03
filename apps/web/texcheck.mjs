/** Verify the formula bar really produces valid LaTeX.
 *
 * Every string is passed to the page with JSON.stringify rather than interpolated into
 * source, because an earlier version of this check lost backslashes on the way through
 * the shell and made MathLive look broken when the harness was.
 *
 *   node texcheck.mjs <url> <debug-port>
 */
import fs from 'node:fs';
import katex from 'katex';

const url = process.argv[2];
const port = process.argv[3] || '9412';

const CASES = {
  'שבר ושורש': String.raw`\frac{-b+\sqrt{b^2-4ac}}{2a}`,
  'טריגו בריבוע': String.raw`\sin^2 x+\cos^2 x=1`,
  'אינטגרל מסויים': String.raw`\int_0^{\pi}\sin x\,dx`,
  'הגדרת הנגזרת': String.raw`\lim_{h\to 0}\frac{f(x+h)-f(x)}{h}`,
  'סכום סדרה': String.raw`\sum_{k=1}^{n}k=\frac{n(n+1)}{2}`,
  'יוונית ומעלות': String.raw`0^{\circ}<2\alpha<180^{\circ}`,
  'שבר מקונן': String.raw`\frac{1}{1+\frac{1}{x}}`,
  'שורש ריבועי של שבר': String.raw`\sqrt{\frac{x^2-a^2}{x}}`
};

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const errs = [];
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
    return;
  }
  if (m.method === 'Runtime.exceptionThrown')
    errs.push('EXC ' + (m.params.exceptionDetails.exception?.description || '').slice(0, 160));
};
await new Promise((r) => (ws.onopen = r));
await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1150, height: 1200, deviceScaleFactor: 1 });
await send('Page.navigate', { url });
await new Promise((r) => setTimeout(r, 8000));

const ev = async (expr) =>
  (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }))
    .result?.value;

await ev(
  `[...document.querySelectorAll('button')].find(b=>b.textContent.includes('נוסחה ב-LaTeX'))?.click()`
);
await new Promise((r) => setTimeout(r, 5000));
if (!(await ev(`!!document.querySelector('math-field')`))) {
  console.log('NO FIELD');
  process.exit(1);
}

const results = {};

// --- 1. typing, the way the on-screen keyboard delivers characters ------------
await ev(`(()=>{const f=document.querySelector('math-field');f.value='';f.focus();})()`);
await new Promise((r) => setTimeout(r, 900)); // the field needs a beat before the first key
for (const ch of ['x', '^', '2', 'ArrowRight', '+', '1', '/', '2']) {
  const isKey = ch.length > 1;
  const p = isKey
    ? { key: ch, code: ch, windowsVirtualKeyCode: 39 }
    : { key: ch, code: 'Key' + ch.toUpperCase(), text: ch, unmodifiedText: ch };
  await send('Input.dispatchKeyEvent', { type: 'keyDown', ...p });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...p });
  await new Promise((r) => setTimeout(r, 160));
}
await new Promise((r) => setTimeout(r, 800));
results['הקלדה: x^2 ואז +1/2'] = await ev(`document.querySelector('math-field').value`);

// --- 2. commands, exactly as the virtual keyboard inserts them ----------------
for (const [name, tex] of Object.entries(CASES)) {
  await ev(
    `(()=>{const f=document.querySelector('math-field');f.value='';f.executeCommand(['insert',${JSON.stringify(tex)}]);})()`
  );
  await new Promise((r) => setTimeout(r, 450));
  results[name] = await ev(`document.querySelector('math-field').value`);
}

// --- 3. did the last value reach Firestore -----------------------------------
await new Promise((r) => setTimeout(r, 1500));
const room = await ev(`new URL(location.href).searchParams.get('room')`);
const synced = await ev(
  `fetch('https://firestore.googleapis.com/v1/projects/avi-math-study/databases/(default)/documents/rooms/${room}/latex/current?key=YOUR_FIREBASE_API_KEY').then(r=>r.json()).then(d=>d.fields?.tex?.stringValue ?? 'NONE')`
);

// --- 4. the real test: does what came out actually parse as LaTeX ------------
let bad = 0;
console.log('KaTeX | ' + 'input'.padEnd(26) + ' | what the field produced');
for (const [name, got] of Object.entries(results)) {
  let ok = false;
  try {
    katex.renderToString(got, { throwOnError: true, strict: false });
    ok = true;
  } catch (e) {
    errs.push(`KaTeX rejected "${got}": ${e.message.slice(0, 120)}`);
  }
  if (!ok) bad++;
  console.log((ok ? ' OK   | ' : ' FAIL | ') + name.padEnd(26) + ' | ' + JSON.stringify(got));
}
console.log('\nround-trip identical to input:',
  Object.entries(CASES).filter(([k, v]) => results[k] === v).length, 'of', Object.keys(CASES).length);
console.log('synced to firestore :', JSON.stringify(synced));
console.log('parse failures      :', bad);
errs.forEach((e) => console.log(e));
fs.writeFileSync('texout.json', JSON.stringify(results, null, 1));
ws.close();
