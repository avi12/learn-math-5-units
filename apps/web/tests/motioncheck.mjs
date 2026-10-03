/** The dialog and the picker animate, and stop animating when asked to.
 *
 *   node motioncheck.mjs <url> <debug-port>
 *
 * Two things are worth a test rather than an eyeball. The first is that the entrance runs
 * at all: a <dialog> is `display: none` until it opens, so without `allow-discrete` and
 * an `@starting-style` it simply appears, and nothing about the CSS looks wrong when it
 * does. The second is `prefers-reduced-motion`, and that one has a real hole in it — the
 * skin's global rule is `*, *::before, *::after`, and neither `::backdrop` nor
 * `::picker(select)` is any of those, so both would have kept moving after everything
 * else stopped. Both are killed by a duration token instead, and this checks the token.
 *
 * The question card's entrance (a new question sweeps in behind a scanline) is checked the
 * same two ways: it runs, in the direction of the step, and comes to rest un-clipped with
 * the line gone, while the card's height follows from the old question's to the new one's;
 * and under reduced motion there is no line and nothing takes time.
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
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${n.padEnd(52)} ${d}`);
};

/** Seconds of transition on an element and on a pseudo-element of it. */
const durations = () =>
  ev(`(() => {
    const d = document.querySelector('dialog.ask');
    const s = document.querySelector('.topic select');
    const secs = (v) => Math.max(...String(v).split(',').map((x) => parseFloat(x) || 0));
    return JSON.stringify({
      dialog: secs(getComputedStyle(d).transitionDuration),
      backdrop: secs(getComputedStyle(d, '::backdrop').transitionDuration),
      picker: secs(getComputedStyle(s, '::picker(select)').transitionDuration)
    });
  })()`);

async function run(reduce) {
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: reduce ? 'reduce' : 'no-preference' }]
  });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Page.navigate', { url: 'about:blank' });
  await wait(300);
  await send('Page.navigate', { url });
  await wait(7000);

  const d = JSON.parse(await durations());
  const label = reduce ? 'reduced motion' : 'full motion';

  if (reduce) {
    check(`${label}: the dialog does not animate`, d.dialog <= 0.005, `${d.dialog}s`);
    check(`${label}: nor does the backdrop`, d.backdrop <= 0.005, `${d.backdrop}s`);
    check(`${label}: nor does the picker`, d.picker <= 0.005, `${d.picker}s`);
  } else {
    check(`${label}: the dialog animates`, d.dialog >= 0.05, `${d.dialog}s`);
    check(`${label}: so does the backdrop`, d.backdrop >= 0.05, `${d.backdrop}s`);
    check(`${label}: so does the picker`, d.picker >= 0.05, `${d.picker}s`);

    // and it really runs: caught part-way, the box is not yet at rest
    await ev(
      `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'נקה')?.click()`
    );
    await wait(40);
    const mid = JSON.parse(
      await ev(`(() => {
        const d = document.querySelector('dialog.ask');
        const s = getComputedStyle(d);
        return JSON.stringify({ open: d.open, opacity: parseFloat(s.opacity), t: s.transform });
      })()`)
    );
    check('it is open before it has arrived', mid.open === true);
    check(
      'and caught mid-flight, not already at rest',
      mid.opacity < 0.98 || (mid.t !== 'none' && mid.t !== 'matrix(1, 0, 0, 1, 0, 0)'),
      `opacity ${mid.opacity}, transform ${mid.t}`
    );
    await wait(600);
    const rest = JSON.parse(
      await ev(`(() => {
        const s = getComputedStyle(document.querySelector('dialog.ask'));
        return JSON.stringify({ opacity: parseFloat(s.opacity), t: s.transform });
      })()`)
    );
    check(
      'and it settles fully open',
      rest.opacity === 1 && (rest.t === 'none' || rest.t === 'matrix(1, 0, 0, 1, 0, 0)'),
      `opacity ${rest.opacity}`
    );
    await ev(`document.querySelector('dialog.ask[open] [data-ask="cancel"]')?.click()`);
    await wait(600);
  }

  // ---- the question card: a new question comes in -------------------------------
  const swap = await stepAndLook(1);
  const back = await stepAndLook(-1);
  if (reduce) {
    check(`${label}: a new question has no scanline`, swap.line === 'none', swap.line);
    check(`${label}: and takes no time`, swap.longest <= 0.005, `${swap.longest}ms`);
  } else {
    check(`${label}: a new question sweeps in`, swap.names.includes('qResolveFwd'), swap.names.join(','));
    check('behind a scanline', swap.names.includes('qScan') && swap.line !== 'none', swap.line);
    check('an earlier one sweeps the other way', back.dir === 'back' && back.names.includes('qResolveBack'), back.dir);
    check('inside the skin’s 200ms', swap.longest > 0 && swap.longest <= 200, `${swap.longest}ms`);
  }
  await wait(500);
  const rest = JSON.parse(
    await ev(`(() => {
      const q = document.querySelector('.qswap');
      const t = q.querySelector('.qtext');
      return JSON.stringify({
        running: q.getAnimations({ subtree: true }).length,
        clip: getComputedStyle(t).clipPath,
        line: getComputedStyle(q, '::after').opacity
      });
    })()`)
  );
  check(`${label}: the question ends at rest`, rest.running === 0 && rest.clip === 'none', `clip ${rest.clip}`);
  check('with the line gone', reduce || rest.line === '0', `opacity ${rest.line}`);

  // the card's height follows: a one-line warm-up, then a long exam-level exercise
  const grow = JSON.parse(
    await ev(`(async () => {
      const set = async (nth, v) => {
        const s = document.querySelectorAll('.question .topic select')[nth];
        s.value = v;
        s.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 400));
      };
      await set(0, '01');
      await set(1, '01:1.1');
      const box = document.querySelector('.qbox');
      const from = box.offsetHeight;
      const s = document.querySelectorAll('.question .topic select')[1];
      s.value = '01:3.4';
      s.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => requestAnimationFrame(r));
      const a = box.getAnimations().find((x) => x.effect.getKeyframes().some((k) => k.height));
      await new Promise((r) => setTimeout(r, 60));
      const mid = box.getBoundingClientRect().height;
      await new Promise((r) => setTimeout(r, 400));
      return JSON.stringify({
        from, to: box.offsetHeight, mid,
        duration: a ? Number(a.effect.getComputedTiming().duration) : null,
        after: box.getAnimations().length, overflow: getComputedStyle(box).overflow
      });
    })()`)
  );
  const moved = Math.abs(grow.to - grow.from) > 4;
  check(`${label}: the two questions differ in height`, moved, `${grow.from}px -> ${grow.to}px`);
  if (reduce) {
    check(`${label}: and the card jumps straight there`, grow.duration === null || grow.duration <= 0.005, `${grow.duration}`);
  } else {
    check(`${label}: the card's height animates`, grow.duration === 200, `${grow.duration}ms`);
    check('caught between the two heights', grow.mid > Math.min(grow.from, grow.to) && grow.mid < Math.max(grow.from, grow.to), `${Math.round(grow.mid)}px`);
  }
  check(`${label}: and lands un-clipped`, grow.after === 0 && grow.overflow === 'visible', grow.overflow);
}

/** Press next (1) or previous (-1) and read the animations on the card that replaced it. */
async function stepAndLook(d) {
  return JSON.parse(
    await ev(`(async () => {
      const [prev, next] = document.querySelectorAll('.question .steps .btn');
      (${d} > 0 ? next : prev).click();
      await new Promise((r) => requestAnimationFrame(r));
      const q = document.querySelector('.qswap');
      const anims = q.getAnimations({ subtree: true });
      return JSON.stringify({
        dir: q.dataset.dir,
        // Svelte prefixes a component's keyframes with its scope hash
        names: [...new Set(anims.map((a) => a.animationName.replace(/^svelte-[a-z0-9]+-/, '')))],
        longest: Math.max(0, ...anims.map((a) => Number(a.effect.getComputedTiming().duration) || 0)),
        line: getComputedStyle(q, '::after').display
      });
    })()`)
  );
}

await run(false);
await run(true);

ws.close();
console.log(bad ? `\n${bad} FAILED` : '\nmotion behaves, and stops when asked');
process.exit(bad ? 1 : 0);
