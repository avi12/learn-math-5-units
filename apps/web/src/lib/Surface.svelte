<script lang="ts">
  import { onMount } from 'svelte';
  import {
    ASPECT,
    colour,
    decimate,
    pack,
    render,
    type Pen,
    type Pt,
    type Stroke,
    type Tool
  } from './ink';
  import {
    announce,
    commit,
    onChildAdded,
    onChildRemoved,
    onValue,
    publishLive,
    type Room
  } from './room';

  let {
    room,
    readonly = false,
    tool = 'ink' as Tool,
    pen = 'ink' as Pen,
    size = 6,
    onstrokes
  }: {
    room: Room;
    readonly?: boolean;
    tool?: Tool;
    pen?: Pen;
    size?: number;
    onstrokes?: (keys: string[], canvas: HTMLCanvasElement) => void;
  } = $props();

  let host = $state<HTMLDivElement>();
  let canvas = $state<HTMLCanvasElement>();
  let ctx: CanvasRenderingContext2D | null = null;

  /** Committed strokes, in insertion order, keyed so undo can remove the last one. */
  let order = $state<string[]>([]);
  const byKey = new Map<string, Stroke>();
  let live = $state<Stroke | null>(null);

  // local drawing state
  let drawing = false;
  let pts: Pt[] = [];
  let penSeen = 0;
  let lastPublish = 0;

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

    const offAdd = onChildAdded(room.strokes, (snap) => {
      byKey.set(snap.key!, snap.val() as Stroke);
      order = [...order, snap.key!];
      paint();
      onstrokes?.(order, canvas!);
    });
    const offDel = onChildRemoved(room.strokes, (snap) => {
      byKey.delete(snap.key!);
      order = order.filter((k) => k !== snap.key);
      paint();
      onstrokes?.(order, canvas!);
    });
    const offLive = onValue(room.live, (snap) => {
      // ignore the echo of our own in-progress stroke
      if (drawing) return;
      live = (snap.val() as Stroke) ?? null;
      paint();
    });
    announce(room, readonly ? 'board' : 'pad');

    const onTheme = () => paint();
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', onTheme);

    return () => {
      ro.disconnect();
      offAdd();
      offDel();
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
    if (now - lastPublish > 60) {
      lastPublish = now;
      publishLive(room, { ...live, p: pack(decimate(pts)) });
    }
  }

  function up(e: PointerEvent) {
    if (!drawing) return;
    drawing = false;
    canvas!.releasePointerCapture?.(e.pointerId);
    const s: Stroke = { t: tool, c: pen, w: size, p: pack(decimate(pts)) };
    pts = [];
    live = null;
    publishLive(room, null);
    if (s.p) commit(room, s);
    paint();
  }

  export function exportCanvas(): HTMLCanvasElement {
    const w = 1800;
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
  {#if readonly && order.length === 0 && !live}
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
