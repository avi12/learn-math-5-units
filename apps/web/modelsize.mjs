/** How many bytes does the recogniser really cost on a cold browser?
 *
 *   node modelsize.mjs <url> <debug-port>
 *
 * Point it at a Chrome started with a FRESH --user-data-dir, or the answer is whatever
 * happened to still be in the cache. It counts every response off huggingface.co, so the
 * total is the model and its tokeniser, not the app bundle.
 */
const [, , url, port] = process.argv;

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const files = new Map(); // requestId -> url
const bytes = new Map(); // url -> encoded bytes

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
  if (m.method === 'Network.responseReceived') {
    const u = m.params.response.url;
    if (u.includes('huggingface.co') || u.includes('hf.co')) files.set(m.params.requestId, u);
  }
  if (m.method === 'Network.loadingFinished' && files.has(m.params.requestId)) {
    const u = files.get(m.params.requestId);
    bytes.set(u, (bytes.get(u) ?? 0) + m.params.encodedDataLength);
  }
};

await new Promise((r) => (ws.onopen = r));
await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: false });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (x) =>
  (await send('Runtime.evaluate', { expression: x, returnByValue: true })).result?.value;

await send('Page.navigate', { url: `${url}?role=pad` });
await wait(6000);

// draw something, so the on-open read has a canvas worth reading
const box = await ev(
  `(() => { const r = document.querySelector('canvas').getBoundingClientRect();
     return {x:r.x, y:r.y}; })()`
);
const pt = (type, x, y) =>
  send('Input.dispatchMouseEvent', {
    type, x, y, button: 'left',
    buttons: type === 'mouseReleased' ? 0 : 1,
    clickCount: 1, pointerType: 'pen', force: 0.5
  });
await pt('mousePressed', box.x + 140, box.y + 110);
for (let s = 1; s <= 30; s++) {
  await pt('mouseMoved', box.x + 140 + s * 7, box.y + 110 + Math.sin(s / 2) * 24);
  await wait(10);
}
await pt('mouseReleased', box.x + 350, box.y + 110);

await ev(
  `[...document.querySelectorAll('button')].find(b=>b.textContent.includes('נוסחה ב-LaTeX'))?.click()`
);

// wait for the download to finish, then a bit more for the read
const started = Date.now();
let lastTotal = 0;
let still = 0;
while (Date.now() - started < 20 * 60_000) {
  await wait(5000);
  const total = [...bytes.values()].reduce((a, b) => a + b, 0);
  const state = await ev(`document.querySelector('.state')?.textContent?.trim() ?? ''`);
  process.stdout.write(`\r${(total / 2 ** 20).toFixed(1)} MB  ${state}          `);
  if (total === lastTotal && total > 0 && !state.includes('מוריד')) {
    if (++still >= 3) break;
  } else still = 0;
  lastTotal = total;
}

console.log('\n');
const rows = [...bytes.entries()].sort((a, b) => b[1] - a[1]);
for (const [u, n] of rows) {
  if (n < 100_000) continue;
  console.log(`${(n / 2 ** 20).toFixed(1).padStart(8)} MB  ${u.split('/').slice(-2).join('/')}`);
}
const total = rows.reduce((a, [, n]) => a + n, 0);
console.log(`${'-'.repeat(10)}`);
console.log(`${(total / 2 ** 20).toFixed(1).padStart(8)} MB  total over the wire`);
console.log('\nfinal state :', await ev(`document.querySelector('.state')?.textContent?.trim()`));
console.log('latex       :', await ev(`document.querySelector('.tex')?.textContent`));
ws.close();
process.exit(0);
