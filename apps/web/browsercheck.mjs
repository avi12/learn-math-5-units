/** Watch the real site recognise real handwriting, in a real browser.
 *
 *   node browsercheck.mjs <url> <debug-port> [minutes]
 */
const [, , url, port, mins = '10'] = process.argv;
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
await send('Emulation.setDeviceMetricsOverride', { width: 1150, height: 1200, deviceScaleFactor: 1 });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (x) =>
  (await send('Runtime.evaluate', { expression: x, returnByValue: true })).result?.value;

await send('Page.navigate', { url });
await wait(8000);
console.log('canvas :', (await ev(`document.body.innerText.includes('אין עדיין כלום')`)) ? 'EMPTY' : 'has ink');
await ev(
  `[...document.querySelectorAll('button')].find(b=>b.textContent.includes('נוסחה ב-LaTeX'))?.click()`
);

const deadline = Date.now() + Number(mins) * 60_000;
let last = '';
while (Date.now() < deadline) {
  await wait(5000);
  const state = (await ev(`document.querySelector('.state')?.textContent?.trim()`)) ?? '';
  const tex = (await ev(`document.querySelector('.tex')?.textContent`)) ?? '';
  if (state !== last) {
    console.log(`[${new Date().toISOString().slice(11, 19)}] ${state}`);
    last = state;
  }
  if (tex && tex.trim() !== '\\;') {
    console.log('');
    console.log('LATEX  :', JSON.stringify(tex));
    console.log('field  :', JSON.stringify(await ev(`document.querySelector('math-field')?.value`)));
    ws.close();
    process.exit(0);
  }
  if (state.includes('נכשל')) {
    console.log('FAILED');
    ws.close();
    process.exit(1);
  }
}
console.log('timed out after', mins, 'minutes; last state:', JSON.stringify(last));
ws.close();
