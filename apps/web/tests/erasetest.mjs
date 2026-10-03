/** The eraser's hit test, on synthetic strokes. `node erasetest.mjs`
 *
 * The eraser removes whole strokes, so the only question it ever asks is "did the rubber
 * touch this one". The cases that matter are the ones where a bounding box would answer
 * differently from the ink: the empty middle of a circle, the hollow of a rectangle, and
 * a stroke that passes close by without being touched.
 */
import { hits, pack } from '../src/lib/ink.ts';

const S = (t, pts, w = 6) => ({ t, c: 'ink', w, p: pack(pts.map(([x, y]) => ({ x, y, pr: 0.5 }))) });
const R = 0.02;

let failures = 0;
function check(name, stroke, x, y, want) {
  const got = hits(stroke, x, y, R);
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(56)} ${got}  want ${want}`);
}

const line = S('ink', [
  [0.2, 0.3],
  [0.5, 0.3],
  [0.5, 0.45]
]);
check('the rubber on the ink', line, 0.35, 0.3, true);
check('the rubber on the corner', line, 0.5, 0.32, true);
check('the rubber just off the end', line, 0.12, 0.3, false);
check('the rubber inside the elbow but off the ink', line, 0.3, 0.42, false);

// A shape stores two corners. Its ink is the outline it draws, never the diagonal.
const rect = S('rect', [
  [0.2, 0.2],
  [0.6, 0.5]
]);
check('a rectangle is hit on its edge', rect, 0.4, 0.2, true);
check('a rectangle is hit on the far edge too', rect, 0.4, 0.5, true);
check('a rectangle is NOT hit through its hollow middle', rect, 0.4, 0.35, false);

const ell = S('ellipse', [
  [0.2, 0.2],
  [0.6, 0.5]
]);
check('an ellipse is hit on its rim', ell, 0.4, 0.2, true);
check('an ellipse is NOT hit in its middle', ell, 0.4, 0.35, false);
check('an ellipse is NOT hit in the corner of its box', ell, 0.21, 0.21, false);

// A straight line stroke keeps the diagonal, because that IS what it draws.
check(
  'a straight line is hit along itself',
  S('line', [
    [0.2, 0.2],
    [0.6, 0.5]
  ]),
  0.4,
  0.35,
  true
);

// A thick stroke is easier to hit than a thin one — the nib counts.
const thin = S('ink', [
  [0.2, 0.3],
  [0.5, 0.3]
]);
const thick = S('ink', [
  [0.2, 0.3],
  [0.5, 0.3]
], 16);
check('a thin stroke misses at 0.024 away', thin, 0.35, 0.324, false);
check('a thick stroke is caught at the same distance', thick, 0.35, 0.324, true);

check('a stroke with no points', { t: 'ink', c: 'ink', w: 6, p: '' }, 0.3, 0.3, false);

console.log(`\n${failures ? `${failures} FAILED` : 'all passed'}`);
process.exit(failures ? 1 : 0);
