/** The board answers the copy button, and cleans up after itself.
 *
 *   node shotcheck.mjs <url> <debug-port>
 *
 * Pressing "העתק כתמונה" used to change nothing where the eye was: the toast is a few
 * hundred pixels away from the thing that was copied. Now the board flashes a shutter,
 * closes a viewfinder on its four corners and reads one scanline down the page.
 *
 * Three of these are worth a test rather than an eyeball, and each one is a bug this
 * repo has already paid for once:
 *
 *   1. it LEAVES. `animation-fill-mode` defaults to `none`, so an animation that ends
 *      before its element is unmounted snaps back to full opacity for those frames —
 *      that is exactly the pale wash that parked itself on the dialog's title and stayed
 *      there. A leftover is invisible in code and obvious on screen;
 *   2. it does not grow a scrollbar. The scanline travels past the bottom edge, and
 *      `clip-path` hides an overflowing child without stopping it from counting as
 *      overflow — the dialog's sweep did precisely this;
 *   3. `prefers-reduced-motion` reaches it. The moving parts must not run at all — an
 *      instant traverse is still a traverse — while the viewfinder, which does not move,
 *      must still appear, so the press keeps its answer on the board.
 *
 * And one thing that is not about the gesture at all but has nowhere better to live:
 * the copy button is DESKTOP ONLY. On the tablet it did not fail, it landed somewhere
 * else — the Android wrapper refuses the clipboard and the bytes went out through the
 * share sheet, so the label promised a paste and opened a share menu. A rule that is
 * only a rule in a comment is a rule that comes back, so the last check asserts the
 * button is absent once the page believes it is a tablet.
 *
 * The gesture itself runs as the plain desktop mirror: an empty canvas exports fine, so
 * nothing here has to draw.
 */
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
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${n.padEnd(56)} ${d}`);
};

const copy = () =>
  ev(
    `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'העתק כתמונה')?.click()`
  );

/** Everything about the overlay in one round trip, so the samples are one moment and not
 *  three. `ty` is the scanline's own travel, read off its computed matrix. */
const state = () =>
  ev(`(() => {
    const el = document.querySelector('.shot');
    const host = document.querySelector('.host');
    if (!el) return JSON.stringify({ present: false, overflow: host.scrollHeight - host.clientHeight });
    const s = getComputedStyle(el);
    const a = getComputedStyle(el, '::after');
    const secs = (v) => Math.max(...String(v).split(',').map((x) => parseFloat(x) || 0));
    const m = a.transform.match(/matrix\\(([^)]*)\\)/);
    return JSON.stringify({
      present: true,
      count: document.querySelectorAll('.shot').length,
      events: s.pointerEvents,
      opacity: parseFloat(s.opacity),
      scanShown: a.display,
      scanDur: secs(a.animationDuration),
      ty: m ? parseFloat(m[1].split(',')[5]) : null,
      overflow: host.scrollHeight - host.clientHeight
    });
  })()`);

async function run(reduce) {
  const label = reduce ? 'reduced motion' : 'full motion';
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: reduce ? 'reduce' : 'no-preference' }]
  });
  await send('Page.navigate', { url: 'about:blank' });
  await wait(300);
  await send('Page.navigate', { url });
  await wait(6000);

  const before = JSON.parse(await state());
  check(`${label}: nothing over the board before the press`, before.present === false);

  await copy();
  await wait(90);
  const a = JSON.parse(await state());
  await wait(110);
  const b = JSON.parse(await state());

  check(`${label}: the press is answered on the board`, a.present === true);
  check(`${label}: and it cannot be clicked`, a.events === 'none', a.events);
  check(
    `${label}: the board did not grow a scrollbar`,
    (a.overflow ?? 0) <= 1,
    `${a.overflow}px of overflow`
  );

  if (reduce) {
    // The viewfinder is not motion, so it stays; the two moving parts are gone entirely.
    check(`${label}: the scanline does not run at all`, a.scanShown === 'none', a.scanShown);
    check(`${label}: but the viewfinder still shows`, a.opacity > 0.9, `opacity ${a.opacity}`);
  } else {
    check(`${label}: the scanline animates`, a.scanDur >= 0.05, `${a.scanDur}s`);
    // Two samples, because one proves a position and only two prove travel.
    check(
      `${label}: and it is really travelling`,
      a.ty !== null && b.ty !== null && b.ty > a.ty + 1,
      `y ${Math.round(a.ty)} → ${Math.round(b.ty)}`
    );
  }

  // The one that matters most: it goes, and it does not blink back on the way out.
  await wait(900);
  const after = JSON.parse(await state());
  check(`${label}: and it is gone afterwards, with no leftover`, after.present === false);

  // A second press has to replay it. A boolean flag would already be set and nothing
  // would restart — this is the whole reason the trigger is a counter.
  await copy();
  await wait(60);
  const again = JSON.parse(await state());
  check(`${label}: pressing again replays it`, again.present === true);

  // And two presses in a row are one gesture, not two overlays stacked on each other.
  await copy();
  await wait(60);
  const twice = JSON.parse(await state());
  check(`${label}: pressing twice leaves exactly one`, twice.count === 1, `${twice.count}`);
  await wait(900);
}

await run(false);
await run(true);

// Desktop only. `asTablet` is how every other test gets onto the writing board — touch
// emulation, and the app's own `pointer: coarse` guess does the rest — so this asks the
// question through the same door the tablet comes in, not through `?role=pad`.
await send('Emulation.setEmulatedMedia', {
  features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }]
});
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Page.navigate', { url: 'about:blank' });
await wait(300);
await send('Page.navigate', { url });
await wait(6000);
const onPad = JSON.parse(
  await ev(`(() => {
    const has = (t) => [...document.querySelectorAll('button')].some((b) => b.textContent.trim().startsWith(t));
    const role = [...document.querySelectorAll('.roles .btn')]
      .find((b) => b.textContent.trim() === 'לוח כתיבה')?.dataset.active;
    return JSON.stringify({ role, copy: has('העתק כתמונה'), undo: has('בטל אחרון') });
  })()`)
);
check('the page is on the writing board', onPad.role === 'true', `role active: ${onPad.role}`);
check('tablet: no copy button', onPad.copy === false);
// The row it used to sit in is still there — this is one button gone, not a toolbar.
check('tablet: the rest of the toolbar stayed', onPad.undo === true);

ws.close();
console.log(bad ? `\n${bad} FAILED` : '\nthe board answers the copy, and clears itself');
process.exit(bad ? 1 : 0);
