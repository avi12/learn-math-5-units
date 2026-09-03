/** Stroke model, packing and rendering — shared by the pad and the board.
 *
 * Coordinates are normalised against the board WIDTH and the aspect is fixed, so a
 * stroke drawn on a 2560px tablet renders identically on a 900px desktop panel. */

export const ASPECT = 1.5; // width : height

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

export function render(
  ctx: CanvasRenderingContext2D,
  strokes: Stroke[],
  live: Stroke | null,
  w: number,
  h: number,
  background?: string
): void {
  ctx.clearRect(0, 0, w, h);
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, w, h);
  }
  for (const s of strokes) drawStroke(ctx, s, w);
  if (live) drawStroke(ctx, live, w);
}
