<script lang="ts">
  /** LaTeX without OCR.
   *
   * The FOSS recognisers (pix2tex, TexTeller) are trained on *typeset* formulas —
   * handwriting is a TODO in their own README — and the handwriting models from the
   * CROHME line are research code that needs Python, weights and a server. FOSS removes
   * the per-request fee, not the machine.
   *
   * So this does not recognise anything: MathLive (MIT) is a math editor with a keyboard
   * built for touch. The LaTeX is exact by construction, there is no key, no server and
   * no cost, and it syncs to the desktop over the same room as the ink. */
  import { onMount } from 'svelte';
  import { latexRef, onSnapshot, setDoc } from './room';

  let { roomId, readonly = false }: { roomId: string; readonly?: boolean } = $props();

  let host = $state<HTMLDivElement>();
  let field: HTMLElement & { value: string } | null = null;
  let latex = $state('');
  let ready = $state(false);
  let echo = false; // suppress the round trip of our own write

  onMount(() => {
    let off: (() => void) | undefined;
    let disposed = false;

    // ~1MB of editor — only fetched when this pane is actually on screen
    import('mathlive').then((ml) => {
      if (disposed) return;
      ml.MathfieldElement.soundsDirectory = null;
      const f = new ml.MathfieldElement();
      f.smartMode = true;
      f.mathVirtualKeyboardPolicy = readonly ? 'manual' : 'auto';
      if (readonly) f.readOnly = true;
      f.style.width = '100%';
      f.style.minHeight = '58px';
      f.addEventListener('input', () => {
        latex = f.value;
        if (!readonly) {
          echo = true;
          void setDoc(latexRef(roomId), { tex: latex });
        }
      });
      host?.append(f);
      field = f as typeof field;
      ready = true;
    });

    off = onSnapshot(latexRef(roomId), (snap) => {
      const tex = snap.exists() ? ((snap.data() as { tex?: string }).tex ?? '') : '';
      if (echo && tex === latex) {
        echo = false;
        return;
      }
      latex = tex;
      if (field && field.value !== tex) field.value = tex;
    });

    return () => {
      disposed = true;
      off?.();
    };
  });

  export function value(): string {
    return latex;
  }
</script>

<div class="formula">
  <div bind:this={host} class="field" class:pending={!ready}></div>
  {#if !ready}<p class="hint">טוען עורך…</p>{/if}
  <pre class="tex" dir="ltr">{latex || '\\;'}</pre>
</div>

<style>
  .formula {
    display: grid;
    gap: 10px;
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
