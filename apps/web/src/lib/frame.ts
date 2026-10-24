/** What Gemini Live sees: one picture of the exam, drawn by the pad whenever Gemini asks.
 *
 * Avi: "זה צריך תמיד לשים על המסך את הקונטקסט של השאלה ... וגם שכל הקנבס יראה כדי שיוכל
 * לעקוב אחרי התרגיל בזמן אמת". So this is not a screenshot of anything. A screenshot of
 * the desktop would show whatever the window happens to show — a part of the board, the
 * toolbar, the tab strip — and the board on screen is a window onto a strip with no end.
 * The picture is composed instead, from the same strokes the board draws:
 *
 *   - the question, always, in a narrow panel on the right. The examiner's brief carries
 *     it into Gemini's conversation too (lib/live.svelte.ts), so the panel is an anchor
 *     rather than the only copy — it is what is still in front of Gemini twenty minutes
 *     into a session, after a long context may have let the opening brief go;
 *   - the WHOLE board, top to bottom, laid out in as many columns as make it largest —
 *     a strip three screens long is unreadable as one tall image and readable as two
 *     side by side. Columns run right to left, as the page reads;
 *   - or, while the pen is on the board or over it, a close-up of the board around the
 *     nib instead (`closeUp`). Avi: "keeps checking the canvas once a sec and in
 *     particular where I point the pen at" (23.10.2026). Live reads its pictures at a low
 *     resolution, so handwriting in a board of columns is a blur to it; the same lesson
 *     as interview-prep's crop to the lines around the cursor. The whole board comes
 *     back a moment after the pen goes;
 *   - what was written in the last few seconds, behind a highlighter, so a still taken
 *     once a second still says where the work just moved;
 *   - where the pen is hovering (directlink.ts carries it from the tablet), in the mark
 *     the desktop board draws (ink.ts `drawPenMark`), so "here?" has a here;
 *   - a legend for those two marks, drawn from the same code as the marks themselves.
 *
 * It follows the page's theme, like "העתק כתמונה": what Gemini sees is what the desktop
 * shows. The question panel is HTML (the exercise's MathML) rasterised through an SVG
 * <foreignObject>; an SVG image cannot reach the page's fonts, so the maths font travels
 * inside it and the Hebrew is set in a system face on both sides of the measurement. */
import type { Frame, LiveNote } from '@learn-math/shared/protocol';
import temmlCss from 'temml/dist/Temml-Latin-Modern.css?raw';
import { blobToBase64 } from './deliver';
import type { Hover } from './directlink';
import mathFontUrl from './fonts/latinmodernmath.woff2?url';
import { boxOf, drawPenMark, exportSpan, nibOf, palette, render, type Stroke } from './ink';

/** What the board hands over for one picture — see `scene()` in Surface.svelte. */
export interface Scene {
  strokes: Stroke[];
  /** the stroke in hand on the tablet, if one is being broadcast */
  wet: Stroke | null;
  /** strokes that arrived in the last few seconds */
  recent: Stroke[];
  hover: Hover;
  /** the lowest ink, normalised */
  bottom: number;
}

/** The question as the panel shows it. */
export interface Question {
  /** chapter · exercise · section */
  meta: string;
  /** the exercise as MathML-bearing HTML (Exercise.html), or a sentence when there is none */
  html: string;
  /** the newest note Gemini wrote on the board. It was written in a conversation of its
   *  own, beside Live (apps/extension/src/utils/live.ts), so Live has no memory of it —
   *  this is how Live gets to read what it "wrote" */
  note?: LiveNote;
}

/** A 16:9 still, like the screens Gemini Live is used to. 1600 wide rather than the
 *  1280 a shared screen is cut to: handwriting needs the pixels more than a UI does. */
const W = 1600;
const H = 900;
const PAD = 16;
const GAP = 14;
/** The question's column. Narrow on purpose — the brief carries the question too, and
 *  every pixel here is one the handwriting does not get. */
const PANEL = 400;
/** The legend at the foot of the panel. */
const LEGEND = 118;
/** A column's number, above it. */
const LABEL = 30;
const MAX_COLS = 4;
/** Columns overlap by this much (normalised), so a line cut by a column's edge is whole
 *  in one of the two. */
const OVERLAP = 0.05;
/** How far the highlighter reaches past a recent stroke, normalised. */
const RECENT_PAD = 0.01;
/** The pen mark's radius in the picture — large enough to survive Gemini shrinking the
 *  picture before it looks at it. */
const MARK_R = 28;
/** Where the pen points, lit: the board is drawn at its own size, and everything on it
 *  but a circle around the nib is dimmed by this much, so the one bright place in the
 *  picture is the one being pointed at — however small Live makes it. */
const SPOT_DIM = 0.55;
/** The lit circle's radius, normalised to the board's width: about a line of handwriting
 *  either side of the nib. */
const SPOT_R = 0.07;
/** How much of the board's width the close-up shows: a few words either side of the nib,
 *  drawn about twice as large as the whole board ever is. */
const ZOOM_W = 0.6;
/** How long the close-up outlasts the pen. Between a stroke and the next hover there is a
 *  moment with neither, and the picture must not flip to the whole board and back in it. */
const FOCUS_LINGER_MS = 3000;
const ZOOM_LABEL = 'מקרוב: סביב העט · כל הלוח חוזר כשהעט מתרחק';
const QUALITY = 0.82;
/** A face every Windows desktop has, with Hebrew — see the header for why not the page's. */
const FACE = '"Segoe UI", Arial, sans-serif';

/** The resolved colours of the current theme. */
function colours() {
  const cs = getComputedStyle(document.documentElement);
  const t = (name: string, or: string) => cs.getPropertyValue(name).trim() || or;
  return {
    bg: t('--bg', '#d5e4f0'),
    surface: t('--surface', '#fff'),
    fg: t('--fg', '#000'),
    muted: t('--fg-muted', '#444'),
    border: t('--border-strong', '#000'),
    // a tint by design, translucent in both themes — a highlighter that never hides ink
    recent: t('--accent-tint', 'rgb(0 179 230 / 32%)'),
    mono: t('--font-mono', 'monospace')
  };
}

/* ---- the question panel ------------------------------------------------- */

let fontData: Promise<string> | null = null;

/** The maths font as a data: URL, fetched once — the browser has it cached already. */
function mathFont(): Promise<string> {
  fontData ??= fetch(mathFontUrl)
    .then((r) => r.blob())
    .then((b) => blobToBase64(b))
    .then((b64) => `data:font/woff2;base64,${b64}`);
  return fontData;
}

/** The panel as an element, its text as large as fits `height`. Measured in the live
 *  document — the one place JS reads layout here, because what it sizes is a bitmap. */
function panelElement(q: Question, noteHtml: string, c: ReturnType<typeof colours>, height: number): HTMLElement {
  const box = document.createElement('div');
  box.dir = 'rtl';
  box.style.cssText =
    `box-sizing:border-box;width:${PANEL}px;padding:18px 20px;background:${c.surface};` +
    `border:2px solid ${c.border};color:${c.fg};font-family:${FACE}`;
  const meta = document.createElement('div');
  meta.textContent = q.meta;
  meta.style.cssText =
    `font:600 15px/1.45 ${FACE};color:${c.muted};padding-bottom:8px;margin-bottom:12px;` +
    `border-bottom:2px solid ${c.border}`;
  const text = document.createElement('div');
  text.innerHTML = q.html;
  box.append(meta, text);
  if (q.note) {
    // the note keeps the question's text size, so it is fitted along with it
    const note = document.createElement('div');
    note.style.cssText = `margin-top:14px;padding-top:10px;border-top:2px solid ${c.border}`;
    const head = document.createElement('div');
    head.textContent = `על הלוח: ${q.note.title}`;
    head.style.cssText = `font:600 15px/1.45 ${FACE};color:${c.muted};margin-bottom:4px`;
    const body = document.createElement('div');
    body.innerHTML = noteHtml;
    // full-size fractions, as the notes card sets them (LiveNotes.svelte, `math-style`)
    for (const m of body.querySelectorAll('math')) {
      m.setAttribute('displaystyle', 'true');
    }
    note.append(head, body);
    text.append(note);
  }

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-20000px;top:0;visibility:hidden;pointer-events:none';
  host.append(box);
  document.body.append(host);
  for (let size = 24; size >= 12; size--) {
    text.style.cssText = `white-space:pre-line;font-size:${size}px;line-height:1.7`;
    if (box.offsetHeight <= height) {
      break;
    }
  }

  box.style.height = `${height}px`;
  box.style.overflow = 'hidden';
  host.remove();
  return box;
}

let panelKey = '';
let panelImage: Promise<HTMLImageElement | null> = Promise.resolve(null);

/** The panel rasterised. Rebuilt only when the question or the theme changes, which is
 *  rarely — the picture is asked for every second. */
function panel(q: Question, c: ReturnType<typeof colours>, height: number): Promise<HTMLImageElement | null> {
  const key = `${palette()}|${c.surface}|${q.meta}|${q.html}|${q.note?.id ?? ''}`;
  if (key === panelKey) {
    return panelImage;
  }

  panelKey = key;
  panelImage = (async () => {
    // the note's formulas are typeset as the notes card does it — tex.ts, loaded only now
    const noteHtml = q.note ? (await import('./tex')).exerciseHtml(q.note.body) : '';
    const box = panelElement(q, noteHtml, c, height);
    // The page's own Temml stylesheet, with the font it names carried inside, and the
    // second face it declares (script capitals, rare) left to fall back.
    const css = temmlCss
      .replace(/@font-face\s*{[^}]*Temml\.woff2[^}]*}/, '')
      .replace(/url\(['"]?\.\/latinmodernmath\.woff2['"]?\)/, `url(${await mathFont()})`);
    const xhtml = new XMLSerializer().serializeToString(box);
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${PANEL}" height="${height}">` +
      `<style><![CDATA[${css}]]></style>` +
      `<foreignObject x="0" y="0" width="${PANEL}" height="${height}">${xhtml}</foreignObject></svg>`;
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await img.decode();
    return img;
  })().catch(() => null);
  return panelImage;
}

/* ---- the board ------------------------------------------------------------ */

interface Layout {
  /** columns */
  k: number;
  /** px per normalised unit */
  s: number;
  /** normalised height of one column */
  each: number;
  /** where each column starts, normalised */
  tops: number[];
  /** where a column starts across the board, and how much of its width it shows,
   *  normalised: all of it in the whole board, a window of it in the close-up */
  left: number;
  across: number;
  /** what is written over each column; nothing over the whole board in one column */
  labels: string[];
}

/** The column count that draws the board largest in a `bw`×`bh` box. */
function layout(span: number, bw: number, bh: number): Layout {
  let best: Layout = { k: 1, s: 0, each: span, tops: [0], left: 0, across: 1, labels: [] };
  for (let k = 1; k <= MAX_COLS; k++) {
    const each = k === 1 ? span : span / k + OVERLAP;
    const colW = (bw - (k - 1) * GAP) / k;
    const s = Math.min(colW, (bh - (k > 1 ? LABEL : 0)) / each);
    if (s > best.s * 1.02) {
      // evenly spaced so the last column ends exactly at the bottom of the board
      const tops = Array.from({ length: k }, (_, i) => (k === 1 ? 0 : (i * (span - each)) / (k - 1)));
      const labels = k > 1 ? tops.map((_, i) => `טור ${i + 1} מתוך ${k}`) : [];
      best = { k, s, each, tops, left: 0, across: 1, labels };
    }
  }
  return best;
}

/** The board around `at`, `ZOOM_W` of its width, filling a `bw`×`bh` box. The window
 *  stays on the board: near an edge the nib is off centre rather than the view empty. */
function closeUp({ at, span, bw, bh }: { at: { x: number; y: number }; span: number; bw: number; bh: number }): Layout {
  const s = bw / ZOOM_W;
  const each = (bh - LABEL) / s;
  const clamp = ({ v, max }: { v: number; max: number }) => Math.min(Math.max(v, 0), Math.max(max, 0));
  return {
    k: 1,
    s,
    each,
    tops: [clamp({ v: at.y - each / 2, max: span - each })],
    left: clamp({ v: at.x - ZOOM_W / 2, max: 1 - ZOOM_W }),
    across: ZOOM_W,
    labels: [ZOOM_LABEL]
  };
}

/** Where the pen was last seen, and when — see `FOCUS_LINGER_MS`. */
let lastFocus: { x: number; y: number; seen: number } | null = null;

/** Where the pen is: hovering, or the nib of the stroke in hand — and for a moment after
 *  it goes, where it was. Null once it has been gone a while: the whole board, then. */
function focusOf(scene: Scene): { x: number; y: number } | null {
  const now = performance.now();
  const nib = scene.hover ?? (scene.wet ? nibOf(scene.wet) : undefined);
  if (nib) {
    lastFocus = { x: nib.x, y: nib.y, seen: now };
    return nib;
  }

  return lastFocus && now - lastFocus.seen < FOCUS_LINGER_MS ? lastFocus : null;
}

/** The column a board point is drawn in: the one it sits most comfortably inside. */
function columnOf(y: number, l: Layout): number {
  let best = 0;
  let room = -Infinity;
  l.tops.forEach((t, i) => {
    const r = Math.min(y - t, t + l.each - y);
    if (r > room) {
      room = r;
      best = i;
    }
  });
  return best;
}

function drawLegend(ctx: CanvasRenderingContext2D, c: ReturnType<typeof colours>, x: number, y: number): void {
  ctx.save();
  ctx.fillStyle = c.surface;
  ctx.strokeStyle = c.border;
  ctx.lineWidth = 2;
  ctx.fillRect(x, y, PANEL, LEGEND);
  ctx.strokeRect(x + 1, y + 1, PANEL - 2, LEGEND - 2);
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = c.muted;
  ctx.font = `600 14px ${FACE}`;
  ctx.fillText('מקרא', x + PANEL - 20, y + 20);
  const right = x + PANEL - 20;
  const row1 = y + 54;
  const row2 = y + 92;

  drawPenMark(ctx, right - 16, row1, 11);
  ctx.fillStyle = c.fg;
  ctx.font = `600 18px ${FACE}`;
  ctx.fillText('העט מצביע כאן — האזור המואר', right - 46, row1);

  ctx.fillStyle = c.recent;
  ctx.fillRect(right - 34, row2 - 11, 36, 22);
  ctx.strokeStyle = c.fg;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(right - 29, row2 + 3);
  ctx.quadraticCurveTo(right - 20, row2 - 9, right - 13, row2 + 1);
  ctx.quadraticCurveTo(right - 8, row2 + 7, right - 3, row2 - 4);
  ctx.stroke();
  ctx.fillStyle = c.fg;
  ctx.fillText('נכתב בשניות האחרונות', right - 46, row2);
  ctx.restore();
}

/** The picture, as the Gemini client's host API hands it over. */
export async function drawFrame(scene: Scene, q: Question): Promise<Frame | null> {
  const c = colours();
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const ctx = out.getContext('2d');
  if (!ctx) {
    return null;
  }

  ctx.fillStyle = c.bg;
  ctx.fillRect(0, 0, W, H);

  // The question, on the right; its legend under it.
  const panelH = H - 2 * PAD - LEGEND - GAP;
  const px = W - PAD - PANEL;
  const img = await panel(q, c, panelH);
  if (img) {
    ctx.drawImage(img, px, PAD);
  }

  drawLegend(ctx, c, px, PAD + panelH + GAP);

  // The board, all of it — down to the stroke in hand, or the pen hovering below the ink;
  // or the part of it around the pen.
  const wetBox = scene.wet ? boxOf(scene.wet) : null;
  const span = Math.max(
    exportSpan(Math.max(scene.bottom, wetBox?.y1 ?? 0)),
    scene.hover ? scene.hover.y + 0.05 : 0
  );
  const bx = PAD;
  const bw = px - GAP - PAD;
  const bh = H - 2 * PAD;
  const at = focusOf(scene);
  const l = at ? closeUp({ at, span, bw, bh }) : layout(span, bw, bh);
  const colW = l.s * l.across;
  const colH = l.each * l.s;
  const colY = PAD + (l.labels.length ? LABEL : 0);
  /** a column's left edge: column 0 sits against the panel, the rest follow leftwards */
  const colX = (i: number) => bx + bw - (i + 1) * colW - i * GAP;

  // the board's whole width at this scale; a column shows `across` of it, from `left`
  const sheet = document.createElement('canvas');
  sheet.width = Math.ceil(l.s);
  sheet.height = Math.ceil(colH);
  const sctx = sheet.getContext('2d');
  if (!sctx) {
    return null;
  }

  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < l.k; i++) {
    const x = colX(i);
    const top = l.tops[i];
    ctx.fillStyle = c.surface;
    ctx.fillRect(x, colY, colW, colH);
    // the highlighter goes under the ink, so it is drawn on the frame first
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, colY, colW, colH);
    ctx.clip();
    ctx.fillStyle = c.recent;
    for (const s of scene.recent) {
      const b = boxOf(s);
      if (!b || b.y1 < top || b.y0 > top + l.each) {
        continue;
      }

      ctx.fillRect(
        x + (b.x0 - RECENT_PAD - l.left) * l.s,
        colY + (b.y0 - RECENT_PAD - top) * l.s,
        (b.x1 - b.x0 + 2 * RECENT_PAD) * l.s,
        (b.y1 - b.y0 + 2 * RECENT_PAD) * l.s
      );
    }
    ctx.restore();
    render(sctx, scene.strokes, scene.wet, l.s, sheet.height, undefined, top);
    ctx.drawImage(sheet, l.left * l.s, 0, colW, colH, x, colY, colW, colH);
    ctx.strokeStyle = c.border;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, colY + 1, colW - 2, colH - 2);
    const label = l.labels[i];
    if (label) {
      ctx.fillStyle = c.muted;
      ctx.font = `600 17px ${FACE}`;
      ctx.fillText(label, x + colW / 2, PAD + LABEL / 2);
    }
  }

  if (!scene.strokes.length && !scene.wet) {
    ctx.fillStyle = c.muted;
    ctx.font = `600 26px ${FACE}`;
    ctx.fillText('הלוח עוד ריק', colX(0) + colW / 2, colY + Math.min(colH, bh) / 2);
  }

  if (scene.hover) {
    const i = columnOf(scene.hover.y, l);
    const hx = colX(i) + (scene.hover.x - l.left) * l.s;
    const hy = colY + (scene.hover.y - l.tops[i]) * l.s;
    // every column, less the circle round the nib (even-odd: the circle is a hole)
    ctx.save();
    ctx.beginPath();
    for (let j = 0; j < l.k; j++) {
      ctx.rect(colX(j), colY, colW, colH);
    }
    ctx.moveTo(hx + SPOT_R * l.s, hy);
    ctx.arc(hx, hy, SPOT_R * l.s, 0, Math.PI * 2);
    ctx.globalAlpha = SPOT_DIM;
    ctx.fillStyle = c.bg;
    ctx.fill('evenodd');
    ctx.restore();
    drawPenMark(ctx, hx, hy, MARK_R);
  }

  const blob = await new Promise<Blob | null>((r) => out.toBlob(r, 'image/jpeg', QUALITY));
  if (!blob) {
    return null;
  }

  return { base64: await blobToBase64(blob), mimeType: blob.type, width: W, height: H };
}
