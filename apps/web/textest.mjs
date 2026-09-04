/** What comes back from the model, cleaned up. `node textest.mjs`
 *
 * Every case here is something the model actually did on Avi's board, not a hypothetical:
 * it read his handwritten x as \chi, and handed a picture of four equations it answered
 * with the four glued together by dollar signs — which MathLive then rendered as one
 * run-on line that meant nothing.
 */
import { rows, tidy, degenerate } from './src/lib/recognise.ts';

let failures = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(54)} ${JSON.stringify(got)}`);
  if (!ok) console.log(`      want ${JSON.stringify(want)}`);
}

check('a plain answer is left alone', tidy('x^{2}-5x+6=0'), 'x^{2}-5x+6=0');
check('outer dollars come off', tidy('$x^{2}=4$'), 'x^{2}=4');
check('a fenced answer is unwrapped', tidy('```latex\nx=1\n```'), 'x=1');

// The one that made every line on his board wrong.
check('chi becomes x', tidy('\\chi^{2}-5\\chi+6=4(\\chi-2)'), 'x^{2}-5x+6=4(x-2)');
check('capital chi becomes X', tidy('\\Chi+1'), 'X+1');
check('a longer command starting with chi is untouched', tidy('\\chirho+1'), '\\chirho+1');

// Four equations, glued. Taken apart they are the rows the board actually had.
check(
  'dollars separate rows',
  rows('\\chi^{2}-5\\chi+6=4(\\chi-2)$\\chi^{2}-4\\chi+14=0$'),
  ['x^{2}-5x+6=4(x-2)', 'x^{2}-4x+14=0']
);
check('a single formula is one row', rows('$x=1$'), ['x=1']);
check('nothing is no rows', rows('   '), []);

// The loop detector must keep working on the cleaned text.
check('a real answer is not a loop', degenerate('x^{2}-5x+6=4(x-2) \\\\ x^{2}-9x+14=0'), false);
check(
  'a tiled answer is a loop',
  degenerate('\\frac{1}{2}\\frac{1}{2}\\frac{1}{2}\\frac{1}{2}\\frac{1}{2}\\frac{1}{2}\\frac{1}{2}'),
  true
);

console.log(`\n${failures ? `${failures} FAILED` : 'all passed'}`);
process.exit(failures ? 1 : 0);
