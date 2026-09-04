/** Screenshot of the formula bar mid-countdown. `node penshot.mjs <url> <port> <out.png>` */
import { writeFileSync } from 'node:fs';

const [, , url, port, out, scheme = 'light'] = process.argv;
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
await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 1500, deviceScaleFactor: 2 });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (x) =>
  (await send('Runtime.evaluate', { expression: x, returnByValue: true })).result?.value;

await send('Page.navigate', { url: `${url}?role=pad` });
await wait(7000);
await ev(
  `[...document.querySelectorAll('button')].find(b=>b.textContent.includes('נוסחה ב-LaTeX'))?.click()`
);
await wait(1000);

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

// a squiggle that looks like handwriting, then let go
await pt('mousePressed', box.x + 140, box.y + 110);
for (let s = 1; s <= 40; s++) {
  await pt('mouseMoved', box.x + 140 + s * 6, box.y + 110 + Math.sin(s / 2) * 26);
  await wait(12);
}
await pt('mouseReleased', box.x + 380, box.y + 110);

await wait(900); // countdown roughly a third gone
const clip = await ev(
  `(() => { const r = document.querySelector('.tex-pane').getBoundingClientRect();
     return {x: r.x - 10, y: r.y - 10, width: r.width + 20, height: 200, scale: 2}; })()`
);
const shot = await send('Page.captureScreenshot', { format: 'png', clip });
writeFileSync(out, Buffer.from(shot.data, 'base64'));
console.log('wrote', out);
ws.close();
process.exit(0);
