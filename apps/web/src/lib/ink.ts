/** Stroke model, packing and rendering — shared by the pad and the board.
 *
 * Coordinates are normalised against the board WIDTH — BOTH of them, x and y — so a
 * stroke drawn on a 2560px tablet renders identically on a 900px desktop panel.
 *
 * Normalising y by the width and not by the height is what lets the board be a strip
 * rather than a page: x still runs 0…1, but y has no upper bound, and how much of it
 * you can see is just how tall the viewport happens to be. Scrolling is therefore a
 * render offset and nothing more — no stroke is rewritten, and a drawing made before
 * the board could scroll still lands in exactly the same place. */

/** The shape of an EXPORTED page, width : height. The board on screen is no longer this
 *  shape — it is whatever box the viewport gives it — but an image handed to the
 *  recogniser or pasted into a chat still wants a stable, page-like frame. */
export const ASPECT = 1.5; // width : height

/** The visible height of one exported page, in the normalised units above. */
export const PAGE = 1 / ASPECT;

export type Tool = 'ink' | 'line' | 'rect' | 'ellipse' | 'erase';
export type Pen = 'ink' | 'accent' | 'warn' | 'danger';

export interface Stroke {
  t: Tool;
  c: Pen;
  w: number;
  /** "x,y,pressure;x,y,pressure;…" with three decimals, x normalised by width. */
  p: string;
}

const TOKEN: Record<Pen, string> = {
  ink: '--fg',
  accent: '--secondary',
  warn: '--warn',
  danger: '--danger'
};

export function colour(pen: Pen): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(TOKEN[pen]);
  return v.trim() || '#000';
}

export type Pt = { x: number; y: number; pr: number };

export function pack(pts: Pt[]): string {
  return pts.map((q) => `${q.x.toFixed(3)},${q.y.toFixed(3)},${q.pr.toFixed(2)}`).join(';');
}

export function unpack(p: string): Pt[] {
  if (!p) return [];
  return p.split(';').map((s) => {
    const [x, y, pr] = s.split(',');
    return { x: +x, y: +y, pr: +pr };
  });
}

/** Thin the tail of a live stroke: the wire only needs what the eye can see. */
export function decimate(pts: Pt[], min = 0.0018): Pt[] {
  const out: Pt[] = [];
  for (const q of pts) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(q.x - last.x, q.y - last.y) >= min) out.push(q);
  }
  if (out[out.length - 1] !== pts[pts.length - 1] && pts.length) out.push(pts[pts.length - 1]);
  return out;
}

function width(base: number, pressure: number, w: number): number {
  // pressure 0 happens on mice and on some pens at the very start of a stroke
  const pr = pressure > 0 ? pressure : 0.5;
  return (base * (0.45 + 1.15 * pr) * w) / 1000;
}

export function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke, w: number): void {
  const pts = unpack(s.p);
  if (!pts.length) return;
  ctx.save();
  ctx.strokeStyle = colour(s.c);
  ctx.fillStyle = colour(s.c);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const X = (v: number) => v * w;
  const Y = (v: number) => v * w;

  if (s.t === 'ink') {
    // Variable width: draw each segment on its own so pressure can change along it.
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      ctx.beginPath();
      ctx.lineWidth = width(s.w, (a.pr + b.pr) / 2, w);
      ctx.moveTo(X(a.x), Y(a.y));
      // a midpoint quadratic keeps the line smooth without a curve-fitting pass
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      ctx.quadraticCurveTo(X(a.x), Y(a.y), X(mx), Y(my));
      ctx.lineTo(X(b.x), Y(b.y));
      ctx.stroke();
    }
  } else {
    const a = pts[0];
    const b = pts[pts.length - 1];
    ctx.lineWidth = width(s.w, 0.7, w);
    ctx.beginPath();
    if (s.t === 'line') {
      ctx.moveTo(X(a.x), Y(a.y));
      ctx.lineTo(X(b.x), Y(b.y));
    } else if (s.t === 'rect') {
      ctx.rect(X(a.x), Y(a.y), X(b.x - a.x), Y(b.y - a.y));
    } else if (s.t === 'ellipse') {
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      ctx.ellipse(X(cx), Y(cy), Math.abs(X(b.x - a.x)) / 2, Math.abs(Y(b.y - a.y)) / 2, 0, 0, 7);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** The outline a stroke actually draws, as a polyline in normalised units.
 *
 *  A shape stroke stores only the two corners the pointer went between, so anything that
 *  needs its geometry — hit-testing, for one — has to rebuild what was drawn from them
 *  and not use the diagonal that connects them. */
function outline(s: Stroke): Pt[] {
  const pts = unpack(s.p);
  if (s.t === 'ink' || pts.length < 2) return pts;
  const a = pts[0];
  const b = pts[pts.length - 1];
  if (s.t === 'line') return [a, b];
  if (s.t === 'rect')
    return [a, { ...a, x: b.x }, b, { ...a, y: b.y }, a];
  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2;
  const rx = Math.abs(b.x - a.x) / 2;
  const ry = Math.abs(b.y - a.y) / 2;
  return Array.from({ length: 33 }, (_, i) => {
    const t = (i / 32) * Math.PI * 2;
    return { x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t), pr: 0.5 };
  });
}

function toSegment(px: number, py: number, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len)) : 0;
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

/** Does an eraser of radius `r` at (x, y) touch this stroke?
 *
 *  The eraser takes WHOLE STROKES, not pixels, and that is not a shortcut. Recognition
 *  reads strokes: ink rubbed out of the bitmap would still be handed to the model, so
 *  the board and the LaTeX would disagree. A stroke is also exactly one Firestore
 *  document, so rubbing one out is a delete both devices already know how to apply —
 *  the same path the undo button uses. */
export function hits(s: Stroke, x: number, y: number, r: number): boolean {
  const pts = outline(s);
  if (!pts.length) return false;
  const reach = r + (s.w * 1.025) / 2000;
  if (pts.length === 1) return Math.hypot(x - pts[0].x, y - pts[0].y) <= reach;
  for (let i = 1; i < pts.length; i++) {
    if (toSegment(x, y, pts[i - 1], pts[i]) <= reach) return true;
  }
  return false;
}

/** The box a stroke's ink actually covers, in normalised units. */
export type Box = { x0: number; x1: number; y0: number; y1: number };

function box(s: Stroke): Box | null {
  const pts = unpack(s.p);
  if (!pts.length) return null;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const q of pts) {
    if (q.x < x0) x0 = q.x;
    if (q.x > x1) x1 = q.x;
    if (q.y < y0) y0 = q.y;
    if (q.y > y1) y1 = q.y;
  }
  // the path is the centre of the nib, so the ink reaches half a line width past it
  const half = (s.w * 1.025) / 2000;
  return { x0: x0 - half, x1: x1 + half, y0: y0 - half, y1: y1 + half };
}

/** A long FLAT stroke — a fraction bar, the vinculum of a root.
 *
 *  Flatness is the whole test, and it has to be absolute rather than a ratio: a written
 *  line drawn in one long sweep is also much wider than it is tall, and treating it as a
 *  bar glued every line on the board into one. A real bar is as tall as the nib and no
 *  taller, which is what FLAT measures. */
const FLAT = 0.02;

function isBar(b: Box): boolean {
  const h = b.y1 - b.y0;
  return h <= FLAT && b.x1 - b.x0 >= 5 * h;
}

/** The transpose of a bar: a long THIN VERTICAL stroke.
 *
 *  Grouping wants tall glyphs, because a bracket or a descender reaching across the
 *  short things beside it is what holds a written line together. A straight vertical
 *  line is the case where that goes wrong: it is not a glyph, it is an annotation —
 *  the divider in "= 4 |·(x−2)", the line drawn beside a step to mark what was done to
 *  both sides — and it is drawn deliberately long, which means it spans the line below
 *  as well and glues the two into one. Measured on a real drawing of Avi's: the two
 *  equations came back as one, and the recogniser ran them together into nonsense.
 *
 *  Such a stroke is therefore held out of the grouping pass and put back afterwards on
 *  the line it overlaps most. That is what makes the test cheap to be wrong about: an
 *  ordinary "1" or "l" caught by it lands back on its own line anyway. */
function isPipe(b: Box): boolean {
  const w = b.x1 - b.x0;
  return w <= FLAT && b.y1 - b.y0 >= 5 * w;
}

/** How far a fraction bar reaches to claim the half it belongs to, as a fraction of the
 *  board width. Without a limit the bar rule below merges any line that happens to sit
 *  under the bar's span, however far down the page — which is exactly what happened to a
 *  fraction with a whole equation written beneath it.
 *
 *  Measured, in these units: bar to its own numerator or denominator, 0.007 in small
 *  handwriting and 0.045 in the largest drawing on record; bar to the NEXT written line,
 *  0.102. A bar and the half it belongs to are one glyph, and 6% of the board width is
 *  already a very large one. */
const BAR_REACH = 0.06;

/** The vertical distance between two boxes; 0 when they overlap. */
function gap(a: Box, b: Box): number {
  return Math.max(0, b.y0 - a.y1, a.y0 - b.y1);
}

/** How much of `inner`'s width lies inside `outer`'s. */
function covers(outer: Box, inner: Box): number {
  const w = inner.x1 - inner.x0;
  if (w <= 0) return 0;
  return Math.max(0, Math.min(outer.x1, inner.x1) - Math.max(outer.x0, inner.x0)) / w;
}

/** How far apart two pieces of ink can be and still be the same line, as a fraction of
 *  the board width. A quarter of the handwriting's own size tracks how big the writing
 *  is, and the clamp keeps that from going wrong at both ends: without the ceiling one
 *  tall integral sign makes its line greedy enough to swallow the next one, and without
 *  the floor very small handwriting splits its own fraction bars off. */
const NEAR = { of: 0.25, min: 0.012, max: 0.03 };

/** The size of the handwriting in a group — the MEDIAN height of its strokes, not the
 *  height of the group.
 *
 *  Those two are the same for one written line and wildly different for a fraction,
 *  whose group is a whole stack: numerator, bar, denominator. Scaling the tolerance to
 *  the stack made the group greedier the taller it got, so a fraction reached the
 *  ceiling and swallowed the equation written below it — measured at a gap of 0.030
 *  against a tolerance of 0.030. The median stroke is a character, which is the thing
 *  the gap between two lines should actually be compared against; the same drawing then
 *  gives 0.018, and the lines separate. */
function size(heights: number[]): number {
  const s = [...heights].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Split a drawing into writing lines, top to bottom.
 *
 * Two strokes share a line when their vertical extents overlap — transitively, and with
 * the small tolerance above. Overlap alone does most of the work, because a real equation
 * contains something tall (a descender, a bracket, an integral) and that glyph reaches
 * across every short thing beside it: the two bars of an '=', an exponent, a fraction bar.
 * The tolerance covers the rest, a fraction written with air around its bar being the case
 * that actually broke a pure overlap test.
 *
 * This exists because the recogniser reads ONE formula. Handed a picture of two lines it
 * answers with the first and silently drops the rest — measured, not guessed. Splitting
 * needs the stroke geometry, which is exactly what rasterising the canvas throws away, so
 * it has to happen here and not in the image.
 */
export function lines(strokes: Stroke[]): Stroke[][] {
  const boxes = strokes.map(box);
  const drawn = strokes.map((_, i) => i).filter((i) => boxes[i]);
  // a straight vertical annotation stroke does not get to bridge lines — see isPipe
  const pipes = drawn.filter((i) => isPipe(boxes[i]!));
  const idx = drawn.filter((i) => !isPipe(boxes[i]!));
  idx.sort((a, b) => boxes[a]!.y0 - boxes[b]!.y0);

  type Group = Box & { items: number[]; hs: number[] };
  let groups: Group[] = [];
  for (const i of idx) {
    const b = boxes[i]!;
    const g = groups[groups.length - 1];
    const near = g ? Math.min(NEAR.max, Math.max(NEAR.min, size(g.hs) * NEAR.of)) : 0;
    if (g && b.y0 <= g.y1 + near) {
      g.y1 = Math.max(g.y1, b.y1);
      g.x0 = Math.min(g.x0, b.x0);
      g.x1 = Math.max(g.x1, b.x1);
      g.items.push(i);
      g.hs.push(b.y1 - b.y0);
    } else {
      groups.push({ ...b, items: [i], hs: [b.y1 - b.y0] });
    }
  }

  // A fraction defeats the rule above, and the geometry alone cannot save it: the gap
  // from a numerator to its bar is the same fraction of a character height as the gap
  // between two written lines. Measured on a real drawing, both sit near 0.47 - there is
  // no threshold that separates them.
  //
  // The bar itself is the signal. A stroke far wider than it is tall, spanning what sits
  // above and below it, is a fraction bar, and nothing is ever written across two lines
  // that way. So after grouping, adjacent groups are merged back whenever a bar in one
  // of them covers the other horizontally.
  //
  // This matters because the two mistakes are not symmetric. Failing to split leaves the
  // second equation unread - quiet, and the first answer is still right. Splitting a
  // fraction feeds the model a bare horizontal line, and it answers with hallucinated
  // prose from the papers it was trained on. Being slow to split is the safe direction.
  for (let pass = 0; pass < groups.length; pass++) {
    let merged = false;
    for (let i = 0; i + 1 < groups.length; i++) {
      const a = groups[i];
      const b = groups[i + 1];
      // Coverage is measured against a single stroke, not against the whole group. A
      // group's x-extent stretches to whatever else sits on that line — an "= 4" off to
      // the right — and the bar cannot be expected to reach under that too. It only has
      // to sit over the thing it is a bar for.
      const bridges = (from: Group, to: Group) =>
        from.items.some(
          (k) =>
            isBar(boxes[k]!) &&
            to.items.some(
              (j) => covers(boxes[k]!, boxes[j]!) > 0.7 && gap(boxes[k]!, boxes[j]!) <= BAR_REACH
            )
        );
      if (bridges(a, b) || bridges(b, a)) {
        a.y1 = Math.max(a.y1, b.y1);
        a.x0 = Math.min(a.x0, b.x0);
        a.x1 = Math.max(a.x1, b.x1);
        a.items.push(...b.items);
        a.hs.push(...b.hs);
        groups.splice(i + 1, 1);
        merged = true;
        break;
      }
    }
    if (!merged) break;
  }

  // The vertical strokes held out above rejoin the line they cover most. One that covers
  // no line at all — a bare "1" written alone — becomes its own, which is the honest
  // answer: the alternative is attaching it to whichever line happens to be nearest.
  for (const i of pipes) {
    const b = boxes[i]!;
    let best: Group | null = null;
    let most = 0;
    for (const g of groups) {
      const over = Math.min(g.y1, b.y1) - Math.max(g.y0, b.y0);
      if (over > most) {
        most = over;
        best = g;
      }
    }
    if (best) {
      best.items.push(i);
      best.hs.push(b.y1 - b.y0);
      best.y0 = Math.min(best.y0, b.y0);
      best.y1 = Math.max(best.y1, b.y1);
    } else {
      groups.push({ ...b, items: [i], hs: [b.y1 - b.y0] });
    }
  }
  groups.sort((a, b) => a.y0 - b.y0);

  // drawing order is restored inside each line: later strokes paint over earlier ones
  return groups.map((g) => g.items.sort((a, b) => a - b).map((i) => strokes[i]));
}

/** The part of a written line that is the EQUATION, without the note beside it.
 *
 *  Avi writes what he did to both sides in the margin: a long vertical bar and then
 *  `·(x−2)` or `−4x+8`. That is a note to himself, not part of the formula, and the
 *  recogniser is a formula reader — handed the two together it produced
 *  `x^2-5x+6=4(x-2)` for a line that was a FRACTION equal to 4. So the note is left out
 *  of the image the model gets. It stays on the board, of course.
 *
 *  Two conditions keep this away from real mathematics. The bar must be at least twice
 *  the median stroke height of its own line — an absolute-value bar is about as tall as
 *  the digits beside it, a margin divider is drawn far taller — and it must stand to the
 *  right of the middle of the ink, which `|x-3|=5` never does. If dropping would leave
 *  nothing, nothing is dropped. */
export function equation(group: Stroke[]): Stroke[] {
  const boxes = group.map(box);
  const heights = boxes.filter(Boolean).map((b) => b!.y1 - b!.y0);
  if (heights.length < 3) return group;
  const tall = [...heights].sort((a, b) => a - b)[heights.length >> 1] * 2;
  const x0 = Math.min(...boxes.filter(Boolean).map((b) => b!.x0));
  const x1 = Math.max(...boxes.filter(Boolean).map((b) => b!.x1));
  const middle = (x0 + x1) / 2;

  let cut = Infinity;
  for (const b of boxes) {
    if (!b || !isPipe(b)) continue;
    if (b.y1 - b.y0 >= tall && b.x0 > middle) cut = Math.min(cut, b.x0);
  }
  if (cut === Infinity) return group;
  const kept = group.filter((_, i) => boxes[i] && boxes[i]!.x0 < cut);
  return kept.length ? kept : group;
}

/** The box a whole drawing covers, or null if there is no ink. Callers use it for two
 *  things the strip made necessary: how far down the board you are allowed to scroll,
 *  and how tall an exported image has to be so nothing written low is cut off. */
export function bounds(strokes: Stroke[]): Box | null {
  let out: Box | null = null;
  for (const s of strokes) {
    const b = box(s);
    if (!b) continue;
    out = out
      ? {
          x0: Math.min(out.x0, b.x0),
          x1: Math.max(out.x1, b.x1),
          y0: Math.min(out.y0, b.y0),
          y1: Math.max(out.y1, b.y1)
        }
      : b;
  }
  return out;
}

/** `top` is the scroll offset in normalised units: the y that sits at the top edge.
 *  It is applied as a translate and nothing else — the strokes themselves never move. */
export function render(
  ctx: CanvasRenderingContext2D,
  strokes: Stroke[],
  live: Stroke | null,
  w: number,
  h: number,
  background?: string,
  top = 0
): void {
  ctx.clearRect(0, 0, w, h);
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.save();
  ctx.translate(0, -top * w);
  for (const s of strokes) drawStroke(ctx, s, w);
  if (live) drawStroke(ctx, live, w);
  ctx.restore();
}
