<script lang="ts">
  import { onMount } from 'svelte';
  import {
    ASPECT,
    PAGE,
    bounds,
    colour,
    decimate,
    equation,
    lines,
    pack,
    render,
    type Pen,
    type Pt,
    type Stroke,
    type Tool
  } from './ink';
  import { commit, onSnapshot, orderBy, publishLive, query, type Room } from './room';

  /** Firestore charges per write, so an in-progress stroke is only broadcast once it has
   *  run long enough to be worth watching, and then at a human frame rate. Handwriting
   *  strokes are shorter than this and cost exactly one write each, on release. */
  const LIVE_AFTER_MS = 400;
  const LIVE_EVERY_MS = 250;

  let {
    room,
    readonly = false,
    tool = 'ink' as Tool,
    pen = 'ink' as Pen,
    size = 6,
    onstrokes,
    onpen
  }: {
    room: Room;
    readonly?: boolean;
    tool?: Tool;
    pen?: Pen;
    size?: number;
    onstrokes?: (keys: string[], canvas: HTMLCanvasElement) => void;
    /** Pen on the glass, pen off it. Recognition debounces on this and not on committed
     *  strokes: a stroke only lands after it is finished, so a listener that hears only
     *  landings cannot tell "still writing" from "done writing". */
    onpen?: (down: boolean) => void;
  } = $props();

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

  function paint() {
    if (!ctx || !canvas) return;
    const w = canvas.width / devicePixelRatio;
    render(ctx, order.map((k) => byKey.get(k)!).filter(Boolean), live, w, w / ASPECT);
  }

  function fit() {
    if (!canvas || !host) return;
    const w = host.clientWidth;
    const h = w / ASPECT;
    canvas.width = Math.round(w * devicePixelRatio);
    canvas.height = Math.round(h * devicePixelRatio);
    canvas.style.height = `${h}px`;
    ctx = canvas.getContext('2d');
    ctx?.scale(devicePixelRatio, devicePixelRatio);
    paint();
  }

  onMount(() => {
    fit();
    const ro = new ResizeObserver(fit);
    if (host) ro.observe(host);

    const offAdd = onSnapshot(query(room.strokes, orderBy('n')), (snap) => {
      for (const ch of snap.docChanges()) {
        if (ch.type === 'removed') byKey.delete(ch.doc.id);
        else byKey.set(ch.doc.id, ch.doc.data() as Stroke);
      }
      order = snap.docs.map((d) => d.id);
      fault = '';
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

    const onTheme = () => paint();
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', onTheme);

    return () => {
      ro.disconnect();
      offAdd();
      offLive();
      mq.removeEventListener('change', onTheme);
    };
  });

  function at(e: PointerEvent): Pt {
    const r = canvas!.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / r.width,
      y: (e.clientY - r.top) / r.width,
      pr: e.pressure
    };
  }

  /** Palm rejection: once a pen has touched the glass, ignore finger input for a while. */
  function rejected(e: PointerEvent): boolean {
    if (e.pointerType === 'pen') {
      penSeen = performance.now();
      return false;
    }
    return e.pointerType === 'touch' && performance.now() - penSeen < 1500;
  }

  function down(e: PointerEvent) {
    if (readonly || rejected(e)) return;
    e.preventDefault();
    canvas!.setPointerCapture(e.pointerId);
    drawing = true;
    onpen?.(true);
    startedAt = performance.now();
    publishedLive = false;
    pts = [at(e)];
    live = { t: tool, c: pen, w: size, p: pack(pts) };
    paint();
  }

  function move(e: PointerEvent) {
    if (!drawing) return;
    e.preventDefault();
    const batch = e.getCoalescedEvents?.() ?? [e];
    for (const q of batch) pts.push(at(q as PointerEvent));
    if (tool !== 'ink') pts = [pts[0], pts[pts.length - 1]];
    live = { t: tool, c: pen, w: size, p: pack(pts) };
    paint();
    const now = performance.now();
    if (now - startedAt > LIVE_AFTER_MS && now - lastPublish > LIVE_EVERY_MS) {
      lastPublish = now;
      publishedLive = true;
      publishLive(room, { ...live, p: pack(decimate(pts)) });
    }
  }

  function up(e: PointerEvent) {
    if (!drawing) return;
    drawing = false;
    onpen?.(false);
    canvas!.releasePointerCapture?.(e.pointerId);
    const s: Stroke = { t: tool, c: pen, w: size, p: pack(decimate(pts)) };
    pts = [];
    live = null;
    // only clear the live doc if we ever wrote one — saves a delete per short stroke
    if (publishedLive) publishLive(room, null);
    if (s.p) commit(room, s);
    paint();
  }

  /** Margin left under the lowest ink in an exported image, in normalised units. */
  const EXPORT_PAD = 0.03;

  export function exportCanvas(w = 1800): HTMLCanvasElement {
    const out = document.createElement('canvas');
    out.width = w;
    out.height = Math.round(w / ASPECT);
    const c = out.getContext('2d')!;
    render(
      c,
      order.map((k) => byKey.get(k)!).filter(Boolean),
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

</script>

<div class="host" bind:this={host}>
  <canvas
    bind:this={canvas}
    class:readonly
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
    onpointerleave={up}
  ></canvas>
  {#if fault}
    <p class="empty fault">אין חיבור לבסיס הנתונים ({fault}). בדוק רשת או חוסם פרסומות.</p>
  {:else if readonly && order.length === 0 && !live}
    <p class="empty">אין עדיין כלום. פתח את הכתובת הזאת בטאבלט והתחל לכתוב.</p>
  {/if}
</div>

<style>
  .host {
    position: relative;
    width: 100%;
  }
  canvas {
    display: block;
    width: 100%;
    background: var(--surface);
    border: 2px solid var(--border);
    touch-action: none;
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
