/** The eraser's hit test, on synthetic strokes. `node erasetest.mjs`
 *
 * The eraser removes whole strokes, so the only question it ever asks is "did the rubber
 * touch this one". The cases that matter are the ones where a bounding box would answer
 * differently from the ink: the empty middle of a circle, the hollow of a rectangle, and
 * a stroke that passes close by without being touched.
 */
import { hits, pack } from '../src/lib/ink.ts';

const S = ({ t, pts, w = 6 }) => ({ t, c: 'ink', w, p: pack(pts.map(([x, y]) => ({ x, y, pr: 0.5 }))) });
const R = 0.02;

let failures = 0;
function check({ name, stroke, x, y, want }) {
  const got = hits({ stroke, x, y, r: R });
  const ok = got === want;
  if (!ok) {failures++;}
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(56)} ${got}  want ${want}`);
}

const line = S({
  t: 'ink',
  pts: [
    [0.2, 0.3],
    [0.5, 0.3],
    [0.5, 0.45]
  ]
});
check({ name: 'the rubber on the ink', stroke: line, x: 0.35, y: 0.3, want: true });
check({ name: 'the rubber on the corner', stroke: line, x: 0.5, y: 0.32, want: true });
check({ name: 'the rubber just off the end', stroke: line, x: 0.12, y: 0.3, want: false });
check({ name: 'the rubber inside the elbow but off the ink', stroke: line, x: 0.3, y: 0.42, want: false });

// A shape stores two corners. Its ink is the outline it draws, never the diagonal.
const rect = S({
  t: 'rect',
  pts: [
    [0.2, 0.2],
    [0.6, 0.5]
  ]
});
check({ name: 'a rectangle is hit on its edge', stroke: rect, x: 0.4, y: 0.2, want: true });
check({ name: 'a rectangle is hit on the far edge too', stroke: rect, x: 0.4, y: 0.5, want: true });
check({ name: 'a rectangle is NOT hit through its hollow middle', stroke: rect, x: 0.4, y: 0.35, want: false });

const ell = S({
  t: 'ellipse',
  pts: [
    [0.2, 0.2],
    [0.6, 0.5]
  ]
});
check({ name: 'an ellipse is hit on its rim', stroke: ell, x: 0.4, y: 0.2, want: true });
check({ name: 'an ellipse is NOT hit in its middle', stroke: ell, x: 0.4, y: 0.35, want: false });
check({ name: 'an ellipse is NOT hit in the corner of its box', stroke: ell, x: 0.21, y: 0.21, want: false });

// A straight line stroke keeps the diagonal, because that IS what it draws.
check({
  name: 'a straight line is hit along itself',
  stroke: S({
    t: 'line',
    pts: [
      [0.2, 0.2],
      [0.6, 0.5]
    ]
  }),
  x: 0.4,
  y: 0.35,
  want: true
});

// A thick stroke is easier to hit than a thin one — the nib counts.
const thin = S({
  t: 'ink',
  pts: [
    [0.2, 0.3],
    [0.5, 0.3]
  ]
});
const thick = S({
  t: 'ink',
  pts: [
    [0.2, 0.3],
    [0.5, 0.3]
  ],
  w: 16
});
check({ name: 'a thin stroke misses at 0.024 away', stroke: thin, x: 0.35, y: 0.324, want: false });
check({ name: 'a thick stroke is caught at the same distance', stroke: thick, x: 0.35, y: 0.324, want: true });

check({ name: 'a stroke with no points', stroke: { t: 'ink', c: 'ink', w: 6, p: '' }, x: 0.3, y: 0.3, want: false });

console.log(`\n${failures ? `${failures} FAILED` : 'all passed'}`);
process.exit(failures ? 1 : 0);
