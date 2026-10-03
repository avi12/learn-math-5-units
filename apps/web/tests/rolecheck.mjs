/** Switching roles in place keeps the board the right shape.
 *
 *   node rolecheck.mjs <url> <debug-port>
 *
 * The desktop mirror sizes its canvas in pixels (a 3:2 page that fits the viewport); the
 * writing board fills whatever the layout leaves it. Both live in one Surface, and the
 * role buttons flip between them without a reload. The bug this guards: the mirror's pixel
 * height stayed on the canvas after switching to "לוח כתיבה", so the board was a short
 * strip at the top of a tall box, with the scroll rail running the full height beside it.
 */
import { roomUrl, freshRoom } from './lib/pad.mjs';

const [, , url, port] = process.argv;
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (m, p = {}) =>
  new Promise((r, j) => {
    const i = ++id;
    pending.set(i, r);
    setTimeout(() => j(new Error('CDP timeout: ' + m)), 20000);
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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (x) =>
  (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }))
    .result?.value;

let bad = 0;
const check = (n, ok, d = '') => {
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${n.padEnd(52)} ${d}`);
};

// A plain desktop: no touch, so the app opens on the mirror.
await send('Emulation.setDeviceMetricsOverride', {
  width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false
});
await send('Page.navigate', { url: roomUrl(url, freshRoom()) });
await wait(6000);

const role = (name) =>
  ev(`(() => {
    const b = [...document.querySelectorAll('.roles .btn')].find((b) => b.textContent.trim() === '${name}');
    b.click();
    return true;
  })()`);
const box = () =>
  ev(`(() => {
    const c = document.querySelector('canvas').getBoundingClientRect();
    const h = document.querySelector('.host').getBoundingClientRect();
    return { canvas: Math.round(c.height), host: Math.round(h.height), w: Math.round(c.width),
      doc: document.documentElement.scrollHeight, view: innerHeight };
  })()`);

const mirror = await box();
check('the mirror is a 3:2 page', Math.abs(mirror.w / mirror.canvas - 1.5) < 0.02,
  `${mirror.w}x${mirror.canvas}`);
check('and the page fits the viewport', mirror.doc <= mirror.view, `${mirror.doc} of ${mirror.view}`);

await role('לוח כתיבה');
await wait(800);
const pad = await box();
check('on the writing board the canvas fills its box', Math.abs(pad.canvas - pad.host) <= 1,
  `canvas ${pad.canvas} in host ${pad.host}`);
check('and the board grew past the mirror height', pad.canvas > mirror.canvas + 100,
  `${mirror.canvas} -> ${pad.canvas}`);

await role('תצוגה');
await wait(800);
const back = await box();
check('back on the mirror, the 3:2 page returns', Math.abs(back.canvas - mirror.canvas) <= 1,
  `${mirror.canvas} -> ${back.canvas}`);

// The switch is animated: each role has its own animation name, so the class swap restarts
// it with no JS. Read main's running animations right after the click (Svelte prefixes
// keyframe names with a hash, hence the strip); under reduced
// motion there must be none at all.
const anims = () =>
  ev(`JSON.stringify(document.querySelector('main').getAnimations({ subtree: true })
    .map((a) => a.animationName.replace(/^svelte-[a-z0-9]+-/, ''))
    .filter((n) => n.startsWith('role')).sort())`);
const clipNow = () => ev(`getComputedStyle(document.querySelector('main')).clipPath`);
await role('לוח כתיבה');
await wait(30);
const toPad = JSON.parse(await anims());
const midClip = await clipNow();
check('to the writing board: the power-on runs', toPad.includes('roleToPad') &&
  toPad.includes('roleScanDown'), toPad.join(' '));
check('and mid-way the board is still opening', midClip.startsWith('inset('), midClip);
await wait(400);
check('and it ends with nothing held', (await clipNow()) === 'none' &&
  JSON.parse(await anims()).length === 0, await clipNow());
await role('תצוגה');
await wait(30);
const toMirror = JSON.parse(await anims());
check('to the mirror: the other direction runs', toMirror.includes('roleToMirror') &&
  toMirror.includes('roleScanAcross'), toMirror.join(' '));
await wait(400);
await send('Emulation.setEmulatedMedia', {
  features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
});
await role('לוח כתיבה');
await wait(30);
const reduced = JSON.parse(await anims());
check('reduced motion: no animation at all', reduced.length === 0, reduced.join(' ') || 'none');
await role('תצוגה');
await wait(100);
await send('Emulation.setEmulatedMedia', { features: [] });

// A tall window: the full-width page needs less than the leftover height, so the board
// stops growing — and the tools must stay right under it, not drift to the bottom.
await send('Emulation.setDeviceMetricsOverride', {
  width: 1371, height: 2000, deviceScaleFactor: 1, mobile: false
});
await wait(800);
const tall = await ev(`(() => {
  const h = document.querySelector('.host').getBoundingClientRect();
  const t = document.querySelector('.tools').getBoundingClientRect();
  return { w: Math.round(h.width), h: Math.round(h.height), gap: Math.round(t.top - h.bottom),
    main: Math.round(document.querySelector('main').getBoundingClientRect().width) };
})()`);
check('tall window: the board takes the full width', Math.abs(tall.w - tall.main) <= 1,
  `${tall.w} of ${tall.main}`);
check('and the tools sit right under it', tall.gap >= 0 && tall.gap < 40, `gap ${tall.gap}px`);

console.log(bad ? `\n${bad} FAILED` : '\nthe board keeps its shape across a role switch');
process.exit(bad ? 1 : 0);
