/** Evidence that the two failing cases were real. `node oldrule.mjs`
 *
 * A replica of the rule this replaced — one timer, restarted only when a stroke lands,
 * with no knowledge of the pen at all — run over the same scripts as settletest.mjs.
 * Not assertions: this prints what the formula bar used to do.
 */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const MS = 120;
const S = (t) => Math.round((t * MS) / 100);

class Old {
  constructor(run, ms) {
    this.run = run;
    this.ms = ms;
  }
  pen() {} // the old code had no pen signal — this empty method is the whole bug
  nudge() {
    clearTimeout(this.t);
    this.t = setTimeout(() => this.run(), this.ms);
  }
  cancel() {
    clearTimeout(this.t);
  }
}

async function under(script, tailMs = 250) {
  let runs = 0;
  const s = new Old(() => runs++, MS);
  for (const [at, what] of script) {
    await wait(S(at));
    if (what === 'stroke') s.nudge();
    else s.pen(what === 'down');
  }
  await wait(S(tailMs));
  s.cancel();
  return runs;
}

// One stroke that outlasts the window: the timer armed by the previous stroke fires
// underneath it, so the model reads a half-drawn equation.
const LONG_STROKE = [
  [0, 'down'], [30, 'up'], [10, 'stroke'],
  [40, 'down'], [300, 'up'], [10, 'stroke']
];

// One equation, six symbols, ordinary pauses: every pause looks like an ending.
const SIX_STROKES = [
  [0, 'down'], [20, 'up'], [10, 'stroke'],
  [80, 'down'], [20, 'up'], [10, 'stroke'],
  [90, 'down'], [25, 'up'], [10, 'stroke'],
  [70, 'down'], [20, 'up'], [10, 'stroke'],
  [85, 'down'], [15, 'up'], [10, 'stroke'],
  [60, 'down'], [30, 'up'], [10, 'stroke']
];

console.log('old rule, same scripts settletest.mjs asserts on:');
console.log(`  one long stroke             ran ${await under(LONG_STROKE)}x   (new rule: 1)`);
console.log(`  an equation in six strokes  ran ${await under(SIX_STROKES)}x   (new rule: 1)`);
