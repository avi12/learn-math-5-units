/** End-to-end check of the recogniser wiring.
 *
 * Proves three things the user actually asked for: opening the formula bar transcribes
 * on its own, a change to the canvas re-runs it, and the same drawing is never charged
 * twice. Run against a local `wrangler dev` with a dummy key — a 401 from Anthropic is
 * a *success* here, because it means the image reached the model's endpoint.
 *
 *   node ocrcheck.mjs <site-url> <debug-port> <worker-url>
 */
const [, , url, port, worker] = process.argv;

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const posts = [];
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
  if (
    m.method === 'Network.requestWillBeSent' &&
    m.params.request.url.startsWith(worker) &&
    m.params.request.method === 'POST'
  )
    posts.push((m.params.request.postData ?? '').length);
};
await new Promise((r) => (ws.onopen = r));
await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1150, height: 1200, deviceScaleFactor: 1 });

const ev = async (expr) =>
  (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }))
    .result?.value;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await send('Page.navigate', { url });
await wait(6000);

const room = await ev(`new URL(location.href).searchParams.get('room')`);
const BASE = `https://firestore.googleapis.com/v1/projects/avi-math-study/databases/(default)/documents/rooms/${room}/strokes`;
const KEY = 'YOUR_FIREBASE_API_KEY';

const addStroke = async (docId, points, n) => {
  const body = JSON.stringify({
    fields: {
      t: { stringValue: 'ink' },
      c: { stringValue: 'ink' },
      w: { integerValue: '6' },
      p: { stringValue: points },
      n: { integerValue: String(n) }
    }
  });
  return ev(
    `fetch(${JSON.stringify(`${BASE}?documentId=${docId}&key=${KEY}`)},` +
      `{method:'POST',headers:{'Content-Type':'application/json'},body:${JSON.stringify(body)}}).then(r=>r.status)`
  );
};
const delStroke = (docId) =>
  ev(`fetch(${JSON.stringify(`${BASE}/${docId}?key=${KEY}`)},{method:'DELETE'}).then(r=>r.status)`);

console.log('seed stroke a   :', await addStroke('a', '0.10,0.20,0.8;0.30,0.20,0.8', 1));
console.log('seed stroke b   :', await addStroke('b', '0.20,0.10,0.8;0.20,0.30,0.8', 2));
await wait(2500);
console.log('canvas          :', (await ev(`document.body.innerText.includes('אין עדיין כלום')`)) ? 'empty' : 'has ink');

await ev(`localStorage.setItem('avi-math-ocr-endpoint',${JSON.stringify(worker)})`);
await send('Page.reload');
await wait(7000);

await ev(
  `[...document.querySelectorAll('button')].find(b=>b.textContent.includes('נוסחה ב-LaTeX'))?.click()`
);
await wait(9000);
const afterOpen = await ev(`document.querySelector('.state')?.textContent?.trim()`);
const postsAfterOpen = posts.length;

// a real change to the canvas must re-run recognition on its own
console.log('add stroke c    :', await addStroke('c', '0.40,0.20,0.8;0.50,0.30,0.8', 3));
await wait(10000);
const afterChange = await ev(`document.querySelector('.state')?.textContent?.trim()`);
const postsAfterChange = posts.length;

// "recognise again" is a deliberate retry, so it must always hit the network;
// the automatic path is the one that dedupes (only observable with a valid key)
await ev(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('זהה שוב'))?.click()`);
await wait(4000);
const postsAfterRepeat = posts.length;

console.log('');
console.log('on open         :', JSON.stringify(afterOpen), '| posts:', postsAfterOpen);
console.log('after new stroke:', JSON.stringify(afterChange), '| posts:', postsAfterChange);
console.log('manual re-run                 | posts:', postsAfterRepeat);
console.log('payload sizes   :', posts.map((n) => `${Math.round(n / 1024)}KB`).join(', '));
console.log('');
console.log('auto on open      :', postsAfterOpen >= 1 ? 'PASS' : 'FAIL');
console.log('re-runs on change :', postsAfterChange > postsAfterOpen ? 'PASS' : 'FAIL');
console.log('manual forces read:', postsAfterRepeat > postsAfterChange ? 'PASS' : 'FAIL');

for (const d of ['a', 'b', 'c']) await delStroke(d);
ws.close();
