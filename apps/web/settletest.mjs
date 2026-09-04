/** The debounce, on a real clock. `node settletest.mjs`
 *
 * Each case is a script of pen events, in milliseconds from t=0, and the assertion is
 * how many recognitions the whole script should cause. Cases 1 and 2 are the two bugs
 * this replaced: both fired mid-equation before.
 */
import { Settle, SETTLE_MS } from './src/lib/settle.ts';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const MS = 120; // a short clock, so the suite finishes in seconds
const S = (t) => Math.round((t * MS) / 100); // scripts are written in hundredths of it

let failures = 0;

function report(name, runs, want, armed) {
  const ok = runs === want;
  if (!ok) failures++;
  const tail = armed === undefined ? '' : `  (armed ${armed}x)`;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(46)} runs=${runs} want=${want}${tail}`);
}

/**
 * @param name   what is being written
 * @param script [afterMs, 'down' | 'up' | 'stroke'] — 'stroke' is a landing from Firestore
 * @param want   how many recognitions should have run by the end
 */
async function check(name, script, want, tailMs = 250) {
  let runs = 0;
  let armed = 0;
  const s = new Settle(
    () => runs++,
    (on) => on && armed++,
    MS
  );
  for (const [at, what] of script) {
    await wait(S(at));
    if (what === 'stroke') s.nudge();
    else s.pen(what === 'down');
  }
  await wait(S(tailMs));
  report(name, runs, want, armed);
}

console.log(`SETTLE_MS in the app = ${SETTLE_MS}; this suite runs at ${MS}ms\n`);

// A single stroke that takes longer than the whole settle window. The old code armed a
// timer when the previous stroke landed and had nothing to cancel it, so it fired while
// this one was still being drawn.
await check(
  'one stroke longer than the delay',
  [
    [0, 'down'],
    [30, 'up'],
    [10, 'stroke'],
    [40, 'down'], // pen back down well before the countdown would fire
    [300, 'up'], // ...and stays down far longer than the window
    [10, 'stroke']
  ],
  1
);

// Writing one equation: several symbols, ordinary pauses between them. Exactly one read,
// at the end. The old 1300ms window fired on every pause longer than itself.
await check(
  'an equation written in six strokes',
  [
    [0, 'down'],
    [20, 'up'],
    [10, 'stroke'],
    [80, 'down'], // pause to reposition, shorter than the window
    [20, 'up'],
    [10, 'stroke'],
    [90, 'down'],
    [25, 'up'],
    [10, 'stroke'],
    [70, 'down'],
    [20, 'up'],
    [10, 'stroke'],
    [85, 'down'],
    [15, 'up'],
    [10, 'stroke'],
    [60, 'down'],
    [30, 'up'],
    [10, 'stroke']
  ],
  1
);

// Genuinely finishing, then starting a second equation: two reads, one each.
await check(
  'two equations with a real gap between them',
  [
    [0, 'down'],
    [20, 'up'],
    [10, 'stroke'],
    [400, 'down'], // long after the first read has run
    [20, 'up'],
    [10, 'stroke']
  ],
  2
);

// A landing that arrives while the pen is already back down must not start the clock.
await check(
  'stroke lands after the next stroke has begun',
  [
    [0, 'down'],
    [20, 'up'],
    [5, 'down'], // the next symbol started before Firestore echoed the last one
    [10, 'stroke'], // the late landing — must be ignored, the pen is down
    [300, 'up'],
    [10, 'stroke']
  ],
  1
);

// cancel() is what "זהה שוב" and unmounting use: stop waiting without running.
{
  let runs = 0;
  const s = new Settle(() => runs++);
  s.pen(true);
  s.pen(false);
  await wait(S(30));
  s.cancel();
  await wait(S(250));
  report('cancel stops a countdown already running', runs, 0);
}

// The armed flag has to go false again, or the countdown bar never clears.
{
  const seen = [];
  const s = new Settle(() => {}, (on) => seen.push(on), MS);
  s.pen(true);
  s.pen(false);
  await wait(S(200));
  const ok = seen.join(',') === 'true,false';
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${'armed goes true then false'.padEnd(46)} ${seen.join(',')}`);
}

console.log(`\n${failures ? `${failures} FAILED` : 'all passed'}`);
process.exit(failures ? 1 : 0);
