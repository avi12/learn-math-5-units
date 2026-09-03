<script lang="ts">
  /** The formula bar: reads the canvas and keeps the LaTeX in step with it.
   *
   * Opening the bar transcribes whatever is on the canvas straight away, and every
   * change to the canvas re-runs it once the pen has been still for a moment. The
   * result lands in a MathLive field rather than a read-only box, because recognition
   * is never perfect and fixing one symbol should not mean retyping the line.
   *
   * Without a recogniser endpoint the bar still works — it is then just the editor,
   * and you type the formula yourself. */
  import { onMount } from 'svelte';
  import { latexRef, onSnapshot, setDoc } from './room';
  import { apiKey, configured, setApiKey, toLatex } from './recognise';

  let {
    roomId,
    readonly = false,
    strokeKey = '',
    getCanvas
  }: {
    roomId: string;
    readonly?: boolean;
    strokeKey?: string;
    getCanvas?: (width?: number) => HTMLCanvasElement | undefined;
  } = $props();

  const SETTLE_MS = 1300; // long enough that it does not fire between two strokes

  let host = $state<HTMLDivElement>();
  let field: (HTMLElement & { value: string; readOnly: boolean }) | null = null;
  let latex = $state('');
  let ready = $state(false);
  let status = $state<'idle' | 'reading' | 'error' | 'off'>(configured() ? 'idle' : 'off');
  let keyDraft = $state(apiKey());
  let detail = $state('');
  let echo = false;

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
    if (!configured() || readonly || !getCanvas) return;
    const canvas = getCanvas(1200);
    if (!canvas || !key) return;
    inflight?.abort();
    inflight = new AbortController();
    status = 'reading';
    detail = '';
    try {
      const tex = await toLatex(canvas, key, inflight.signal, force);
      status = 'idle';
      if (tex) {
        setValue(tex);
        publish(tex);
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      status = 'error';
      detail = (e as Error).message;
    }
  }

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
      inflight?.abort();
      off();
    };
  });

  // and every change to the canvas re-runs it, once the pen has settled
  let seen = strokeKey;
  let timer: ReturnType<typeof setTimeout>;
  $effect(() => {
    const key = strokeKey;
    if (key === seen) return;
    seen = key;
    clearTimeout(timer);
    timer = setTimeout(() => void recognise(key), SETTLE_MS);
  });

  export function value(): string {
    return latex;
  }
  export function rerun(): void {
    void recognise(strokeKey, true);
  }
</script>

<div class="formula">
  <div class="bar">
    <span class="state" data-state={status}>
      {#if status === 'reading'}מזהה את הכתב…
      {:else if status === 'error'}הזיהוי נכשל ({detail})
      {:else if status === 'off'}אין מנוע זיהוי מוגדר — אפשר להקליד ידנית
      {:else}מסונכרן עם הקנבס{/if}
    </span>
    {#if configured() && !readonly}
      <button class="btn small" onclick={() => rerun()} disabled={status === 'reading'}>זהה שוב</button>
    {/if}
  </div>

  {#if status === 'off' && !readonly}
    <div class="setup">
      <label for="ocr-key">מפתח Anthropic API</label>
      <div class="row">
        <input
          id="ocr-key"
          type="password"
          dir="ltr"
          autocomplete="off"
          placeholder="sk-ant-..."
          bind:value={keyDraft}
        />
        <button
          class="btn"
          onclick={() => {
            setApiKey(keyDraft);
            status = configured() ? 'idle' : 'off';
            if (configured()) void recognise(strokeKey, true);
          }}>שמור</button>
      </div>
      <p class="fine">
        נשמר ב־localStorage של הדפדפן הזה בלבד — לא בקוד, לא בגיט, ולא נשלח לשום מקום חוץ
        מ־api.anthropic.com. אם תעדיף שהמפתח לא יישב על המכשיר, יש פרוקסי מוכן ב־<code>worker/ocr.js</code>.
      </p>
    </div>
  {/if}

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
  .state[data-state='off'] {
    color: var(--fg-subtle);
  }
  .btn.small {
    min-height: 28px;
    padding: 0 var(--s-3);
    font: var(--t-label-m);
  }
  .setup {
    display: grid;
    gap: 6px;
    padding: 12px;
    border: 2px solid var(--border);
    border-inline-start: 6px solid var(--warn);
    background: var(--surface-2);
  }
  .setup .fine {
    margin: 2px 0 0;
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1.55;
    color: var(--fg-subtle);
  }
  .setup label {
    font-family: var(--font-mono);
    font-size: 11.5px;
    color: var(--fg-muted);
  }
  .setup .row {
    display: flex;
    gap: 8px;
  }
  .setup input {
    flex: 1;
    min-width: 0;
    padding: 8px 10px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--fg);
    font-family: var(--font-mono);
    font-size: 12px;
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
