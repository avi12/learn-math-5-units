<script module lang="ts">
  /** What the page may ask of the board. */
  export interface SurfaceApi {
    exportCanvas(w?: number, part?: number): HTMLCanvasElement;
    showPart(i: number): void;
    flash(): void;
  }
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { BandIndex } from './bands';
  import type { Action } from './history.svelte';
  import {
    PAGE,
    PART,
    bounds,
    colour,
    decimate,
    drawStroke,
    exportParts,
    exportSpan,
    gridPhase,
    hits,
    pack,
    palette,
    render,
    snapPoint,
    type Pen,
    type Pt,
    type Stroke,
    type Tool
  } from './ink';
  import { PenDebug } from './pendebug.svelte';
  import { commit, onSnapshot, onWriteStall, orderBy, publishLive, query, remove, strokeRef, type Room } from './room';
  import { installSpen, spenHeld } from './spen';

  /** Firestore charges per write, so an in-progress stroke is only broadcast once it has
   *  run long enough to be worth watching, and then at a human frame rate. Handwriting
   *  strokes are shorter than this and cost exactly one write each, on release. */
  const LIVE_AFTER_MS = 400;
  const LIVE_EVERY_MS = 250;

  let {
    room,
    readonly = false,
    fill = false,
    tool = 'ink' as Tool,
    pen = 'ink' as Pen,
    size = 6,
    isSnapping = false,
    gridCell,
    onparts,
    onpen,
    onaction
  }: {
    room: Room;
    readonly?: boolean;
    /** Fill the flex parent instead of keeping a page-shaped box. The pad sets this so
     *  the board can never be scrolled off the screen; the desktop mirror does not. */
    fill?: boolean;
    tool?: Tool;
    pen?: Pen;
    size?: number;
    /** Shape corners land on the nearest grid crossing. Ink stays freehand: snapping
     *  handwriting to squares would turn it into staircases. */
    isSnapping?: boolean;
    /** One grid square in normalised units — the room's setting, see lib/roomvalue.svelte.ts. */
    gridCell: number;
    /** How many parts the strip exports as, and which one the view is sitting on. The
     *  toolbar needs the count to fill its picker and the index to keep it honest, and
     *  only the board knows either — how far the ink goes, and where the reader is.
     *
     *  Avi (19.09.2026): "כשאני גולל בקנבס בדסקטופ, ה‑select של החלק הנוכחי להעתיק
     *  כתמונה צריך להתעדכן בהתאם". The picker used to be a value the toolbar held on its
     *  own, so scrolling left it pointing at a part that was no longer on the screen. */
    onparts?: (n: number, at: number) => void;
    /** Pen on the glass, pen off it. Recognition debounces on this and not on committed
     *  strokes: a stroke only lands after it is finished, so a listener that hears only
     *  landings cannot tell "still writing" from "done writing". */
    onpen?: (down: boolean) => void;
    /** One completed thing the hand did, for the undo stack. A draw carries the stroke
     *  it made; an erase carries every stroke that gesture removed, which is the whole
     *  reason this is an action and not a stroke. */
    onaction?: (a: Action) => void;
  } = $props();

  /** `?pendebug`: what the pen reported, printed on the board. See lib/pendebug.svelte.ts. */
  const debug = new PenDebug();

  let host = $state<HTMLDivElement>();
  let canvas = $state<HTMLCanvasElement>();
  let ctx: CanvasRenderingContext2D | null = null;

  /** Committed strokes, in insertion order, keyed so undo can remove the last one. */
  let order = $state<string[]>([]);
  const byKey = new Map<string, Stroke>();
  let live = $state<Stroke | null>(null);
  /** A listener that dies must say so — a silent one looks exactly like an empty board. */
  let fault = $state('');
  /** And a listener that lives while every write is refused says nothing at all, which
   *  is worse: the board looks right, the other device sees none of it. See the stall
   *  clock in room.ts for why the write promise is the only thing that catches this. */
  let stalled = $state(false);

  // local drawing state
  let drawing = false;
  let pts: Pt[] = [];
  let penSeen = 0;
  let lastPublish = 0;
  let startedAt = 0;
  let publishedLive = false;

  /** The rubber's position while it is on the glass, so it can be drawn. */
  let rubber = $state<Pt | null>(null);
  /** Strokes already sent to be deleted. The snapshot that removes them takes a moment
   *  to come back, and without this the same stroke is deleted once per pointer move. */
  const erased = new Set<string>();

  /** The y at the top edge of the viewport, in normalised units — the whole of scrolling.
   *  0 is the top of the board and it never goes negative: there is nothing above the
   *  first line, and letting it drift up would lose the one landmark the board has.
   *
   *  Avi, 19.09.2026: "הרגע ביצעתי בקנבס בטבלט עריכה וזה גרם לקנבס בדסקטופ
   *  לגלול פתאום לטופ". He had scrolled the desktop there himself, and it went to the
   *  very beginning of the board.
   *
   *  The ceiling is not a constant: `maxTop` is half a screen past the LOWEST stroke, so
   *  rubbing out the bottom of a short board drops it to zero. Every snapshot used to
   *  clamp `top` against it, which means an edit made on one device silently repositioned
   *  the other. A ceiling is there to stop you ASKING to go somewhere; it has no business
   *  moving a view that is already parked. So the clamp now lives in `scrollTo` alone, and
   *  a snapshot moves this only for the two reasons a mirror legitimately moves: the
   *  writer has gone off the bottom of the screen, or there is no ink left at all. */
  let top = $state(0);
  /** Is the mirror still riding the bottom of the strip, rather than sitting where a
   *  reader put it? It starts true — a desktop that has just been opened should show
   *  where the writing is — and a deliberate scroll away from the end turns it off, a
   *  deliberate scroll back to the end turns it on again. The same rule a log tail uses,
   *  and for the same reason: following is a courtesy, and the moment someone takes hold
   *  of the view it stops being one. Without this, every stroke made on the tablet
   *  snatched the desktop back down to the bottom. */
  let stick = true;
  /** How tall the viewport is in those same units. Not a constant any more: the board
   *  is now whatever box the layout hands it, so this is measured in fit(). */
  let viewH = $state(PAGE);
  /** The board's width in CSS px — what the grid squares are measured against. */
  let boardWidth = $state(0);
  /** Redraw ceiling and rail geometry both need the lowest ink; recomputing it on every
   *  pointer move would walk every stroke, so it is cached and refreshed on commit. */
  let inkBottom = $state(0);

  /** What the board draws. `erased` is subtracted HERE, and that is what makes rubbing
   *  out instant: a stroke under the rubber leaves the picture on the same frame as the
   *  rub, not when Firestore says so. It used to stay on screen until the delete came
   *  back, and the bigger the board the longer that took — which is exactly what
   *  "ככל שהקנבס יותר גדול כך יקח יותר זמן להחיל את העריכה" was. */
  function strokes(): Stroke[] {
    const out: Stroke[] = [];
    for (const k of order) {
      const s = erased.has(k) ? undefined : byKey.get(k);
      if (s) {
        out.push(s);
      }
    }
    return out;
  }

  function measure() {
    inkBottom = bounds(strokes())?.y1 ?? 0;
  }

  /** How far down you may scroll. Always half a screen past the lowest ink, so there is
   *  fresh paper under what you just wrote — write into it and the ceiling moves again.
   *  That is what makes the board endless without ever scrolling into empty nowhere. */
  function maxTop(): number {
    return Math.max(0, inkBottom - viewH / 2);
  }

  /** An explicit move by whoever is holding the device — a wheel, two fingers, the rail.
   *  This is the one place the ceiling applies, because this is the one place someone is
   *  ASKING to go somewhere. Erasing can still leave a parked view below the ceiling; the
   *  next deliberate scroll brings it back inside, which is the right moment for it. */
  /** A scroll position on a whole device pixel. The dry bitmap is blitted at
   *  `top - dryTop`, and a blit can only land on whole pixels — so a position between two
   *  of them would leave the ink up to half a pixel off the CSS grid behind it, and a
   *  snapped line has to sit ON the grid line (gridcheck.mjs). Positions that are whole
   *  to begin with make every blit exact, with nothing to correct afterwards. */
  function onRow(v: number): number {
    const perUnit = boardWidth * devicePixelRatio;
    return perUnit ? Math.round(v * perUnit) / perUnit : v;
  }

  function scrollTo(v: number) {
    const next = onRow(Math.max(0, Math.min(maxTop(), v)));
    // Set even when the position does not change, so that scrolling down into the end
    // re-arms following whether or not the view had anywhere left to move.
    stick = next >= maxTop() - viewH * 0.1;
    if (next === top) {
      return;
    }

    top = next;
    paint();
  }

  function scrollBy(dy: number) {
    scrollTo(top + dy);
  }

  /* ---- dry ink -------------------------------------------------------------
     Everything already committed, rasterised once and blitted after that. The pointer
     path stops being O(strokes) and becomes one drawImage plus the stroke in hand.

     `dryKey` is every input the rasterisation depends on. Miss one and the board shows a
     stale picture, which is far worse than a slow one — so it is deliberately coarse:
     what was written, the pixel size, and the palette. The scroll offset is not in it:
     the bitmap covers more than the view (OVERSCAN below), and scrolling within it is
     a blit at an offset. Only scrolling out of it rebuilds.

     The palette was the one that was missed, and it cost exactly what the paragraph above
     predicts. On a theme change the listener called `paint()`, `paint()` found the key
     unchanged and blitted the bitmap it already had, and the board sat there with the
     other theme's ink on it — near-white on the light surface, near-black on the dark
     one, invisible either way. Scrolling moved `top`, which (back then) moved the key, which
     is why it looked like scrolling repaired it. `themecheck.mjs` holds the line. */
  /** Every change the dry cache cannot see from `top`, the canvas size and the palette:
   *  strokes arriving, strokes leaving, and strokes the rubber has just hidden.
   *
   *  It replaces `order.join('|')`, which built a string as long as the whole board on
   *  EVERY paint — that is, on every pointer move, which is the one place the board
   *  cannot afford work proportional to how much has been written. */
  let inkVersion = 0;

  /** Bumped only when the SET of strokes changes — which is what the band index below is
   *  built from. It is separate from `inkVersion` on purpose: that one also moves when
   *  the rubber hides something, and rebuilding the index on every rub would put the
   *  whole board back into the middle of the gesture. */
  let orderVersion = 0;

  /** How far past each edge of the view the dry bitmap reaches, as a share of the board's
   *  WIDTH. The bitmap is rasterised for the window [top - margin, top + view + margin],
   *  and scrolling inside that window is a blit at an offset - no stroke is touched. Only
   *  leaving it re-rasterises, and then around the new position.
   *
   *  Width and not view height, because the view height is not a size anyone chose: the
   *  tablet's board is 728x150, so half a VIEW was 75px and every second wheel notch fell
   *  out of the window. Half a width is a few lines of handwriting on both devices, and
   *  the bitmap stays small enough for a 2017 tablet (about 10MB there). */
  const OVERSCAN = 0.5;

  let dry: HTMLCanvasElement | null = null;
  let dryCtx: CanvasRenderingContext2D | null = null;
  let dryKey = '';
  /** The normalised y that the dry bitmap's first row shows. */
  let dryTop = 0;

  /** Make sure the dry bitmap covers the view, and return the row (device px) the view
   *  starts at inside it. */
  function paintDry(w: number): number {
    const view = canvas!.height;
    const margin = Math.round(canvas!.width * OVERSCAN);
    const scale = w * devicePixelRatio; // device px per normalised unit
    // `top` is NOT in the key: moving inside the window is what the window is for.
    const key = `${inkVersion}@${canvas!.width}x${view}@${palette()}`;
    // Whole already, because `top` is (onRow); the round only absorbs float error.
    const at = Math.round((top - dryTop) * scale);
    if (key === dryKey && dry && at >= 0 && at + view <= dry.height) {
      return at;
    }

    if (!dry) {
      dry = document.createElement('canvas');
      dryCtx = dry.getContext('2d');
    }
    // Resizing clears the bitmap, so only touch it when it is actually wrong.
    if (dry.width !== canvas!.width || dry.height !== view + 2 * margin) {
      dry.width = canvas!.width;
      dry.height = view + 2 * margin;
      dryCtx = dry.getContext('2d');
      dryCtx?.scale(devicePixelRatio, devicePixelRatio);
    }
    if (!dryCtx) {
      return 0;
    }

    // A WHOLE number of device rows above the view, like every scroll position, so every
    // later blit lands exactly. Near the head of the board there is less than a margin
    // above y=0, and the rows go below instead.
    const above = Math.min(margin, Math.floor(top * scale));
    dryTop = top - above / scale;
    render(dryCtx, strokes(), null, w, dry.height / devicePixelRatio, undefined, dryTop);
    dryKey = key;
    return above;
  }

  function paint() {
    if (!ctx || !canvas) {
      return;
    }

    const w = canvas.width / devicePixelRatio;
    const h = canvas.height / devicePixelRatio;
    const at = paintDry(w);
    ctx.clearRect(0, 0, w, h);
    if (dry) {
      ctx.drawImage(dry, 0, at, canvas.width, canvas.height, 0, 0, w, h);
    }

    // The stroke in hand, and the one that has been committed but whose document has not
    // come back from Firestore yet. Drawing the second is what removes the blank frame.
    const wet = live ?? pending?.stroke ?? null;
    if (!wet && !rubber) {
      return;
    }

    ctx.save();
    ctx.translate(0, -top * w);
    if (wet) {
      drawStroke(ctx, wet, w);
    }

    if (rubber) {
      ctx.strokeStyle = colour('ink');
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(rubber.x * w, rubber.y * w, radius() * w, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }

  /** The rubber follows the thickness slider: the same control that says how wide the
   *  pen writes says how much of it comes off. */
  function radius(): number {
    return 0.006 + (size * 2.2) / 1000;
  }

  /** Rub out every stroke under the rubber. Whole strokes — see `hits` in ink.ts. */
  /** What THIS rubber gesture has taken out so far. One press-to-lift is one undo
   *  step: rubbing over five strokes and lifting is one thing the hand did, and putting
   *  back one of the five would be a strange thing to offer. */
  let erasedNow: { key: string; stroke: Stroke }[] = [];

  /** Which strokes are near the rubber; rebuilt only when the SET of strokes changes. */
  const index = new BandIndex();

  /** Rub out every stroke under the rubber. It asks the index for the strokes near the
   *  rubber instead of asking the whole board — see lib/bands.ts. */
  function rub(p: Pt) {
    const r = radius();
    index.update(orderVersion, order, byKey);
    for (const k of index.near(p.y - r, p.y + r)) {
      const s = erased.has(k) ? undefined : byKey.get(k);
      if (!s || !hits(s, p.x, p.y, r)) {
        continue;
      }

      erased.add(k);
      erasedNow.push({ key: k, stroke: s });
      inkVersion++;
    }
  }

  /** The sweep is a proposal until the pen lifts — tldraw's rule, and it is about this
   *  exact moment. Writing one delete per stroke AS it is touched costs a round trip and
   *  a snapshot each, in the middle of the gesture: every one of those snapshots rebuilds
   *  `order`, re-measures the ink and repaints, while the hand is still moving. Now the
   *  gesture only hides them, and the writes go out together when it ends. */
  function flushErase() {
    if (!erasedNow.length) {
      return;
    }

    for (const it of erasedNow) {
      void remove(strokeRef(room.id, it.key));
    }

    onaction?.({ kind: 'erase', items: erasedNow });
    erasedNow = [];
  }

  /** The canvas's CONTENT box on screen — inside its 2px border.
   *
   *  The one box every coordinate is measured in: the bitmap is sized to it, the pen is
   *  normalised against it, and the grid squares (a CSS background, which starts at the
   *  padding edge) are drawn from its corner. Avi, 03.10.2026: "נראה שהקו לא נצמד
   *  למשבצת כמו שצריך — זה צריך להיות על הקו עצמו". All three used to measure different
   *  boxes — the grid from inside the border, the pen and the bitmap from outside it, and
   *  the bitmap then squeezed 4px narrower and 4px shorter to fit — so a corner snapped
   *  exactly onto a crossing was drawn up to ~4px off the line it was snapped to, by a
   *  different amount on each axis and more the further it was from the top left. */
  function view(): { left: number; top: number; width: number; height: number } {
    const r = canvas!.getBoundingClientRect();
    return {
      left: r.left + canvas!.clientLeft,
      top: r.top + canvas!.clientTop,
      width: canvas!.clientWidth,
      height: canvas!.clientHeight
    };
  }

  function fit() {
    if (!canvas || !host) {
      return;
    }

    // The canvas's size is the layout's business (CSS): fill mode takes the box the page
    // leaves it, the mirror is a 3:2 page through the host's aspect-ratio. Here it is only
    // read, to size the bitmap behind it.
    const { width: w, height: h } = view();
    if (!w || !h) {
      return;
    }

    canvas.width = Math.round(w * devicePixelRatio);
    canvas.height = Math.round(h * devicePixelRatio);
    ctx = canvas.getContext('2d');
    ctx?.scale(devicePixelRatio, devicePixelRatio);
    viewH = h / w;
    boardWidth = w;
    top = onRow(top);
    paint();
  }

  /** A listener that dies must say so — on the board, not only in the console. */
  function failed(name: string): (e: { code?: string; message: string }) => void {
    return (e) => {
      fault = e.code || e.message;
      console.error(`[pad] ${name} listener failed`, e);
    };
  }

  onMount(() => {
    fit();
    const ro = new ResizeObserver(fit);
    if (host) {
      ro.observe(host);
    }


    const offAdd = onSnapshot(query(room.strokes, orderBy('n')), (snap) => {
      for (const ch of snap.docChanges()) {
        if (ch.type === 'removed') {
          byKey.delete(ch.doc.id);
          erased.delete(ch.doc.id);
        } else {
          byKey.set(ch.doc.id, ch.doc.data() as Stroke);
          // Undo of an erase writes the stroke back under its own id. If its delete has
          // not echoed yet the key is still in `erased`, and `strokes()` would go on
          // hiding a stroke that is demonstrably there. A document that exists is not
          // erased — that is the invariant, and this is where it is kept.
          erased.delete(ch.doc.id);
        }
      }
      order = snap.docs.map((d) => d.id);
      inkVersion++;
      orderVersion++;
      if (pending && byKey.has(pending.key)) {
        pending = null;
      }

      fault = '';
      measure();
      // The mirror follows the writer down the strip. Without this the desktop shows the
      // top of the board for ever while the tablet is three screens below it, which is
      // the one thing a mirror must not do.
      //
      // Only downwards, and only while it is still riding the end. Downwards is "the
      // writer has gone somewhere you cannot see"; upwards would be an edit taking a
      // reader's view away from them, which is the bug Avi reported. So an erase moves
      // nothing here — the ink that is left is exactly where it was, and the blank paper
      // under it is what the board now looks like.
      if (readonly && stick && inkBottom > top + viewH) {
        top = onRow(inkBottom - viewH * 0.75);
      }

      // Nothing left on the board. Here there is no position worth keeping — every row
      // is identical blank paper — and staying put would read as a board that failed to
      // load rather than one that was cleared.
      if (!order.length) {
        top = 0;
      }

      paint();
    }, failed('strokes'));
    const offStall = onWriteStall((v) => (stalled = v));
    const offLive = onSnapshot(room.live, (snap) => {
      // ignore the echo of our own in-progress stroke
      if (drawing) {
        return;
      }

      live = snap.exists() ? (snap.data() as Stroke) : null;
      paint();
    }, failed('live'));

    // The probe is the only way to see what a pen reports on a device that cannot be
    // driven from here, so the wrapper's raw integers go straight into it.
    const offSpen = installSpen((down, r) => debug.wrapper(down, r));

    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', paint);

    const offDebug = debug.listen();

    return () => {
      ro.disconnect();
      offAdd();
      offLive();
      offStall();
      offSpen();
      mq.removeEventListener('change', paint);
      offDebug();
    };
  });

  /** Where a point of the stroke in hand lands: on a grid crossing for a shape when
   *  snapping is on, exactly under the pen otherwise. The one place that decides it,
   *  so the corner a shape starts from and the corner it ends on follow the same rule. */
  function place(point: Pt): Pt {
    if (!isSnapping || acting === 'ink') {
      return point;
    }

    return snapPoint(point, gridCell);
  }

  function at(e: PointerEvent): Pt {
    const v = view();
    return {
      x: (e.clientX - v.left) / v.width,
      y: (e.clientY - v.top) / v.width + top,
      pr: e.pressure
    };
  }

  /** Pointer capture keeps events coming while the pointer is off the element — useful,
   *  but not load-bearing. It throws NotFoundError when the pointer has already ended,
   *  which happens on a very fast tap, and an uncaught throw here loses the whole
   *  pointerdown: no stroke, no rail drag, nothing, from an optimisation failing. */
  function capture(el: Element, id: number) {
    try {
      el.setPointerCapture(id);
    } catch {
      /* the pointer is gone; the handler carries on without capture */
    }
  }

  /** The tool this stroke is actually using, which is not always the tool on the toolbar:
   *  the S Pen's side button turns any stroke into an erase. Latched at pointerdown and
   *  held for the whole stroke — "touch while holding the button" is the gesture, so
   *  letting go of the button halfway must not turn the rubber back into a pen. */
  let acting: Tool = 'ink';

  /** Is this pointer asking to erase?
   *
   *  Pointer Events puts the barrel button — the S Pen's side button — in bit 1 of
   *  `buttons`, so a tip on the glass with the button held reads as 3, and the button
   *  without the tip reads as 2. Bit 5 is the eraser end, which is what Android reports
   *  when a stylus button switches the tool type instead of setting a button. `button`
   *  carries the same news at the moment of the press: 2 for the barrel, 5 for the
   *  eraser. Every one of them is asked about because every one of them means "rub out",
   *  and which one a device sends is the device's business.
   *
   *  Deliberately NOT restricted to pointerType 'pen': a stylus that Android hands over
   *  as a mouse would silently lose the gesture, and the only thing this costs is that a
   *  right-drag on a desktop erases too — which is a reasonable reading of a right-drag
   *  on a whiteboard, and the canvas already suppresses the context menu. Touch is
   *  excluded because a second finger there means panning. */
  function erasingWith(e: PointerEvent): boolean {
    if (e.pointerType === 'touch') {
      return false;
    }

    // spenHeld() is the native wrapper's answer, and it is the only one that works on
    // Android: Chrome eats a stylus-button touch before the page can see it, so inside
    // the wrapper every one of the tests below reads false and this one carries it.
    return (
      spenHeld() ||
      !!(e.buttons & 2) ||
      !!(e.buttons & 32) ||
      e.button === 2 ||
      e.button === 5
    );
  }

  /** Palm rejection: once a pen has touched the glass, ignore finger input for a while. */
  function rejected(e: PointerEvent): boolean {
    if (e.pointerType === 'pen') {
      penSeen = performance.now();
      return false;
    }
    return e.pointerType === 'touch' && performance.now() - penSeen < 1500;
  }

  /* ---- panning -------------------------------------------------------------
     The canvas has touch-action: none, because a finger on it has to draw. So the
     browser's own scrolling is not available here and every way of moving down the
     strip has to be built: two fingers, the wheel, and the rail beside the board.

     Two fingers is the one that has to work while writing, so it is tracked ahead of
     palm rejection — a second finger arriving is never a palm, and rejecting it would
     leave a pen user with no gesture at all. A stroke already in progress is thrown
     away rather than committed: the hand that starts panning did not mean to draw. */
  /** A stroke that is committed but not yet echoed back by Firestore. It keeps being
   *  drawn as wet ink until its document shows up, so the handoff has no gap. */
  let pending: { key: string; stroke: Stroke } | null = null;

  const touches = new Map<number, number>(); // pointerId -> clientY
  let panning = false;
  let panFrom = 0;

  function avgTouchY(): number {
    let sum = 0;
    for (const y of touches.values()) {
      sum += y;
    }
    return sum / touches.size;
  }

  /** The stroke in hand, as it would be stored. */
  function strokeOf(points: Pt[]): Stroke {
    return { t: acting, c: pen, w: size, p: pack(points) };
  }

  /** Let go of the stroke in hand without keeping it — and take back its live preview
   *  from the other device, if one was ever sent (that saves a delete per short stroke). */
  function dropWet() {
    pts = [];
    live = null;
    if (publishedLive) {
      publishLive(room, null);
    }

    publishedLive = false;
  }

  function abandonStroke() {
    if (!drawing) {
      return;
    }

    drawing = false;
    onpen?.(false);
    // A pan is not a reason to give back ink that was genuinely rubbed out — the hand
    // did that on purpose, and the deletes are only waiting for a lift that is now not
    // coming. Without this they would wait for ever and come back on the next reload.
    if (acting === 'erase') {
      flushErase();
    }

    dropWet();
    rubber = null;
    paint();
  }

  function wheel(e: WheelEvent) {
    if (maxTop() <= 0) {
      return;
    }

    e.preventDefault();
    scrollBy(e.deltaY / view().width);
  }

  function down(e: PointerEvent) {
    if (e.pointerType === 'touch') {
      // A pointerup that never arrives — a finger lifted off the edge of the glass, a
      // cancel the browser eats — would leave a ghost in this map, and from then on the
      // very next single touch would count as the second finger and pan instead of
      // writing. It is not a rare case and it is silent, so the map self-heals here:
      // isPrimary means this is the first pointer of a gesture, which is exactly the
      // moment nothing else can legitimately be down.
      if (e.isPrimary) {
        touches.clear();
      }

      touches.set(e.pointerId, e.clientY);
      if (touches.size >= 2) {
        abandonStroke();
        panning = true;
        panFrom = avgTouchY();
        return;
      }
    }
    if (readonly || rejected(e)) {
      return;
    }

    e.preventDefault();
    acting = erasingWith(e) ? 'erase' : tool;
    debug.note(`down→${acting}`, e);
    capture(canvas!, e.pointerId);
    drawing = true;
    onpen?.(true);
    if (acting === 'erase') {
      erasedNow = [];
      rubber = at(e);
      rub(rubber);
      paint();
      return;
    }
    startedAt = performance.now();
    publishedLive = false;
    pts = [place(at(e))];
    live = strokeOf(pts);
    paint();
  }

  function move(e: PointerEvent) {
    if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
      touches.set(e.pointerId, e.clientY);
    }

    if (panning) {
      if (touches.size < 2) {
        return;
      }

      e.preventDefault();
      const now = avgTouchY();
      scrollBy((panFrom - now) / view().width);
      panFrom = now;
      return;
    }
    if (!drawing) {
      return;
    }

    e.preventDefault();
    // The button does not always arrive on pointerdown. Chrome can report the barrel a
    // move or two after contact, and a gesture that only counted it at touch-down would
    // then write instead of erasing — which is exactly what "the button does nothing"
    // looks like. So the stroke may still become an erase; it never becomes a pen again.
    if (acting !== 'erase' && erasingWith(e)) {
      debug.note('move→erase', e);
      acting = 'erase';
      erasedNow = [];
      dropWet();
    } else if ((e.buttons & ~1) !== 0) {
      debug.note('move', e);
    }
    if (acting === 'erase') {
      // every coalesced point, so a fast sweep does not step over a thin stroke
      for (const q of coalesced(e)) {
        rub(at(q));
      }

      rubber = at(e);
      paint();
      return;
    }
    for (const q of coalesced(e)) {
      pts.push(at(q));
    }

    if (acting !== 'ink') {
      pts = [pts[0], place(pts[pts.length - 1])];
    }

    live = strokeOf(pts);
    paint();
    const now = performance.now();
    if (now - startedAt <= LIVE_AFTER_MS || now - lastPublish <= LIVE_EVERY_MS) {
      return;
    }

    lastPublish = now;
    publishedLive = true;
    publishLive(room, strokeOf(decimate(pts)));
  }

  /** Every point the pointer passed since the last event — a fast stroke is many. */
  function coalesced(e: PointerEvent): PointerEvent[] {
    return e.getCoalescedEvents?.() ?? [e];
  }

  function up(e: PointerEvent) {
    touches.delete(e.pointerId);
    if (panning) {
      // one finger left of a two-finger pan is not a stroke: wait for the glass to clear
      if (touches.size === 0) {
        panning = false;
      }
      return;
    }

    if (!drawing) {
      return;
    }

    drawing = false;
    onpen?.(false);
    canvas!.releasePointerCapture?.(e.pointerId);
    if (acting === 'erase') {
      rubber = null;
      flushErase();
      paint();
      return;
    }
    const s = strokeOf(decimate(pts));
    dropWet();
    // Hold the finished stroke on screen under its own id until the snapshot carrying it
    // arrives. Clearing `live` and waiting left one frame with the stroke on neither
    // surface — measured, every stroke, 3 runs of 3 (dryflicker.mjs). Windows ships
    // `InkSynchronizer` for precisely this instant; this is the same contract, kept by
    // not letting go of the wet stroke until the dry one is really there.
    if (s.p) {
      // The record `commit` hands back, not the stroke that went in: it carries the `n`
      // the document was stored with, and a redo that writes the stroke back without it
      // lands outside `orderBy('n')` and restores nothing.
      const rec = commit(room, s);
      pending = rec;
      onaction?.({ kind: 'draw', items: [rec] });
    }
    paint();
  }

  /** The drawing as one image — this is what "העתק כתמונה" puts on the clipboard.
   *
   *  It grows with the writing instead of being one page: a strip three screens long
   *  exported at a fixed 3:2 would silently paste the first screen and drop the rest,
   *  which is worse than an error because the picture looks complete. One page stays
   *  the floor, so a short drawing exports exactly as it always did.
   *
   *  With `part`, one page-sized slice of that strip instead — see `exportParts`. The
   *  whole-strip export is unchanged and is still the default; parts are the answer to
   *  what a conversation does to a very tall image, not a replacement for it.
   *
   *  `inkBottom` and not a fresh `bounds()`: it is that same measurement, cached, and it
   *  is refreshed on the snapshot that changes the ink — so the two cannot drift, and
   *  the button does not walk every point of every stroke on its way to the clipboard. */
  export function exportCanvas(w = 1800, part?: number): HTMLCanvasElement {
    const out = document.createElement('canvas');
    const span = exportSpan(inkBottom);
    const whole = part === undefined;
    const from = whole ? 0 : partTop(part);
    out.width = w;
    // `min` only matters for a strip shorter than one part, where there is a single part
    // and the button that would ask for it is not on screen — but a part with empty space
    // under it is not what anyone meant by "this part".
    out.height = Math.round((whole ? span : Math.min(PART, span)) * w);
    const c = out.getContext('2d')!;
    render(
      c,
      strokes(),
      null,
      w,
      out.height,
      getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || '#fff',
      from
    );
    return out;
  }

  /** Scroll the mirror to the top of a part. The desktop cannot see what part 3 of 9
   *  holds, and a button that copies something invisible is a button you have to trust;
   *  moving the board to it turns the press into something you can check. */
  export function showPart(i: number) {
    scrollTo(partTop(i));
  }

  /** Where part `i` starts — any index, clamped onto the parts there are. */
  function partTop(i: number): number {
    return partTops[Math.min(Math.max(i, 0), partTops.length - 1)];
  }


  /* ---- the capture gesture --------------------------------------------------
     Pressing "העתק כתמונה" changed nothing on the board. A toast appeared a few hundred
     pixels away and said it worked — but the thing that was copied, the board itself,
     did not react at all, so the press had no answer where the eye was. This is the
     answer: the board acknowledges being read. */

  /** A counter, not a boolean. Copying twice in a row has to replay the gesture, and a
   *  boolean that is already `true` changes nothing, so nothing would restart. A new
   *  number remounts the overlay through `{#key}`, and a fresh element is what makes
   *  CSS animations run again. */
  let shot = $state(0);

  /** Called the moment the canvas is read, not when the clipboard answers: the capture
   *  is what happened, and whether the clipboard took it is what the toast is for. */
  export function flash() {
    shot++;
  }


  /* ---- the rail ------------------------------------------------------------
     A pen has no second finger and no wheel, so the board needs something a nib can
     land on. The rail is that, and it doubles as the only answer to "how much did I
     write below here" — on a strip with no page breaks there is otherwise nothing on
     screen that says the drawing continues. It appears only once it means something. */
  const total = $derived(Math.max(viewH, inkBottom + viewH / 2));
  const scrollable = $derived(maxTop() > 0.001);
  /** The smallest slice of the rail the grip is allowed to be. Ten screens down the strip
   *  its true share is a sliver, and a sliver is not something a nib can land on.
   *
   *  It is a fraction and not a pixel count on purpose: both numbers below are shares of
   *  the rail, so the floor has to be one too or the position cannot allow for it. That
   *  is exactly what went wrong — the height was floored here while the position was not,
   *  so at the bottom of a long strip `top / total` put the grip's TOP where a grip of
   *  the true height belonged, and the floored extra hung off the end of the rail, out
   *  through the board's border and into the page. `railcheck.mjs`. */
  const GRIP_MIN = 0.12;
  const gripFrac = $derived(Math.max(GRIP_MIN, viewH / total));
  const gripH = $derived(`${gripFrac * 100}%`);
  const gripTop = $derived(`${Math.min(top / total, 1 - gripFrac) * 100}%`);

  /** Pushed out rather than pulled in: how far the ink goes is the board's own
   *  measurement, refreshed on every snapshot, and the toolbar only needs the numbers. */
  const partTops = $derived(exportParts(inkBottom));
  const partCount = $derived(partTops.length);
  /** Which part the view is on — read off the SAME map the export cuts by, so choosing
   *  part 3 scrolls somewhere the picker then reads back as part 3 and stays put. A
   *  second mapping here would drift from that one the first time either changed.
   *
   *  Nearest top rather than "the part containing this y": parts overlap, so a y can sit
   *  in two of them, and nearest is the one that makes the picker flip at the midpoint
   *  between two parts instead of clinging to the earlier one all the way through. */
  const partAt = $derived.by(() => {
    let best = 0;
    for (let i = 1; i < partTops.length; i++) {
      if (Math.abs(partTops[i] - top) < Math.abs(partTops[best] - top)) {
        best = i;
      }
    }
    return best;
  });
  $effect(() => onparts?.(partCount, partAt));

  let rail = $state<HTMLDivElement>();
  let railing = false;

  /** Land anywhere on the rail and the view centres there — a nib does not drag well. */
  function railTo(clientY: number) {
    if (!rail) {
      return;
    }

    const r = rail.getBoundingClientRect();
    const frac = (clientY - r.top) / r.height;
    scrollTo(frac * total - viewH / 2);
  }

  function railDown(e: PointerEvent) {
    e.preventDefault();
    railing = true;
    if (rail) {
      capture(rail, e.pointerId);
    }

    railTo(e.clientY);
  }

  function railMove(e: PointerEvent) {
    if (railing) {
      railTo(e.clientY);
    }
  }

  function railUp(e: PointerEvent) {
    railing = false;
    rail?.releasePointerCapture?.(e.pointerId);
  }
</script>

<!-- ABOVE the board, not over it. The first version was absolutely positioned across
     the top of the canvas, and Avi's screenshot showed it sitting on the top line of his
     own working — a message about writing not being saved, covering the writing. There is
     no safe place to float over a board whose whole purpose is that the person filled it.
     So it takes its own row: the board is 44px shorter while this is up, and nothing the
     person wrote is ever behind it. -->
{#if stalled}
  <p class="stall" role="status">
    השרת לא מקבל את הכתיבה — מה שנכתב כאן נשאר במכשיר הזה בלבד
    <span>בדקו רשת. אם הרשת תקינה, מכסת Firestore היומית נגמרה ומתאפסת בחצות שעון פסיפיק.</span>
  </p>
{/if}
<div class="host" class:fill bind:this={host}>
  <canvas
    bind:this={canvas}
    class:erasing={tool === 'erase' && !readonly}
    class:readonly
    style:--grid-cell="{gridCell * boardWidth}px"
    style:--grid-y="{-gridPhase(top, gridCell) * boardWidth}px"
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
    onpointerleave={up}
    onwheel={wheel}
    oncontextmenu={(e) => e.preventDefault()}
  ></canvas>
  {#if debug.lines.length}
    <div class="probe">
      {#each debug.lines as line (line)}<span>{line}</span>{/each}
    </div>
  {/if}
  {#if scrollable}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      class="rail"
      bind:this={rail}
      role="scrollbar"
      aria-controls="board"
      aria-orientation="vertical"
      aria-valuenow={Math.round((top / total) * 100)}
      tabindex="-1"
      onpointerdown={railDown}
      onpointermove={railMove}
      onpointerup={railUp}
      onpointercancel={railUp}
    >
      <div class="grip" style:top={gripTop} style:height={gripH}></div>
    </div>
  {/if}
  <!-- Last child on purpose: nothing here is positioned above anything by z-index, so
       paint order is DOM order, and the gesture has to land over the board. -->
  {#key shot}
    {#if shot}
      <div class="shot" aria-hidden="true"></div>
    {/if}
  {/key}
  {#if fault}
    <p class="empty fault">אין חיבור לבסיס הנתונים ({fault}). בדוק רשת או חוסם פרסומות.</p>
  {:else if readonly && order.length === 0 && !live}
    <p class="empty">אין עדיין כלום. פתח את הכתובת הזאת בטאבלט והתחל לכתוב.</p>
  {/if}
</div>

<style>
  /* Two shapes, one component.

     `fill` is the pad: the board takes the whole box the layout leaves it and never
     moves, because the page around it does not scroll at all any more. That replaces the
     old arrangement, where the board was capped at 66% of the viewport height purely so
     there would be margin left over for a finger to scroll the PAGE on — the toolbar and
     the formula bar lived below the fold. Now nothing lives below the fold, the leftover
     margin has no job, and the height it was giving up goes back to the writing.

     Without `fill` it is the desktop mirror, still a page-shaped 3:2 block in a normal
     scrolling document. The ratio is `--aspect`, which the page sets from ink.ts's ASPECT
     on the element around this component, so the host and the stall banner share it. */
  .host {
    position: relative;
    width: 100%;
    max-width: calc(66vh * var(--aspect));
    margin-inline: auto;
    aspect-ratio: var(--aspect);
  }
  @supports (height: 1svh) {
    .host:not(.fill) {
      max-width: calc(66svh * var(--aspect));
    }
  }
  .host.fill {
    flex: 1 1 0;
    min-height: 150px;
    max-width: none;
    aspect-ratio: auto;
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
    /* Notebook squares, behind the ink. Pure background: they scroll with `top` through
       --grid-y and are never drawn into the bitmap, so nothing erases or exports them. */
    --grid-line: color-mix(in srgb, var(--fg) 11%, transparent);
    /* Each line is the first 1px of its square, i.e. it is centred half a pixel PAST the
       square's edge — and a snapped stroke is centred ON the edge. Pulling both back by
       half a pixel puts the grey line under the middle of the ink. gridcheck.mjs. */
    background:
      linear-gradient(var(--grid-line) 1px, transparent 1px) -0.5px calc(var(--grid-y) - 0.5px),
      linear-gradient(90deg, var(--grid-line) 1px, transparent 1px) -0.5px 0,
      var(--surface);
    background-size: var(--grid-cell) var(--grid-cell);
    border: 2px solid var(--border);
    touch-action: none;
    /* Chrome on Android has claimed the stylus barrel button for TEXT SELECTION since
       Android M (crrev 2874183002, "Fix Text selection with Stylus button pressed"), and
       a selection drag is not delivered to the page as pointer events at all — which is
       exactly what "the button does nothing" looks like from here. A drawing surface has
       nothing to select in the first place, so saying so is right regardless, and it is
       the one thing that might hand the gesture back. */
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    cursor: crosshair;
    clip-path: polygon(
      var(--chamfer) 0,
      100% 0,
      100% calc(100% - var(--chamfer)),
      calc(100% - var(--chamfer)) 100%,
      0 100%,
      0 var(--chamfer)
    );
  }
  canvas.readonly {
    cursor: default;
  }
  /* Inside the board's border, not beside it: the writing area is the whole screen now,
     and a rail parked outside would cost width the strip cannot spare on a tablet. */
  .rail {
    position: absolute;
    inset-block: 2px;
    inset-inline-end: 2px;
    width: 26px;
    background: var(--surface-2);
    border-inline-start: 2px solid var(--border);
    touch-action: none;
    cursor: pointer;
    /* The grip is clamped in JS and cannot reach this — but the rail is the board's
       inside edge, and anything that ever escapes it does not land somewhere harmless,
       it lands on the page below the board's border looking like a black bar. Clipping
       here costs nothing and makes that impossible rather than merely fixed. */
    overflow: hidden;
  }
  .probe {
    position: absolute;
    inset-block-start: 6px;
    inset-inline-start: 6px;
    display: grid;
    gap: 2px;
    margin: 0;
    padding: 4px 8px;
    direction: ltr;
    text-align: start;
    background: var(--surface-2);
    border: 1px solid var(--border);
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg-muted);
    pointer-events: none;
  }
  /* `.grip`, and NOT `.thumb`, which is what it was called: the skin styles `.thumb` as
     an image thumbnail — `filter: grayscale(1) contrast(1.08)`, "read as surveillance
     feed" — and this answered to the name. On the light palette the ink-navy came out
     #0d0d0d, and on the dark one the electric cyan came out plain grey with its glow
     drained through the same filter. The skin is copied into this repo verbatim and is
     not edited, so the thing that moves is the name here. */
  .grip {
    position: absolute;
    inset-inline: 5px;
    /* No `min-height`: it was a second floor, in a second file, that the clamp above
       could not allow for — and on a short board it was the one that bound. One floor,
       one home. `GRIP_MIN` is 12% of the rail, which is over 26px on every board this
       app is ever given. */
    background: var(--primary);
    box-shadow: var(--cyber-glow-primary);
  }
  canvas.erasing {
    cursor: cell;
  }
  /* ---- the capture gesture --------------------------------------------------
     Three things at once, and each says a different half of "this was copied": a shutter
     tint over the whole board, a viewfinder that closes on the four corners, and one
     scanline reading down the page.

     Decoration and nothing else, so `pointer-events: none` — and `overflow: hidden`,
     because the scanline travels past the bottom edge and without it the pane grows a
     scrollbar for an element nobody can see. That exact bug already cost a session once,
     on the dialog's sweep. */
  /* The overlay is never unmounted by a timer: every layer ends `forwards` at opacity 0
     (or clipped off the board), so after the gesture it is an invisible, unclickable
     element that the next press replaces through `{#key}`. Its length lives only here. */
  .shot {
    --shot-dur: 620ms;
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
    /* The viewfinder ring. `--primary` is the token that stays STRUCTURAL in both
       palettes — ink-navy on the light ground, electric cyan on the dark one — which is
       what an outline wants. The glow is a token of its own because in the light palette
       it is `none`, and `none` inside a comma list is not a shadow, it is a parse error
       that takes the whole declaration with it. */
    outline: 2px solid var(--primary);
    outline-offset: -2px;
    box-shadow: var(--cyber-glow-primary);
    --arm: 22px;
    --thick: 4px;
    /* Four corner brackets, eight bars. They have to be gradients and not a flat colour:
       `background: var(--primary) 0 0/22px 4px` paints the ENTIRE box, which is the
       mistake the 44px card stub already made once. */
    background:
      linear-gradient(var(--primary), var(--primary)) 0 0 / var(--arm) var(--thick) no-repeat,
      linear-gradient(var(--primary), var(--primary)) 0 0 / var(--thick) var(--arm) no-repeat,
      linear-gradient(var(--primary), var(--primary)) 100% 0 / var(--arm) var(--thick) no-repeat,
      linear-gradient(var(--primary), var(--primary)) 100% 0 / var(--thick) var(--arm) no-repeat,
      linear-gradient(var(--primary), var(--primary)) 0 100% / var(--arm) var(--thick) no-repeat,
      linear-gradient(var(--primary), var(--primary)) 0 100% / var(--thick) var(--arm) no-repeat,
      linear-gradient(var(--primary), var(--primary)) 100% 100% / var(--arm) var(--thick) no-repeat,
      linear-gradient(var(--primary), var(--primary)) 100% 100% / var(--thick) var(--arm) no-repeat;
    /* Fades over the last stretch, and `forwards` is not optional: the default fill mode
       drops the element back to full opacity for the frames between the animation ending
       and the unmount landing — a viewfinder that blinks back on as it leaves. */
    animation: shotOut var(--dur-medium) var(--ease-emph)
      calc(var(--shot-dur) - var(--dur-medium)) forwards;
  }
  .shot::before,
  .shot::after {
    content: '';
    position: absolute;
    inset-inline: 0;
  }
  /* The shutter: the whole board lifts for an instant. Over inside the first third, so
     it is finished long before the scanline is halfway down. */
  .shot::before {
    inset-block: 0;
    background: var(--accent-tint);
    animation: shotFlash calc(var(--shot-dur) * 0.3) linear forwards;
  }
  /* The scanline. Same gesture as the dialog's sweep, one register louder, and running
     exactly once — a loop would turn a confirmation into a thing that keeps moving.

     `linear`, and this is the one place in the app that is not on `--ease-emph`. That
     curve is front-loaded on purpose, which is right for a panel arriving and wrong for
     a beam: measured at 150ms of a 420ms travel it was already at the bottom of the
     board, so what the eye got was a blink and not a sweep. A scanner moves at one
     speed; so does this. The shutter fades linearly for the same reason — eased, it was
     over in about 60ms of its 186. */
  .shot::after {
    top: 0;
    height: 34%;
    background: linear-gradient(180deg, transparent, var(--accent-tint), transparent);
    animation: shotScan calc(var(--shot-dur) * 0.68) linear
      calc(var(--shot-dur) * 0.1) forwards;
  }
  @keyframes shotFlash {
    to {
      opacity: 0;
    }
  }
  @keyframes shotScan {
    from {
      transform: translateY(-110%);
    }
    to {
      transform: translateY(400%);
    }
  }
  @keyframes shotOut {
    to {
      opacity: 0;
    }
  }
  /* Under reduce the two moving parts do not run at all rather than run instantly — an
     instant traverse is still a traverse. The viewfinder is not motion, so it stays:
     it appears, holds, and goes, and the press still gets an answer on the board.
     Nothing extra is needed to make it hold — the skin's global rule collapses
     `animation-duration` but leaves `animation-delay` alone, so `shotOut` still waits
     out its delay before it fires. */
  @media (prefers-reduced-motion: reduce) {
    .shot::before,
    .shot::after {
      display: none;
    }
  }
  .empty.fault {
    color: var(--danger);
  }
  .stall {
    margin: 0 auto 8px;
    width: 100%;
    max-width: calc(66vh * var(--aspect));
    padding: 6px 12px;
    border: 2px solid var(--danger);
    background: var(--danger-container);
    color: var(--fg);
    font-family: var(--font-mono);
    font-size: 13px;
    line-height: 1.45;
    text-align: center;
    clip-path: polygon(
      7px 0,
      100% 0,
      100% calc(100% - 7px),
      calc(100% - 7px) 100%,
      0 100%,
      0 7px
    );
  }
  @supports (height: 1svh) {
    .stall {
      max-width: calc(66svh * var(--aspect));
    }
  }
  /* On the writing board the canvas fills what is left, so the banner spans it too. */
  .stall:has(+ .host.fill) {
    max-width: none;
  }
  .stall span {
    display: block;
    color: var(--fg-muted);
    font-size: 11px;
  }
  .empty {
    position: absolute;
    inset-block-start: 50%;
    inset-inline: 0;
    margin: 0;
    text-align: center;
    color: var(--fg-subtle);
    font-family: var(--font-mono);
    font-size: 14px;
  }
</style>
