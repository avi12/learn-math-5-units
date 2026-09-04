/** Line grouping, on synthetic strokes. `node linestest.mjs`
 *
 * The interesting cases are not "two obvious lines" — they are the things that must NOT
 * split: the two bars of an '=', an exponent floating above the baseline, a fraction.
 * Each of those is a stroke that overlaps nothing directly, and each stays put only
 * because some tall glyph on its line reaches across it.
 */
import { equation, lines, pack } from './src/lib/ink.ts';

const S = (pts, w = 6) => ({ t: 'ink', c: 'ink', w, p: pack(pts) });
/** a stroke as a box: x from..to, y from..to */
const box = (x0, y0, x1, y1, w = 6) =>
  S([
    { x: x0, y: y0, pr: 0.5 },
    { x: x1, y: y0, pr: 0.5 },
    { x: x1, y: y1, pr: 0.5 },
    { x: x0, y: y1, pr: 0.5 }
  ], w);

let failures = 0;
function check(name, strokes, want) {
  const got = lines(strokes).map((g) => g.length);
  const ok = got.length === want.length && got.every((n, i) => n === want[i]);
  if (!ok) failures++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(52)} ${got.length} lines [${got}]  want [${want}]`
  );
}

// Avi's actual drawing: "y = x² + n³4z" over "f(x) =", measured off the canvas and
// converted to the normalised units strokes use (y / canvasWidth, canvas 1130 wide).
const L1 = 141 / 1130, L1b = 292 / 1130;
const L2 = 369 / 1130, L2b = 488 / 1130;
check(
  'two equations, the real geometry',
  [
    box(0.25, L1, 0.32, L1b), // y, with its descender
    box(0.36, L1 + 0.03, 0.42, L1 + 0.05), // = upper bar
    box(0.36, L1 + 0.07, 0.42, L1 + 0.09), // = lower bar
    box(0.44, L1 + 0.02, 0.52, L1 + 0.1), // x
    box(0.5, L1, 0.55, L1 + 0.03), // the exponent, floating high
    box(0.2, L2, 0.26, L2b), // f, tall
    box(0.28, L2 + 0.02, 0.36, L2 + 0.09), // (x)
    box(0.38, L2 + 0.04, 0.44, L2 + 0.06) // =
  ],
  [5, 3]
);

// An exponent sits entirely above the letter it belongs to, and touches nothing else.
// It stays on the line because the baseline glyphs span its rows.
check(
  'a lone exponent does not become its own line',
  [box(0.2, 0.30, 0.28, 0.40), box(0.28, 0.26, 0.32, 0.30)],
  [2]
);

// A fraction: numerator, bar, denominator. The bar bridges both halves.
check(
  'a fraction stays one line',
  [box(0.3, 0.20, 0.4, 0.26), box(0.28, 0.27, 0.42, 0.275), box(0.3, 0.29, 0.4, 0.35)],
  [3]
);

// The geometry that actually broke it, measured off a real drawing of
// (x^2-5x+6)/(x-2) = 4 in the pad. The numerator sits a clear gap above the bar - the
// same fraction of a character height as the gap between two written lines - so a purely
// vertical rule splits it into three, and the lone bar makes the model hallucinate.
// Only the bar spanning both halves horizontally tells them apart.
check(
  'a full-size fraction is not cut into three',
  [
    box(0.30, 0.173, 0.36, 0.233), // numerator, left
    box(0.40, 0.173, 0.50, 0.233), // numerator, right
    box(0.26, 0.278, 0.62, 0.282), // the bar, wider than both halves
    box(0.32, 0.327, 0.38, 0.387), // denominator
    box(0.68, 0.240, 0.77, 0.250) // "= 4", off to the side
  ],
  [5]
);

// Avi's second real drawing, and the one that broke it twice over: the fraction
// (x²−5x+6)/(x−2) with "= 4 |·(x−2)" beside it, and the next step written underneath.
// Two separate mechanisms glued the two equations into one, and the recogniser answered
// with them run together — `\frac{x^2-5x+6}{x-2} = 4x^2-5x+6 = 4(x-2)`.
//   1. the long vertical annotation bar spans both written lines, and overlap is
//      transitive, so it dragged the second line into the first group;
//   2. the fraction bar covers the strokes of the second line horizontally, so the
//      bar rule merged them back even once the vertical stroke was held out.
// Geometry measured off his screenshot, normalised by the 1142px board width.
check(
  'a tall annotation bar does not glue the next line to this one',
  [
    box(0.225, 0.124, 0.45, 0.269), // numerator, left half
    box(0.47, 0.124, 0.733, 0.269), // numerator, right half
    box(0.19, 0.27, 0.738, 0.273), // the fraction bar, long
    box(0.37, 0.286, 0.584, 0.339), // denominator
    box(0.76, 0.215, 0.84, 0.265), // "= 4", to the right of the fraction
    box(0.85, 0.151, 0.854, 0.37), // the annotation bar, reaching down past the line
    box(0.88, 0.23, 0.995, 0.31), // "·(x−2)"
    box(0.081, 0.375, 0.32, 0.457), // the next step, first half
    box(0.34, 0.375, 0.698, 0.457) // the next step, second half
  ],
  [7, 2]
);

// The vertical stroke is put back where it belongs, not dropped and not left alone.
check(
  'a vertical stroke rejoins the line it sits on',
  [box(0.2, 0.2, 0.6, 0.28), box(0.64, 0.19, 0.645, 0.29)],
  [2]
);

// ...but a bar that spans nothing is just a minus sign, and must not glue two lines.
check(
  'a short minus sign does not merge two lines',
  [
    box(0.20, 0.10, 0.60, 0.18),
    box(0.30, 0.24, 0.36, 0.245), // short dash, covers little of either line
    box(0.20, 0.40, 0.60, 0.48)
  ],
  [1, 1, 1]
);

// Three lines, comfortably spaced.
check(
  'three lines',
  [box(0.2, 0.10, 0.6, 0.18), box(0.2, 0.30, 0.6, 0.38), box(0.2, 0.50, 0.6, 0.58)],
  [1, 1, 1]
);

// Order matters: the strokes arrive in drawing order, which need not be top to bottom.
check(
  'lines come back top to bottom whatever the drawing order',
  [box(0.2, 0.50, 0.6, 0.58), box(0.2, 0.10, 0.6, 0.18), box(0.2, 0.30, 0.6, 0.38)],
  [1, 1, 1]
);
{
  const out = lines([box(0.2, 0.5, 0.6, 0.58), box(0.2, 0.1, 0.6, 0.18)]);
  const tops = out.map((g) => +JSON.parse(`[${g[0].p.split(';')[0].split(',')[1]}]`)[0]);
  const ok = tops[0] < tops[1];
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${'and really are sorted by height'.padEnd(52)} ${tops}`);
}

// The reason the tolerance has a ceiling: an integral sign is several times taller than
// the line it sits on, and a tolerance scaled purely to it would reach the line below.
check(
  'a tall integral sign does not swallow the line below',
  [
    box(0.20, 0.10, 0.23, 0.34), // the integral, very tall
    box(0.25, 0.18, 0.60, 0.26), // the rest of its line
    box(0.20, 0.40, 0.60, 0.48) // the next line, an ordinary gap below
  ],
  [2, 1]
);

// And the reason it has a floor: small handwriting has small gaps everywhere.
check(
  'small handwriting keeps its fraction together',
  [box(0.30, 0.200, 0.36, 0.222), box(0.29, 0.229, 0.37, 0.231), box(0.30, 0.238, 0.36, 0.260)],
  [3]
);

// Nothing drawn, and strokes with no points, must not throw.
check('an empty drawing', [], []);
check('a stroke with no points is dropped', [{ t: 'ink', c: 'ink', w: 6, p: '' }], []);

// Touching lines are one line — the model will struggle either way, and merging is the
// honest answer rather than cutting a descender in half.
check(
  'lines written on top of each other stay merged',
  [box(0.2, 0.20, 0.6, 0.32), box(0.2, 0.30, 0.6, 0.42)],
  [2]
);

// ---------------------------------------------------------------------------
// equation(): what of a written line is handed to the recogniser.
//
// Avi writes the step he is taking in the margin — a long vertical bar and then
// `·(x−2)`. The model is a formula reader, and handed the two together it answered for
// a line that was a fraction over (x−2) with `x^2-5x+6=4(x-2)`: the fraction gone, the
// note absorbed. The note stays on the board and comes off the picture.
function kept(name, strokes, want) {
  const got = equation(strokes).length;
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(52)} ${got} of ${strokes.length}  want ${want}`);
}

kept(
  'the margin note comes off the picture',
  [
    box(0.225, 0.124, 0.45, 0.269), // numerator
    box(0.19, 0.27, 0.738, 0.273), // fraction bar
    box(0.37, 0.286, 0.584, 0.339), // denominator
    box(0.76, 0.215, 0.84, 0.265), // "= 4"
    box(0.85, 0.151, 0.854, 0.37), // the divider, three times a character tall
    box(0.88, 0.23, 0.995, 0.31) // "·(x−2)", the note itself
  ],
  4
);

kept(
  'a line with no divider is handed over whole',
  [box(0.1, 0.2, 0.3, 0.28), box(0.34, 0.2, 0.5, 0.28), box(0.54, 0.2, 0.7, 0.28)],
  3
);

// An absolute value is the case this must never touch: the bars are as tall as the
// digits beside them, and the left one stands before the middle of the ink.
kept(
  'absolute-value bars are not dividers',
  [
    box(0.2, 0.2, 0.204, 0.28), // |
    box(0.22, 0.21, 0.28, 0.28), // x
    box(0.3, 0.23, 0.36, 0.25), // -
    box(0.38, 0.21, 0.44, 0.28), // 3
    box(0.46, 0.2, 0.464, 0.28), // |
    box(0.5, 0.23, 0.56, 0.25), // =
    box(0.6, 0.21, 0.66, 0.28) // 5
  ],
  7
);

// A tall bracket on the LEFT of the line is structure, not a note.
kept(
  'a tall stroke before the middle is left in',
  [
    box(0.1, 0.15, 0.106, 0.42), // a big bracket at the start
    box(0.16, 0.2, 0.34, 0.3),
    box(0.16, 0.32, 0.34, 0.4)
  ],
  3
);

console.log(`\n${failures ? `${failures} FAILED` : 'all passed'}`);
process.exit(failures ? 1 : 0);
