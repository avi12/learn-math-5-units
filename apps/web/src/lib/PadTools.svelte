<script lang="ts">
  /** What the pen draws with — the tablet's toolbar. The values are the page's; this
   *  only shows and sets them. */
  import { GRID_SCALE, PEN_SIZE, type Tool } from './ink';
  import type { RoomValue } from './roomvalue.svelte';
  import iconEllipse from './icons/IconEllipse.svg?raw';
  import iconErase from './icons/IconErase.svg?raw';
  import iconLine from './icons/IconLine.svg?raw';
  import iconPen from './icons/IconPen.svg?raw';
  import iconRect from './icons/IconRect.svg?raw';
  import iconSnap from './icons/IconSnap.svg?raw';

  let {
    tool = $bindable(),
    size,
    isSnapping = $bindable(),
    grid
  }: { tool: Tool; size: RoomValue; isSnapping: boolean; grid: RoomValue } = $props();

  /* The glyph travels WITH the tool, not beside it in a second list keyed by the same
     string — two lists in the same order is an order that eventually stops matching. */
  const TOOLS: [Tool, string, string][] = [
    ['ink', 'עט', iconPen],
    ['erase', 'מחק', iconErase],
    ['line', 'ישר', iconLine],
    ['rect', 'מלבן', iconRect],
    ['ellipse', 'מעגל', iconEllipse]
  ];

  /** Always one decimal — ×1.0, ×2.5 — so the label does not change width or shape as
   *  the slider moves between whole and fractional sizes. */
  const scaleFormat = new Intl.NumberFormat('he-IL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  const sizeLabel = $derived(tool === 'erase' ? 'גודל המחק' : 'עובי');
</script>

<div class="tools">
  <div class="group">
    {#each TOOLS as [t, label, icon] (t)}
      <button class="btn" data-tool={t} data-active={tool === t} onclick={() => (tool = t)}>
        {@html icon}
        {label}
      </button>
    {/each}
    <button class="btn" data-active={isSnapping} aria-pressed={isSnapping} onclick={() => (isSnapping = !isSnapping)}>
      {@html iconSnap}
      הצמד למשבצות
    </button>
  </div>
  <label class="group size">
    {sizeLabel}
    <input
      type="range"
      min={PEN_SIZE.min}
      max={PEN_SIZE.max}
      step={PEN_SIZE.step}
      bind:value={size.value}
      onchange={() => size.commit()}
    />
    <span class="num">{size.value}</span>
  </label>
  <label class="group size">
    גודל משבצת
    <input
      type="range"
      min={GRID_SCALE.min}
      max={GRID_SCALE.max}
      step={GRID_SCALE.step}
      bind:value={grid.value}
      onchange={() => grid.commit()}
    />
    <span class="num" dir="ltr">×{scaleFormat.format(grid.value)}</span>
  </label>
</div>

<style>
  .size {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--fg-muted);
  }
  /* Every digit the same width, so a value that changes under the thumb does not jiggle
     the controls beside it. */
  .num {
    font-variant-numeric: tabular-nums;
  }
  input[type='range'] {
    accent-color: var(--primary);
    width: 130px;
  }
</style>
