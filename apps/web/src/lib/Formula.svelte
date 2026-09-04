<script lang="ts">
  /** The formula bar: reads the canvas and keeps the LaTeX in step with it.
   *
   * Opening the bar transcribes whatever is on the canvas straight away — the pen is
   * certainly idle at that moment. After that it waits: recognition runs only once the
   * pen has left the glass and the drawing has been still for SETTLE_MS. `Settle` holds
   * that rule and says why it needs the pen and not just the committed strokes.
   *
   * The result lands in a MathLive field rather than a read-only box, because
   * recognition is never perfect and fixing one symbol should not mean retyping the
   * line. Without a recogniser the bar still works — it is then just the editor. */
  import { onMount, untrack } from 'svelte';
  import { latexRef, onSnapshot, setDoc } from './room';
  import { onDownload, toLatex, type Line, type Progress } from './recognise';
  import { Settle, SETTLE_MS } from './settle';

  let {
    roomId,
    readonly = false,
    strokeKey = '',
    penDown = false,
    getLines,
    getWhole
  }: {
    roomId: string;
    readonly?: boolean;
    strokeKey?: string;
    penDown?: boolean;
    /** one canvas per writing line — the model reads one formula at a time */
    getLines?: () => Line[];
    /** the whole board as one image, used when the per-line read comes back wrong */
    getWhole?: () => HTMLCanvasElement | undefined;
  } = $props();

  let host = $state<HTMLDivElement>();
  let field: (HTMLElement & { value: string; readOnly: boolean }) | null = null;
  let latex = $state('');
  let ready = $state(false);
  let status = $state<'idle' | 'reading' | 'error'>('idle');
  /** The model download is its own axis, not a phase of a read — it outlives any single
   *  one of them, and it is the same download for every reader. */
  let download = $state<Progress | null>(null);
  let detail = $state('');
  /** which line of how many, while a multi-line read is running */
  let atLine = $state(0);
  let ofLines = $state(0);
  /** lines the model could not read. Saying so is the point: the failure mode this whole
   *  pipeline exists to fight is a line disappearing without a word. */
  let missed = $state<number[]>([]);
  let echo = false;

  /** A countdown is running. `armedAt` restarts the bar's animation, nothing more. */
  let armed = $state(false);
  let armedAt = $state(0);

  function publish(tex: string) {
    if (readonly) return;
    echo = true;
    void setDoc(latexRef(roomId), { tex });
  }

  function setValue(tex: string) {
    latex = tex;
    if (field && field.value !== tex) field.value = tex;
  }

  let inflight: AbortController | null = null;

  async function recognise(key: string, force = false) {
    if (readonly || !getLines) return;
    const lines = getLines();
    if (!lines.length || !key) return;
    inflight?.abort();
    const run = (inflight = new AbortController());
    status = 'reading';
    detail = '';
    atLine = 0;
    ofLines = lines.length;
    missed = [];
    try {
      const tex = await toLatex(lines, {
        force,
        signal: run.signal,
        whole: getWhole?.(),
        onLine: (done, total) => {
          atLine = done;
          ofLines = total;
        },
        onMiss: (which) => (missed = which)
      });
      status = 'idle';
      if (tex) {
        setValue(tex);
        publish(tex);
      }
    } catch (e) {
      // superseded by a newer read, or by the pen going back down: not a failure
      if ((e as Error).name === 'AbortError') {
        if (inflight === run) status = 'idle';
        return;
      }
      status = 'error';
      detail = (e as Error).message;
    }
  }

  /** The one clock. `seen` is the drawing it will read when it fires — captured, not
   *  tracked, because the effect below is what advances it. */
  let seen = untrack(() => strokeKey);
  const settle = new Settle(
    () => void recognise(seen),
    (on) => {
      armed = on;
      if (on) armedAt = Date.now();
    }
  );

  onMount(() => {
    let disposed = false;

    import('mathlive').then((ml) => {
      if (disposed) return;
      ml.MathfieldElement.soundsDirectory = null;
      const f = new ml.MathfieldElement();
      f.smartMode = true;
      f.mathVirtualKeyboardPolicy = readonly ? 'manual' : 'auto';
      if (readonly) f.readOnly = true;
      f.style.width = '100%';
      f.style.minHeight = '58px';
      f.value = latex;
      f.addEventListener('input', () => {
        latex = f.value;
        publish(latex);
      });
      host?.append(f);
      field = f as typeof field;
      ready = true;
    });

    const offDownload = onDownload((p) => (download = p));

    const off = onSnapshot(latexRef(roomId), (snap) => {
      const tex = snap.exists() ? ((snap.data() as { tex?: string }).tex ?? '') : '';
      if (echo && tex === latex) {
        echo = false;
        return;
      }
      setValue(tex);
    });

    // opening the bar is itself a request to transcribe what is already drawn
    void recognise(strokeKey);

    return () => {
      disposed = true;
      settle.cancel();
      inflight?.abort();
      offDownload();
      off();
    };
  });

  // The pen holds the countdown open while it is on the glass, and starts it on release.
  // A read that is already running is thrown away the moment the pen comes back down:
  // the drawing under it has changed, so whatever it returns is about the wrong picture.
  let wasDown = false;
  $effect(() => {
    const down = penDown;
    if (down === wasDown) return; // mounting with the pen already up is not an event
    wasDown = down;
    if (down) inflight?.abort();
    settle.pen(down);
  });

  // A landed stroke restarts the countdown too. It arrives from Firestore a moment after
  // the pen is up, and it carries the key the read will actually use.
  $effect(() => {
    const key = strokeKey;
    if (key === seen) return;
    seen = key;
    settle.nudge();
  });

  export function value(): string {
    return latex;
  }
  export function rerun(): void {
    settle.cancel(); // asking by hand overrides the wait
    void recognise(strokeKey, true);
  }
</script>

<div class="formula">
  <div class="bar">
    <span
      class="state"
      data-state={download
        ? 'loading'
        : armed
          ? 'settling'
          : status === 'idle' && missed.length
            ? 'missed'
            : status}
    >
      {#if download}מוריד את מודל הזיהוי… {download.pct}%
      {:else if armed}ממתין שתסיים לכתוב…
      {:else if status === 'reading'}{ofLines > 1 && atLine
          ? `מזהה שורה ${atLine} מתוך ${ofLines}…`
          : 'מזהה את הכתב…'}
      {:else if status === 'error'}הזיהוי נכשל ({detail})
      {:else if missed.length === 1}שורה {missed[0]} לא נקראה
      {:else if missed.length}שורות {missed.join(', ')} לא נקראו
      {:else}מסונכרן עם הקנבס{/if}
    </span>
    {#if !readonly}
      <button class="btn small" onclick={() => rerun()} disabled={status === 'reading'}>זהה שוב</button>
    {/if}
  </div>

  <!-- The wait is deliberate, so it is shown. An unexplained 2.4s of nothing reads as a
       hang; a bar that empties reads as "it is listening". -->
  <div class="track" class:on={armed} aria-hidden="true">
    {#if armed}
      {#key armedAt}
        <span class="fill" style="--settle:{SETTLE_MS}ms"></span>
      {/key}
    {/if}
  </div>

  <div bind:this={host} class="field" class:pending={!ready}></div>
  {#if !ready}<p class="hint">טוען עורך…</p>{/if}
  <pre class="tex" dir="ltr">{latex || '\\;'}</pre>
</div>

<style>
  .formula {
    display: grid;
    gap: 10px;
  }
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .state {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--fg-muted);
  }
  .state[data-state='reading'] {
    color: var(--primary);
  }
  .state[data-state='error'] {
    color: var(--danger);
  }
  .state[data-state='loading'] {
    color: var(--secondary);
  }
  /* A line that was not read is not an error — the rest of the board is fine and there
     is a button right here to try again — so it gets the warning hue, not the danger one. */
  .state[data-state='missed'] {
    color: var(--warn);
  }
  /* Deliberately NOT its own hue. In the light palette --accent-2 is byte-identical to
     --danger, so "waiting for you" was rendering in exactly the colour of "it failed";
     and waiting is not an alarm anyway. The text stays neutral and the bar carries the
     state, in the same --secondary as the download — both mean "mid-something". */
  .state[data-state='settling'] {
    color: var(--fg-muted);
  }
  .track {
    height: 3px;
    margin-top: -6px;
    background: var(--surface-2);
    opacity: 0;
  }
  .track.on {
    opacity: 1;
  }
  /* Animating inline-size, not a transform: it fills from the inline start, which under
     dir="rtl" is the right edge, without the component having to know the direction. */
  .fill {
    display: block;
    height: 100%;
    background: var(--secondary);
    animation: settle var(--settle) linear both;
  }
  @keyframes settle {
    from {
      inline-size: 100%;
    }
    to {
      inline-size: 0;
    }
  }
  .btn.small {
    min-height: 28px;
    padding: 0 var(--s-3);
    font: var(--t-label-m);
  }
  .field {
    border: 2px solid var(--border);
    background: var(--surface);
    padding: 6px 8px;
    min-height: 58px;
    clip-path: polygon(
      var(--chamfer-s) 0,
      100% 0,
      100% calc(100% - var(--chamfer-s)),
      calc(100% - var(--chamfer-s)) 100%,
      0 100%,
      0 var(--chamfer-s)
    );
  }
  .field.pending {
    display: grid;
    place-items: center;
  }
  .hint {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--fg-subtle);
  }
  .tex {
    margin: 0;
    padding: 10px 12px;
    border: 1px solid var(--border);
    background: var(--surface-2);
    color: var(--fg-muted);
    font-family: var(--font-mono);
    font-size: 12.5px;
    white-space: pre-wrap;
    word-break: break-all;
    overflow-x: auto;
  }
</style>
