<script lang="ts">
  /* ---- what Gemini wrote down -------------------------------------------------
     Avi: "תאפשר לג'ימיני גם להזריק דברים לדף לדוגמא נוסחאות ב-LaTeX (לדוגמא 'תזכיר לי
     מה הנוסחה...')". A note arrives on the desktop from the extension and reaches the
     tablet over the direct link (lib/directlink.ts), because the tablet is where the
     person is when they ask. The same card on both, with the session's state above it,
     so the tablet can see that Gemini is listening without looking up at the desktop.

     The body is prose with `$…$` formulas, the exercises' own fence, and it is rendered
     by the exercises' own code (lib/tex.ts) — loaded only when the first note arrives,
     since that is the one time this page converts TeX in the browser. Temml is a quarter
     of a bundle, and a session that never asks for a formula should not pay for it. */
  import IconClose from './icons/IconClose.svg?raw';
  import IconLive from './icons/IconLive.svg?raw';
  import { dismissNote, isRunning, live, liveLabel } from './live.svelte';

  /** On the tablet: the session's state shows here (the desktop has it already, next to
   *  the button that started it), and the card is compact — its height comes out of the
   *  board's, and below the board sit the tools, which must stay on the screen. */
  let { onPad = false }: { onPad?: boolean } = $props();

  /** note id → its body as HTML, filled in as the renderer gets to each one */
  let shown = $state<Record<string, string>>({});

  $effect(() => {
    for (const n of live.notes) {
      if (!(n.id in shown)) {
        shown[n.id] = '';
        void import('./tex').then(({ exerciseHtml }) => (shown[n.id] = exerciseHtml(n.body)));
      }
    }
  });

  const running = $derived(onPad && isRunning(live.state));
</script>

{#if running || live.notes.length}
  <section class="card notes" class:pad={onPad} aria-live="polite">
    {#if running}
      <p class="lstate" data-state={live.state} data-blind={live.blind || undefined}>{@html IconLive}{liveLabel()}</p>
    {/if}
    {#each live.notes as n (n.id)}
      <article class="note chamfer-s">
        <h3>{n.title}</h3>
        <div class="nbody">{@html shown[n.id] || ''}</div>
        <button class="btn close" onclick={() => dismissNote(n.id)} aria-label="סגור את הפתק">
          {@html IconClose}
        </button>
      </article>
    {/each}
  </section>
{/if}

<style>
  /* Its own row, never floating over the board: the board is the one thing on the page
     the person filled, and nothing may cover it (the stall banner learned that first). On
     the tablet that row comes out of the board's height, so it is capped and scrolls. */
  .notes {
    /* the MathML's hidden annotation is absolutely placed; keep it in here */
    position: relative;
    display: flex;
    flex: none;
    flex-direction: column;
    gap: 8px;
    max-block-size: 32svh;
    margin-block-end: 14px;
    overflow-y: auto;
    padding: 10px 14px;

    &.pad {
      gap: 6px;
      max-block-size: 22svh;
      margin-block-end: 10px;
      padding: 6px 10px;
    }
  }

  .lstate {
    display: flex;
    gap: 8px;
    align-items: center;
    margin: 0;
    color: var(--fg-muted);
    font-family: var(--font-mono);
    font-size: 13px;
    letter-spacing: 0.06em;

    & :global(svg) {
      width: 16px;
      height: 16px;
    }

    &[data-state="live"] :global(svg) {
      color: var(--cat-3);
      animation: live-pulse 1600ms var(--ease-emph) infinite;

      @media (prefers-reduced-motion: reduce) {
        animation: none;
      }
    }

    &[data-blind] :global(svg) {
      color: var(--warn);
      animation: none;
    }
  }

  .note {
    position: relative;
    padding-block: 8px 10px;
    padding-inline: 12px 44px;
    border: 2px solid var(--border);
    background: var(--surface-2);

    .notes.pad & {
      padding-block: 4px 6px;
    }

    h3 {
      margin-block: 0 4px;
      margin-inline: 0;
      font: var(--t-title-s);
      letter-spacing: 0.07em;
    }
  }

  .nbody {
    color: var(--fg);
    font-size: 17px;
    line-height: 1.8;

    /* a note is a few lines; keep them, as the exercises do (lib/tex.ts) */
    white-space: pre-line;

    .notes.pad & {
      font-size: 15px;
      line-height: 1.6;
    }

    & :global(.tex) {
      white-space: normal;
      unicode-bidi: isolate;
    }

    /* A note is there to be read off at a glance, so a fraction is set at full size, as on
       its own line in a textbook — not shrunk to fit a line of prose. */
    & :global(math) {
      math-style: normal;
    }
  }

  .close {
    position: absolute;
    inset-block-start: 6px;
    inset-inline-end: 6px;
    padding: 4px;
  }

  @keyframes live-pulse {
    50% {
      opacity: 35%;
    }
  }
</style>
