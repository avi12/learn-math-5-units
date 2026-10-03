/** A snapped line sits ON the grid line. `node gridcheck.mjs <url> <debug-port>`
 *
 * Avi, 03.10.2026: "נראה שהקו לא נצמד למשבצת כמו שצריך — זה צריך להיות על הקו עצמו", and
 * then "the black line should sit on top of the grayish grid". The grid is a CSS background
 * and the ink is a canvas bitmap, so the only honest judge is a SCREENSHOT: both end up as
 * pixels there, and nothing the page reports about itself is involved.
 *
 * It draws snapped lines with the line tool — horizontal and vertical, near the top-left
 * and near the bottom-right of the board, where a scale error between the two layers is
 * largest — then finds, along a scanline across each one, the centre of the ink and the
 * nearest grey grid line, and asks for them to be within a pixel. At device pixel ratio 1
 * and 2, because the tablet is 2 and the desktop is usually 1.
 *
 * And at a larger square (the "גודל משבצת" slider, 03.10.2026), where it also checks that
 * the size belongs to the ROOM: the same room opened as the desktop mirror, with this
 * device's remembered size wiped, draws the same squares. */
import { inflateSync } from 'node:zlib';
import { asTablet, assertPad, freshRoom, roomUrl, DB } from './lib/pad.mjs';

const [, , url, port] = process.argv;
if (!url || !port) {
  console.error('usage: node gridcheck.mjs <url> <debug-port>');
  process.exit(2);
}

/** Decode an 8-bit RGB/RGBA, non-interlaced PNG — what Chrome's screenshot is. */
function decodePng(buf) {
  let pos = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      channels = data[9] === 6 ? 4 : 3;
    }
    if (type === 'IDAT') {
      idat.push(data);
    }
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const px = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? px[y * stride + x - channels] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? px[(y - 1) * stride + x - channels] : 0;
      let v = line[x];
      if (f === 1) {
        v += a;
      } else if (f === 2) {
        v += b;
      } else if (f === 3) {
        v += (a + b) >> 1;
      } else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[y * stride + x] = v & 255;
    }
  }
  return { width, height, lum: (x, y) => {
    const i = y * stride + x * channels;
    return 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
  } };
}

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = list.find((t) => t.type === 'page');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0;
const waiting = new Map();
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (waiting.has(msg.id)) {
    waiting.get(msg.id)(msg);
    waiting.delete(msg.id);
  }
};
function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((r) => waiting.set(id, r));
}
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r.result?.result?.value;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(56)} ${detail}`);
  if (!ok) {
    failed++;
  }
}

async function drag(x0, y0, x1, y1) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0, y: y0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 8; i++) {
    const t = i / 8;
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, button: 'left', buttons: 1 });
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y: y1, button: 'left', buttons: 0, clickCount: 1 });
}

/** The darkness-weighted centre of the pixels within `r` of `guess` (in scanline
 *  indices): a threshold run is quantised to half a pixel and reads an antialiased edge as
 *  a whole pixel, which made a line exactly on the grid look a pixel off. */
function centroid(values, guess, r, bg) {
  let sum = 0;
  let mass = 0;
  for (let i = Math.max(0, Math.round(guess - r)); i <= Math.min(values.length - 1, Math.round(guess + r)); i++) {
    const d = Math.max(0, bg - values[i]);
    sum += d * (i + 0.5);
    mass += d;
  }
  return mass ? sum / mass - 0.5 : guess;
}

/** Centre of each run of rows (or columns) darker than `below` along a scanline. */
function runs(values, below) {
  const out = [];
  let start = -1;
  values.forEach((v, i) => {
    if (v < below && start < 0) {
      start = i;
    }
    if (v >= below && start >= 0) {
      out.push((start + i - 1) / 2);
      start = -1;
    }
  });
  return out;
}

async function setScale(scale) {
  await ev(`(() => {
    const r = [...document.querySelectorAll('.tools label')].find((l) => l.textContent.includes('גודל משבצת'))?.querySelector('input');
    r.value = '${scale}';
    r.dispatchEvent(new Event('input', { bubbles: true }));
    r.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
}

for (const [dpr, scale] of [[1, 1], [2, 1], [1, 2.3], [2, 2.3]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 1500, deviceScaleFactor: dpr, mobile: false });
  await asTablet(send);
  const room = freshRoom();
  await send('Page.navigate', { url: roomUrl(`${url}?role=pad`, room) });
  await sleep(2500);
  await assertPad(ev);
  await setScale(scale);
  await ev(`document.querySelector('[data-tool=line]').click()`);
  await sleep(100);
  // the canvas's content box, in CSS px, and the grid square
  const box = await ev(`(() => {
    const c = document.querySelector('canvas');
    const r = c.getBoundingClientRect();
    return { left: r.left + c.clientLeft, top: r.top + c.clientTop, w: c.clientWidth, h: c.clientHeight,
             snap: [...document.querySelectorAll('.btn')].find((b) => b.textContent.includes('הצמד'))?.dataset.active };
  })()`);
  check(`dpr ${dpr} ×${scale}: snapping is on`, box.snap === 'true', box.snap);
  const cell = (box.w / 40) * scale;
  // A horizontal line near the top and one near the bottom, a vertical near each side.
  // Pressed off-grid on purpose (a third of a cell), so only the snap can put them on.
  // Positions in BASE squares, so the same four lines fit the board at every scale.
  const base = box.w / 40;
  const off = base / 3;
  const near = (k) => k * base + off;
  const lines = [
    { dir: 'h', a: [box.left + near(4), box.top + near(3)], b: [box.left + near(14), box.top + near(3)] },
    { dir: 'h', a: [box.left + near(24), box.top + box.h - near(3)], b: [box.left + near(36), box.top + box.h - near(3)] },
    { dir: 'v', a: [box.left + near(2), box.top + near(6)], b: [box.left + near(2), box.top + near(12)] },
    { dir: 'v', a: [box.left + box.w - near(3), box.top + box.h - near(12)], b: [box.left + box.w - near(3), box.top + box.h - near(5)] }
  ];
  for (const l of lines) {
    await drag(l.a[0], l.a[1], l.b[0], l.b[1]);
    await sleep(150);
  }
  await sleep(600);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const img = decodePng(Buffer.from(shot.result.data, 'base64'));
  for (const [i, l] of lines.entries()) {
    const horizontal = l.dir === 'h';
    // a scanline across the line, through its middle, in device pixels
    const mid = horizontal ? (l.a[0] + l.b[0]) / 2 : (l.a[1] + l.b[1]) / 2;
    const across = horizontal ? l.a[1] : l.a[0];
    const from = Math.round((across - 2 * cell) * dpr);
    const to = Math.round((across + 2 * cell) * dpr);
    const vals = [];
    for (let p = from; p <= to; p++) {
      vals.push(horizontal ? img.lum(Math.round(mid * dpr), p) : img.lum(p, Math.round(mid * dpr)));
    }
    const ibg = Math.max(...vals);
    const ink = runs(vals, 110).map((v) => (centroid(vals, v, 3 * dpr, ibg) + from) / dpr);
    // The grid on the same axis, read past the end of the line, in the middle of a square
    // — so neither the ink nor a crossing grid line is on that scanline.
    // Before the line's start rather than past its end: past the end of a line near the
    // board's far edge, at a large square, is off the board.
    const start = horizontal ? Math.min(l.a[0], l.b[0]) : Math.min(l.a[1], l.b[1]);
    const origin = horizontal ? box.left : box.top;
    const beside = (Math.floor((start - origin) / cell) - 0.5) * cell + origin;
    const gvals = [];
    for (let p = from; p <= to; p++) {
      gvals.push(horizontal ? img.lum(Math.round(beside * dpr), p) : img.lum(p, Math.round(beside * dpr)));
    }
    const bg = Math.max(...gvals);
    const grid = runs(gvals, bg - 6).map((v) => (centroid(gvals, v, 1.5 * dpr, bg) + from) / dpr);
    // the ink run nearest to where the pen pressed — the board's border and its scroll rail
    // are dark too, and sit on the same scanline near the edges
    const centre = ink.reduce((b, v) => (Math.abs(v - across) < Math.abs(b - across) ? v : b), Infinity);
    const nearest = grid.reduce((b, g) => (Math.abs(g - centre) < Math.abs(b - centre) ? g : b), Infinity);
    const gap = Math.abs(nearest - centre);
    check(`dpr ${dpr} ×${scale}: line ${i + 1} (${horizontal ? 'horizontal' : 'vertical'}) sits on a grid line`,
      Number.isFinite(centre) && gap <= 0.5, `ink ${centre.toFixed(2)}px, grid ${nearest.toFixed(2)}px, off ${gap.toFixed(2)}px`);
  }

  if (scale !== 1) {
    // The thickness belongs to the room too ("עובי הדיו גם צריך להישמר עם החדר").
    await ev(`(() => {
      const r = [...document.querySelectorAll('.tools label')].find((l) => /עובי|גודל המחק/.test(l.textContent))?.querySelector('input');
      r.value = '11';
      r.dispatchEvent(new Event('input', { bubbles: true }));
      r.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    // Both writes are in the room before this device goes away — read straight from
    // Firestore, not from the page, so a slow first snapshot cannot pass for a lost one.
    const stored = async (slot) => {
      const d = await (await fetch(`${DB}/rooms/${room}/prefs/${slot}`)).json();
      return Number(d.fields?.value?.doubleValue ?? d.fields?.value?.integerValue);
    };
    for (let i = 0; i < 40 && ((await stored('grid')) !== scale || (await stored('size')) !== 11); i++) {
      await sleep(250);
    }
    check(`dpr ${dpr} ×${scale}: the room holds the square size`, (await stored('grid')) === scale);
    check(`dpr ${dpr} ×${scale}: and the thickness`, (await stored('size')) === 11);
    // The mirror, on another "device": nothing remembered locally, so only the room can
    // tell it the size.
    await ev(`localStorage.removeItem('avi-math-grid'), localStorage.removeItem('avi-math-size'), 1`);
    await send('Page.navigate', { url: roomUrl(`${url}?role=board`, room) });
    await sleep(3500);
    const mirror = await ev(`(() => {
      const c = document.querySelector('canvas');
      return parseFloat(c.style.getPropertyValue('--grid-cell')) / c.clientWidth * 40;
    })()`);
    check(`dpr ${dpr} ×${scale}: the mirror draws the room's squares`, Math.abs(mirror - scale) < 0.01, `×${mirror?.toFixed(3)}`);
    await ev(`localStorage.removeItem('avi-math-size'), 1`);
    await send('Page.navigate', { url: roomUrl(`${url}?role=pad`, room) });
    await sleep(3500);
    const thick = await ev(`[...document.querySelectorAll('.tools label')].find((l) => /עובי|גודל המחק/.test(l.textContent))?.querySelector('input').value`);
    check(`dpr ${dpr} ×${scale}: a fresh pad picks the room's thickness`, thick === '11', thick);
  }
}

ws.close();
console.log(failed ? `\n${failed} failed` : '\nsnapped lines sit on the grid');
process.exit(failed ? 1 : 0);
