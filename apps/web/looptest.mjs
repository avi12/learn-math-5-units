/** The decoder-loop detector. `node looptest.mjs`
 *
 * Handed a fragment that is not a formula, texify2 does not fail - it repeats one short
 * piece until it runs out of tokens, and the result is syntactically valid LaTeX. That is
 * what reached the pad: one equation drawn, a fraction shown eight times. Nothing further
 * down can tell that from a long formula, so the detector has to be right about both
 * directions - catching the loop, and never flagging a long legitimate answer.
 */
import { degenerate } from './src/lib/recognise.ts';

let failures = 0;
function check(name, text, want) {
  const got = degenerate(text);
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(50)} ${got} (want ${want})`);
}

// The real thing, from the pad: one drawn equation came back as this.
const piece = String.raw`\frac{1}{2}\left(\frac{1}{2}\right)^{2}+`;
check('the loop that was actually reported', piece.repeat(8), true);

check('a short answer is never a loop', String.raw`\frac{x^{2}-5x+6}{x-2}=4`, false);
check('empty', '', false);

// A long but legitimate formula: a real multi-term expansion repeats symbols, not spans.
check(
  'a long legitimate polynomial',
  String.raw`x^{5}+5x^{4}y+10x^{3}y^{2}+10x^{2}y^{3}+5xy^{4}+y^{5}+3x^{2}-7xy+2y^{2}-11x+4y-9`,
  false
);

// A genuine aligned block with distinct rows must survive.
check(
  'a real two-row aligned block',
  String.raw`\begin{aligned}y=x^{2}+n^{3}4z \\ f(x)=\sqrt{2x+7}-\frac{1}{x-3}\end{aligned}`,
  false
);

// A sum with a repeating pattern, but only twice - not a loop.
check(
  'a term repeated twice is not a loop',
  String.raw`\frac{1}{2}\left(\frac{1}{2}\right)^{2}+\frac{1}{2}\left(\frac{1}{2}\right)^{2}+x`,
  false
);

// Four repeats is the threshold, and a loop always overshoots it.
check('four repeats trips it', piece.repeat(4), true);

console.log(`\n${failures ? `${failures} FAILED` : 'all passed'}`);
process.exit(failures ? 1 : 0);
