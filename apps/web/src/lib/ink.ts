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

/** One square of the notebook grid behind the board at scale 1, in normalised units:
 *  forty to a width, which is about the 5mm square of an A4 notebook. Normalised and not
 *  pixels, so the tablet and the desktop mirror draw the same squares under the same ink.
 *  The grid is CSS behind the canvas, never ink: the rubber cannot touch it and exports
 *  skip it. */
const SQUARES_ACROSS = 40;
const GRID_BASE = 1 / SQUARES_ACROSS;

/** A slider's range. The one home for each one: the slider, the stored value and
 *  firestore.rules all follow these bounds (the rules file repeats them; see there). */
export type Range = { readonly min: number; readonly max: number; readonly step: number; readonly initial: number };

/** The grid-size slider: how many base squares one square spans. */
/** Fine steps, so the squares grow with the finger instead of in seven jumps. Snapped
 *  points still land on the lines: four stored decimals (see `pack`) are within a twentieth
 *  of a pixel of any multiple of these cells. */
export const GRID_SCALE: Range = { min: 1, max: 4, step: 0.1, initial: 1 };

/** The thickness slider: pen width, and the rubber's size with it. */
export const PEN_SIZE: Range = { min: 2, max: 16, step: 1, initial: 6 };

/** Any value onto a range's steps — a tampered or stale stored value cannot leave it. */
export function clampToRange(range: Range, value: number): number {
  if (!Number.isFinite(value)) {
    return range.initial;
  }
  // rounded to the step's own decimals, so 0.1 steps read 1.3 and not 1.3000000000000003
  const decimals = (String(range.step).split('.')[1] ?? '').length;
  const stepped = Number((Math.round(value / range.step) * range.step).toFixed(decimals));
  return Math.min(range.max, Math.max(range.min, stepped));
}

/** One square, in normalised units, at a given slider scale. */
export function gridCell(scale: number): number {
  return GRID_BASE * scale;
}

/** The nearest grid crossing — where a shape's corner lands when snapping is on.
 *  Normalised y is measured from the top of the strip, and the grid's horizontal lines
 *  sit on multiples of the cell there, so this needs no scroll offset. */
export function snapPoint(point: Pt, cell: number): Pt {
  const toNearestLine = (value: number) => Math.round(value / cell) * cell;
  return { ...point, x: toNearestLine(point.x), y: toNearestLine(point.y) };
}

/** How far the first horizontal grid line sits above the top edge of a view scrolled to
 *  `top`, in normalised units. The same multiples-of-the-cell rule as `snapPoint`, said
 *  once here so the squares on screen and the crossings a shape snaps to cannot disagree. */
export function gridPhase(top: number, cell: number): number {
  return top % cell;
}

/** Margin left under the lowest ink in an exported image, in normalised units. */
const EXPORT_PAD = 0.03;

/** How tall one copied part is, in normalised units.
 *
 *  Two pages, not one. One page was the safe end of the trade — 1800×1200 arrives in a
 *  conversation almost untouched — but Avi's own board is about eleven pages long, and
 *  one page per part made that eighteen pastes: "יש יותר מדי חלקים, אפשר שגובה התמונה
 *  המועתקת יוכפל". Two pages is 1800×2400, which the 1568px long-edge limit scales to
 *  1176×1568 — 65%, still plainly handwriting — and it halves the pastes. */
export const PART = PAGE * 2;

/** How much of one part repeats at the top of the next, in normalised units — about a
 *  twentieth of a page. A line of writing that lands exactly on a cut is unreadable in
 *  both halves; with a strip of overlap every line arrives whole in at least one part. */
const PART_OVERLAP = 0.03;

/** How tall the whole strip exports, in normalised units. One page is the floor, so a
 *  short drawing exports exactly as it did before the board could scroll. */
export function exportSpan(bottom: number): number {
  return Math.max(PAGE, bottom + EXPORT_PAD);
}

/** Where each part of the export starts, in normalised units.
 *
 *  Avi (19.09.2026): "הדחיסה על הקנבס אצל claude.ai גדולה מדי… תאפשר לצלם בחלקים".
 *  An image attached to a conversation is scaled down to roughly 1568px on its long
 *  edge, and that edge is the strip's HEIGHT: six screens of writing exported as one
 *  1800×7200 image arrives about 390px wide, which is not handwriting any more. So the
 *  fix is not a bigger export — nothing can be big enough — it is fewer normalised
 *  units per image, which is what a part is.
 *
 *  The last part is pulled UP to end at the bottom rather than left short. Parts of
 *  different heights would land at different resolutions, and the odd one out would be
 *  the END of the working — which is the answer, and the part worth reading most. */
export function exportParts(bottom: number): number[] {
  const span = exportSpan(bottom);
  if (span <= PART + 1e-9) return [0];
  const step = PART - PART_OVERLAP;
  const n = Math.ceil((span - PART) / step) + 1;
  return Array.from({ length: n }, (_, i) => Math.min(i * step, span - PART));
}

export type Tool = 'ink' | 'line' | 'rect' | 'ellipse' | 'erase';
export type Pen = 'ink' | 'accent' | 'warn' | 'danger';

export interface Stroke {
  t: Tool;
  c: Pen;
  w: number;
  /** "x,y,pressure;x,y,pressure;…" with three decimals, x normalised by width. */
  p: string;
  /** The client clock that orders strokes on the board. Written by `commit` and read by
   *  `query(strokes, orderBy('n'))`.
   *
   *  Optional because a stroke does not have one until it is committed — but a stroke
   *  being written BACK (undo of an erase, redo of a draw) must carry the one it had, or
   *  it lands outside the ordering and simply does not appear. That bug shipped for the
   *  length of one test run; the field is declared here so the type says so. */
  n?: number;
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

/** Every colour a rasterisation can come out in, as one string.
 *
 *  For cache keys. The same strokes under the other theme are a different picture, and a
 *  cache that does not know that hands back the old one — which is exactly what happened:
 *  the board kept its dark ink under the light palette and read as empty. See
 *  `themecheck.mjs`.
 *
 *  Derived from `TOKEN` rather than listing the tokens again, so a fifth pen extends the
 *  key by existing. And it reads the RESOLVED values instead of asking the media query:
 *  that is what makes it right for every way the palette can move — the OS switching, a
 *  stamped `data-theme`, the Android wrapper deciding for itself — rather than only for
 *  the one way we happen to listen for today. */
export function palette(): string {
  const cs = getComputedStyle(document.documentElement);
  return Object.values(TOKEN)
    .map((t) => cs.getPropertyValue(t).trim())
    .join('|');
}

export type Pt = { x: number; y: number; pr: number };

/** Four decimals, not three: a snapped corner sits on a multiple of the grid cell, which
 *  at most square sizes (GRID_SCALE) is not a round number. Three decimals stored 0.0625
 *  as 0.063 — half a pixel off the grid line it snapped to, which gridcheck.mjs measured.
 *  Four are within a twentieth of a pixel on a 1000px board. */
export function pack(pts: Pt[]): string {
  return pts.map((q) => `${q.x.toFixed(4)},${q.y.toFixed(4)},${q.pr.toFixed(2)}`).join(';');
}

function unpack(p: string): Pt[] {
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

/** Half the nib at mid pressure, in normalised units — how far the ink reaches past the
 *  path, which is the centre of the nib and not its edge.
 *
 *  It is derived from width() rather than written out, because it was written out: both
 *  callers below carried `(s.w * 1.025) / 2000`, and 1.025 is not a constant — it is
 *  this function's own pressure curve evaluated at 0.5. Tuning the curve would have left
 *  hit-testing and bounding boxes measuring a nib nobody draws with, and nothing would
 *  have said so. */
function half(base: number): number {
  return width(base, 0.5, 1) / 2;
}

/** A shape stroke stores two corners; the ellipse it draws is the one inscribed in them.
 *  The renderer and the hit test both need that, and deriving it twice is how the eraser
 *  ends up testing a shape nobody drew. */
function ellipseOf(a: Pt, b: Pt): { cx: number; cy: number; rx: number; ry: number } {
  return {
    cx: (a.x + b.x) / 2,
    cy: (a.y + b.y) / 2,
    rx: Math.abs(b.x - a.x) / 2,
    ry: Math.abs(b.y - a.y) / 2
  };
}

/** Points, parsed once per stroke instead of once per frame.
 *
 *  `unpack` splits a string and allocates an object per point. Doing that for every
 *  stroke on every pointer event was measured (build/strokecost.mjs) at **62% of the
 *  entire cost of a redraw** — 6.5ms of 10.5ms for 64 strokes at 12x CPU throttle, with
 *  the canvas untouched. It is pure parsing, which is why no GPU would have helped it.
 *
 *  Keyed on the stroke OBJECT, not on its string: the Firestore listener only replaces
 *  the objects whose documents actually changed, so an untouched stroke keeps its
 *  identity across snapshots and stays cached. A WeakMap means an erased stroke's points
 *  go with it. */
const ptsCache = new WeakMap<Stroke, Pt[]>();

function pointsOf(s: Stroke): Pt[] {
  let pts = ptsCache.get(s);
  if (!pts) {
    pts = unpack(s.p);
    ptsCache.set(s, pts);
  }
  return pts;
}

export function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke, w: number): void {
  const pts = pointsOf(s);
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
      const { cx, cy, rx, ry } = ellipseOf(a, b);
      ctx.ellipse(X(cx), Y(cy), X(rx), Y(ry), 0, 0, 7);
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
  const pts = pointsOf(s);
  if (s.t === 'ink' || pts.length < 2) return pts;
  const a = pts[0];
  const b = pts[pts.length - 1];
  if (s.t === 'line') return [a, b];
  if (s.t === 'rect')
    return [a, { ...a, x: b.x }, b, { ...a, y: b.y }, a];
  const { cx, cy, rx, ry } = ellipseOf(a, b);
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
  // The box first, and this is where nearly all of the work goes away. Excalidraw's
  // geometry does the same thing for the same reason: an axis-aligned box test is a few
  // comparisons against numbers that are already worked out, and it answers "no" for
  // almost every stroke on the board. Only what survives it pays for a distance
  // calculation per segment.
  const b = boxOf(s);
  if (!b) return false;
  if (x + r < b.x0 || x - r > b.x1 || y + r < b.y0 || y - r > b.y1) return false;
  const pts = outline(s);
  if (!pts.length) return false;
  const reach = r + half(s.w);
  if (pts.length === 1) return Math.hypot(x - pts[0].x, y - pts[0].y) <= reach;
  for (let i = 1; i < pts.length; i++) {
    if (toSegment(x, y, pts[i - 1], pts[i]) <= reach) return true;
  }
  return false;
}

/** The box a stroke's ink actually covers, in normalised units. */
export type Box = { x0: number; x1: number; y0: number; y1: number };

/** A stroke's box never changes — a stroke is immutable once written — so it is worked
 *  out once and kept beside the stroke, like its points. Everything that follows leans
 *  on this being free: the eraser rejects with it, the renderer culls with it, and
 *  `bounds()` walks it on every snapshot. */
const boxCache = new WeakMap<Stroke, Box | null>();

export function boxOf(s: Stroke): Box | null {
  let b = boxCache.get(s);
  if (b === undefined) {
    b = box(s);
    boxCache.set(s, b);
  }
  return b;
}

function box(s: Stroke): Box | null {
  const pts = pointsOf(s);
  if (!pts.length) return null;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const q of pts) {
    if (q.x < x0) x0 = q.x;
    if (q.x > x1) x1 = q.x;
    if (q.y < y0) y0 = q.y;
    if (q.y > y1) y1 = q.y;
  }
  // the path is the centre of the nib, so the ink reaches half a line width past it
  const h = half(s.w);
  return { x0: x0 - h, x1: x1 + h, y0: y0 - h, y1: y1 + h };
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



/** The box a whole drawing covers, or null if there is no ink. Callers use it for two
 *  things the strip made necessary: how far down the board you are allowed to scroll,
 *  and how tall an exported image has to be so nothing written low is cut off. */
export function bounds(strokes: Stroke[]): Box | null {
  let out: Box | null = null;
  for (const s of strokes) {
    const b = boxOf(s);
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
  // Only what is on screen. The board is a strip with no end, so most of what it holds
  // is above or below the window at any moment, and a stroke outside it costs a full
  // path either way — the canvas clips the pixels, not the work. tldraw calls this
  // culling and does it from a spatial index; a single band test is enough here,
  // because the strip has one axis and the box is already worked out.
  const y0 = top;
  const y1 = top + h / w;
  for (const s of strokes) {
    const b = boxOf(s);
    if (b && (b.y1 < y0 || b.y0 > y1)) continue;
    drawStroke(ctx, s, w);
  }
  if (live) drawStroke(ctx, live, w);
  ctx.restore();
}
