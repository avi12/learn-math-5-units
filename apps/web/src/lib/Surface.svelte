<script lang="ts">
  import { onMount } from 'svelte';
  import {
    ASPECT,
    PAGE,
    bounds,
    colour,
    decimate,
    equation,
    hits,
    lines,
    pack,
    render,
    type Pen,
    type Pt,
    type Stroke,
    type Tool
  } from './ink';
  import { installSpen, spenHeld, spenWrapper, type PenReport } from './spen';
  import {
    commit,
    deleteDoc,
    onSnapshot,
    orderBy,
    publishLive,
    query,
    strokeRef,
    type Room
  } from './room';

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
    onstrokes,
    onpen
  }: {
    room: Room;
    readonly?: boolean;
    /** Fill the flex parent instead of keeping a page-shaped box. The pad sets this so
     *  the board can never be scrolled off the screen; the desktop mirror does not. */
    fill?: boolean;
    tool?: Tool;
    pen?: Pen;
    size?: number;
    onstrokes?: (keys: string[], canvas: HTMLCanvasElement) => void;
    /** Pen on the glass, pen off it. Recognition debounces on this and not on committed
     *  strokes: a stroke only lands after it is finished, so a listener that hears only
     *  landings cannot tell "still writing" from "done writing". */
    onpen?: (down: boolean) => void;
  } = $props();

  /** `?pendebug` in the URL prints what the pen actually reported on its last touch.
   *  There is no way to try an S Pen from a desktop, and "the button does nothing" is
   *  not a report anyone can act on; this turns it into one line that says exactly what
   *  the device sends. Empty string means off, so it costs nothing when it is. */
  const PENDEBUG = new URL(location.href).searchParams.has('pendebug');
  /** The last few pointer events verbatim, when `?pendebug` is in the URL. It is written
   *  from a capture-phase listener and not from down(), because the question it exists to
   *  answer is what the device sent — including events that never get as far as drawing. */
  let probe = $state<string[]>(PENDEBUG ? ['pendebug · גע בלוח'] : []);

  function note(tag: string, e: PointerEvent | MouseEvent) {
    if (!PENDEBUG) return;
    const p = e as PointerEvent;
    const line = `${tag} ${p.pointerType ?? '-'} button=${e.button} buttons=${e.buttons}`;
    probe = [line, ...probe.filter((x) => x !== line)].slice(0, 4);
  }

  let host = $state<HTMLDivElement>();
  let canvas = $state<HTMLCanvasElement>();
  let ctx: CanvasRenderingContext2D | null = null;

  /** Committed strokes, in insertion order, keyed so undo can remove the last one. */
  let order = $state<string[]>([]);
  const byKey = new Map<string, Stroke>();
  let live = $state<Stroke | null>(null);
  /** A listener that dies must say so — a silent one looks exactly like an empty board. */
  let fault = $state('');

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
   *  first line, and letting it drift up would lose the one landmark the board has. */
  let top = $state(0);
  /** How tall the viewport is in those same units. Not a constant any more: the board
   *  is now whatever box the layout hands it, so this is measured in fit(). */
  let viewH = $state(PAGE);
  /** Redraw ceiling and rail geometry both need the lowest ink; recomputing it on every
   *  pointer move would walk every stroke, so it is cached and refreshed on commit. */
  let inkBottom = $state(0);

  function strokes(): Stroke[] {
    return order.map((k) => byKey.get(k)!).filter(Boolean);
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

  function scrollTo(v: number) {
    const next = Math.max(0, Math.min(maxTop(), v));
    if (next === top) return;
    top = next;
    paint();
  }

  function scrollBy(dy: number) {
    scrollTo(top + dy);
  }

  function paint() {
    if (!ctx || !canvas) return;
    const w = canvas.width / devicePixelRatio;
    const h = canvas.height / devicePixelRatio;
    render(ctx, strokes(), live, w, h, undefined, top);
    if (rubber) {
      ctx.save();
      ctx.translate(0, -top * w);
      ctx.strokeStyle = colour('ink');
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(rubber.x * w, rubber.y * w, radius() * w, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  /** The rubber follows the thickness slider: the same control that says how wide the
   *  pen writes says how much of it comes off. */
  function radius(): number {
    return 0.006 + (size * 2.2) / 1000;
  }

  /** Rub out every stroke under the rubber. Whole strokes — see `hits` in ink.ts. */
  function rub(p: Pt) {
    const r = radius();
    for (const k of order) {
      const s = byKey.get(k);
      if (!s || erased.has(k)) continue;
      if (hits(s, p.x, p.y, r)) {
        erased.add(k);
        void deleteDoc(strokeRef(room.id, k));
      }
    }
  }

  function fit() {
    if (!canvas || !host) return;
    const w = host.clientWidth;
    // In fill mode the box is given by the layout; otherwise the old page shape stands.
    const h = fill ? host.clientHeight : w / ASPECT;
    if (!w || !h) return;
    canvas.width = Math.round(w * devicePixelRatio);
    canvas.height = Math.round(h * devicePixelRatio);
    canvas.style.height = `${h}px`;
    ctx = canvas.getContext('2d');
    ctx?.scale(devicePixelRatio, devicePixelRatio);
    viewH = h / w;
    if (top > maxTop()) top = maxTop();
    paint();
  }

  onMount(() => {
    fit();
    const ro = new ResizeObserver(fit);
    if (host) ro.observe(host);

    const offAdd = onSnapshot(query(room.strokes, orderBy('n')), (snap) => {
      for (const ch of snap.docChanges()) {
        if (ch.type === 'removed') {
          byKey.delete(ch.doc.id);
          erased.delete(ch.doc.id);
        } else byKey.set(ch.doc.id, ch.doc.data() as Stroke);
      }
      order = snap.docs.map((d) => d.id);
      fault = '';
      measure();
      // The mirror follows the writer down the strip. Without this the desktop shows the
      // top of the board for ever while the tablet is three screens below it, which is
      // the one thing a mirror must not do.
      if (readonly && inkBottom > top + viewH) top = Math.min(maxTop(), inkBottom - viewH * 0.75);
      if (top > maxTop()) top = maxTop();
      paint();
      onstrokes?.(order, canvas!);
    }, (e) => {
      fault = e.code || e.message;
      console.error('[pad] strokes listener failed', e);
    });
    const offLive = onSnapshot(room.live, (snap) => {
      // ignore the echo of our own in-progress stroke
      if (drawing) return;
      live = snap.exists() ? (snap.data() as Stroke) : null;
      paint();
    }, (e) => {
      fault = e.code || e.message;
      console.error('[pad] live listener failed', e);
    });

    // The probe is the only way to see what a pen reports on a device that cannot be
    // driven from here, so the wrapper's raw integers go straight into it.
    const offSpen = installSpen((down, r: PenReport) => {
      if (PENDEBUG) {
        probe = [
          `wrapper ${spenWrapper() || '-'} buttonState=${r.buttonState ?? '-'} tool=${r.toolType ?? '-'} → ${down ? 'erase' : 'pen'}`,
          ...probe
        ].slice(0, 4);
      }
    });

    const onTheme = () => paint();
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', onTheme);

    // Capture phase, and on the document rather than the canvas: an event that the app
    // never sees is the most useful thing the probe can report, and "nothing appeared"
    // is then a real answer rather than an ambiguity.
    const raw = (e: Event) => note('raw', e as PointerEvent);
    const ctx2 = (e: Event) => note('ctxmenu', e as MouseEvent);
    if (PENDEBUG) {
      document.addEventListener('pointerdown', raw, true);
      document.addEventListener('contextmenu', ctx2, true);
    }

    return () => {
      ro.disconnect();
      offAdd();
      offLive();
      offSpen();
      mq.removeEventListener('change', onTheme);
      document.removeEventListener('pointerdown', raw, true);
      document.removeEventListener('contextmenu', ctx2, true);
    };
  });

  function at(e: PointerEvent): Pt {
    const r = canvas!.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / r.width,
      y: (e.clientY - r.top) / r.width + top,
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
    if (e.pointerType === 'touch') return false;
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
  const touches = new Map<number, number>(); // pointerId -> clientY
  let panning = false;
  let panFrom = 0;

  function avgTouchY(): number {
    let sum = 0;
    for (const y of touches.values()) sum += y;
    return sum / touches.size;
  }

  function abandonStroke() {
    if (!drawing) return;
    drawing = false;
    onpen?.(false);
    pts = [];
    live = null;
    rubber = null;
    if (publishedLive) publishLive(room, null);
    paint();
  }

  function wheel(e: WheelEvent) {
    const r = canvas!.getBoundingClientRect();
    if (maxTop() <= 0) return;
    e.preventDefault();
    scrollBy(e.deltaY / r.width);
  }

  function down(e: PointerEvent) {
    if (e.pointerType === 'touch') {
      // A pointerup that never arrives — a finger lifted off the edge of the glass, a
      // cancel the browser eats — would leave a ghost in this map, and from then on the
      // very next single touch would count as the second finger and pan instead of
      // writing. It is not a rare case and it is silent, so the map self-heals here:
      // isPrimary means this is the first pointer of a gesture, which is exactly the
      // moment nothing else can legitimately be down.
      if (e.isPrimary) touches.clear();
      touches.set(e.pointerId, e.clientY);
      if (touches.size >= 2) {
        abandonStroke();
        panning = true;
        panFrom = avgTouchY();
        return;
      }
    }
    if (readonly || rejected(e)) return;
    e.preventDefault();
    acting = erasingWith(e) ? 'erase' : tool;
    if (PENDEBUG) note('down→' + acting, e);
    capture(canvas!, e.pointerId);
    drawing = true;
    onpen?.(true);
    if (acting === 'erase') {
      rubber = at(e);
      rub(rubber);
      paint();
      return;
    }
    startedAt = performance.now();
    publishedLive = false;
    pts = [at(e)];
    live = { t: acting, c: pen, w: size, p: pack(pts) };
    paint();
  }

  function move(e: PointerEvent) {
    if (e.pointerType === 'touch' && touches.has(e.pointerId)) touches.set(e.pointerId, e.clientY);
    if (panning) {
      if (touches.size < 2) return;
      e.preventDefault();
      const now = avgTouchY();
      const r = canvas!.getBoundingClientRect();
      scrollBy((panFrom - now) / r.width);
      panFrom = now;
      return;
    }
    if (!drawing) return;
    e.preventDefault();
    // The button does not always arrive on pointerdown. Chrome can report the barrel a
    // move or two after contact, and a gesture that only counted it at touch-down would
    // then write instead of erasing — which is exactly what "the button does nothing"
    // looks like. So the stroke may still become an erase; it never becomes a pen again.
    if (acting !== 'erase' && erasingWith(e)) {
      if (PENDEBUG) note('move→erase', e);
      acting = 'erase';
      pts = [];
      live = null;
      if (publishedLive) publishLive(room, null);
      publishedLive = false;
    } else if (PENDEBUG && (e.buttons & ~1) !== 0) note('move', e);
    if (acting === 'erase') {
      // every coalesced point, so a fast sweep does not step over a thin stroke
      for (const q of e.getCoalescedEvents?.() ?? [e]) rub(at(q as PointerEvent));
      rubber = at(e);
      paint();
      return;
    }
    const batch = e.getCoalescedEvents?.() ?? [e];
    for (const q of batch) pts.push(at(q as PointerEvent));
    if (acting !== 'ink') pts = [pts[0], pts[pts.length - 1]];
    live = { t: acting, c: pen, w: size, p: pack(pts) };
    paint();
    const now = performance.now();
    if (now - startedAt > LIVE_AFTER_MS && now - lastPublish > LIVE_EVERY_MS) {
      lastPublish = now;
      publishedLive = true;
      publishLive(room, { ...live, p: pack(decimate(pts)) });
    }
  }

  function up(e: PointerEvent) {
    touches.delete(e.pointerId);
    if (panning) {
      // one finger left of a two-finger pan is not a stroke: wait for the glass to clear
      if (touches.size === 0) panning = false;
      return;
    }
    if (!drawing) return;
    drawing = false;
    onpen?.(false);
    canvas!.releasePointerCapture?.(e.pointerId);
    if (acting === 'erase') {
      rubber = null;
      paint();
      return;
    }
    const s: Stroke = { t: acting, c: pen, w: size, p: pack(decimate(pts)) };
    pts = [];
    live = null;
    // only clear the live doc if we ever wrote one — saves a delete per short stroke
    if (publishedLive) publishLive(room, null);
    if (s.p) commit(room, s);
    paint();
  }

  /** Margin left under the lowest ink in an exported image, in normalised units. */
  const EXPORT_PAD = 0.03;

  /** The whole drawing as one image — this is what "העתק כתמונה" puts on the clipboard.
   *
   *  It grows with the writing instead of being one page: a strip three screens long
   *  exported at a fixed 3:2 would silently paste the first screen and drop the rest,
   *  which is worse than an error because the picture looks complete. One page stays
   *  the floor, so a short drawing exports exactly as it always did. */
  export function exportCanvas(w = 1800): HTMLCanvasElement {
    const out = document.createElement('canvas');
    const bottom = bounds(strokes())?.y1 ?? 0;
    out.width = w;
    out.height = Math.round(Math.max(PAGE, bottom + EXPORT_PAD) * w);
    const c = out.getContext('2d')!;
    render(
      c,
      strokes(),
      null,
      w,
      out.height,
      getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || '#fff'
    );
    return out;
  }

  /** One canvas per writing line, each carrying the ids of the strokes on it.
   *
   *  The recogniser reads one formula at a time, so it gets one line at a time. The key
   *  travels with the canvas so a line whose strokes have not changed can be served from
   *  cache — adding a symbol to the second equation must not re-read the first. */
  export function exportLines(w = 1200): { key: string; canvas: HTMLCanvasElement }[] {
    const present = order.filter((k) => byKey.has(k));
    const all = present.map((k) => byKey.get(k)!);
    const idOf = new Map(all.map((s, i) => [s, present[i]]));
    const bg =
      getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || '#fff';

    return lines(all).map((group) => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = Math.round(PAGE * w);
      // A line further down the strip than one page would render past the bottom of its
      // own canvas and reach the model as a blank image — the recogniser would answer
      // for an empty picture and the line would be quietly lost. It is shifted up by the
      // least that brings it inside, so a line that already fits is framed exactly as
      // before and nothing about the first screen's recognition changes.
      const b = bounds(group);
      const shift = b ? Math.max(0, b.y1 + EXPORT_PAD - PAGE) : 0;
      // the margin note is left out of what the model sees, but stays in the key: the
      // line still has to be re-read when anything on it changes
      render(canvas.getContext('2d')!, equation(group), null, w, canvas.height, bg, shift);
      return { key: group.map((s) => idOf.get(s)).join(','), canvas };
    });
  }

  export function keys(): string[] {
    return order;
  }

  /* ---- the rail ------------------------------------------------------------
     A pen has no second finger and no wheel, so the board needs something a nib can
     land on. The rail is that, and it doubles as the only answer to "how much did I
     write below here" — on a strip with no page breaks there is otherwise nothing on
     screen that says the drawing continues. It appears only once it means something. */
  const total = $derived(Math.max(viewH, inkBottom + viewH / 2));
  const scrollable = $derived(maxTop() > 0.001);
  const thumbTop = $derived(`${(top / total) * 100}%`);
  const thumbH = $derived(`${Math.max(12, (viewH / total) * 100)}%`);

  let rail = $state<HTMLDivElement>();
  let railing = false;

  /** Land anywhere on the rail and the view centres there — a nib does not drag well. */
  function railTo(clientY: number) {
    if (!rail) return;
    const r = rail.getBoundingClientRect();
    const frac = (clientY - r.top) / r.height;
    scrollTo(frac * total - viewH / 2);
  }

  function railDown(e: PointerEvent) {
    e.preventDefault();
    railing = true;
    if (rail) capture(rail, e.pointerId);
    railTo(e.clientY);
  }

  function railMove(e: PointerEvent) {
    if (railing) railTo(e.clientY);
  }

  function railUp(e: PointerEvent) {
    railing = false;
    rail?.releasePointerCapture?.(e.pointerId);
  }
</script>

<div class="host" class:fill bind:this={host}>
  <canvas
    bind:this={canvas}
    class:erasing={tool === 'erase' && !readonly}
    class:readonly
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
    onpointerleave={up}
    onwheel={wheel}
    oncontextmenu={(e) => e.preventDefault()}
  ></canvas>
  {#if probe.length}
    <div class="probe">
      {#each probe as line (line)}<span>{line}</span>{/each}
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
      <div class="thumb" style:top={thumbTop} style:height={thumbH}></div>
    </div>
  {/if}
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
     scrolling document. */
  .host {
    position: relative;
    width: 100%;
    max-width: calc(66vh * 1.5);
    margin-inline: auto;
    aspect-ratio: 3 / 2;
  }
  @supports (height: 1svh) {
    .host:not(.fill) {
      max-width: calc(66svh * 1.5);
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
    background: var(--surface);
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
  .thumb {
    position: absolute;
    inset-inline: 5px;
    min-height: 26px;
    background: var(--primary);
    box-shadow: var(--cyber-glow-primary);
  }
  canvas.erasing {
    cursor: cell;
  }
  .empty.fault {
    color: var(--danger);
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
