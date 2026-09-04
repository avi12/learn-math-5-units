/** The QR scanner, against a fake camera showing a real code.
 *
 *   node scantest.mjs <url> <debug-port>
 *
 * Chrome is launched with --use-file-for-fake-video-capture pointed at a y4m of the QR
 * the desktop mirror draws, so the whole path runs for real: getUserMedia, a decoder,
 * and the room switch that follows. What it exercises on a desktop is the jsQR fallback;
 * the tablet takes the native BarcodeDetector branch, which is the simpler of the two.
 *
 * The room in the code is deliberately not the room the page starts in — otherwise a
 * scanner that decoded nothing at all would still look like it had worked.
 */
const [, , url, port, want] = process.argv;
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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true });
  return r?.exceptionDetails ? 'EXC ' + r.exceptionDetails.text : r.result?.value;
};

let bad = 0;
const check = (name, ok, detail = '') => {
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(44)} ${detail}`);
};

await send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 820, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url });
await wait(6000);

const before = await ev(`new URL(location.href).searchParams.get('room')`);
check('the pad starts in some other room', before !== want, `${before}`);

const button = `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('סרוק QR'))`;
check('the scan button is on the pad', (await ev(`!!${button}`)) === true);

// Poll from the moment of the click rather than sleeping first: a fake camera holding a
// single sharp frame decodes on the first look, so the overlay can be open and gone
// again inside a couple of hundred milliseconds. Sleeping through it and then asking
// "is it there" reports a working scanner as a broken one.
await ev(`${button}.click(), 1`);
let size = 'none';
for (let i = 0; i < 40; i++) {
  const s = await ev(
    `(() => { const v = document.querySelector('.scanner video'); return v ? v.videoWidth + 'x' + v.videoHeight : ''; })()`
  );
  if (s) {
    size = s;
    if (/^[1-9]\d*x[1-9]\d*$/.test(String(s))) break;
  } else if (size !== 'none') {
    break; // it opened and has already closed — the scan landed
  }
  await wait(100);
}
check('the camera overlay opens', size !== 'none', size === 'none' ? 'never seen' : 'seen');
check('the camera is running', /^[1-9]\d*x[1-9]\d*$/.test(String(size)), String(size));

// the decode and the navigation that follows
let after = before;
for (let i = 0; i < 30; i++) {
  await wait(700);
  const now = await ev(`new URL(location.href).searchParams.get('room')`);
  if (typeof now === 'string' && now !== before) {
    after = now;
    break;
  }
}
check('the code is read and the room joined', after === want, `${before} -> ${after}`);
check('the overlay closed itself', (await ev(`!!document.querySelector('.scanner')`)) === false);

console.log(bad ? `\n${bad} FAILED` : '\nall checks passed');
ws.close();
process.exit(bad ? 1 : 0);
