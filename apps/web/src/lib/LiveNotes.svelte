<script lang="ts">
  /* ---- what Gemini wrote down -------------------------------------------------
     Avi: "תאפשר לג'ימיני גם להזריק דברים לדף לדוגמא נוסחאות ב-LaTeX (לדוגמא 'תזכיר לי
     מה הנוסחה...')". A note arrives on the desktop from the extension, and there it
     stays: "הסעיפים שג'מיני רושם לדף צריכים להיראות בדסקטופ, לא בטבלט" (Avi,
     15.10.2026). The tablet is a page to write on; what it gets from this card is the
     session's state, so it can see that Gemini is listening without looking up.

     A note unfolds as it arrives and folds away as it goes — closed, pushed out by a
     newer one, or left behind with its question: "והם צריכים להופיע/להיסגר בצורה של
     אנימציה". Both are CSS — the arrival is `@starting-style`, the leaving is
     `data-leaving`, which the transitions run to — and the note is dropped from the
     list only when that run ends.

     The body is prose with `$…$` formulas, the exercises' own fence, and it is rendered
     by the exercises' own code (lib/tex.ts) — loaded only when the first note arrives,
     since that is the one time this page converts TeX in the browser. Temml is a quarter
     of a bundle, and a session that never asks for a formula should not pay for it. */
  import IconClose from './icons/IconClose.svg?raw';
  import IconLive from './icons/IconLive.svg?raw';
  import { dismissNote, dropNote, isRunning, leaving, live, liveLabel, NOTES_MAX } from './live.svelte';

  /** On the tablet: the session's state shows here (the desktop has it already, next to
   *  the button that started it), and no notes. */
  let { onPad = false }: { onPad?: boolean } = $props();

  const notes = $derived(onPad ? [] : live.notes);
  const running = $derived(onPad && isRunning(live.state));

  /** note id → its body as HTML, filled in as the renderer gets to each one ('' until) */
  let shown = $state<Record<string, string>>({});

  $effect(() => {
    for (const n of notes) {
      if (!(n.id in shown)) {
        shown[n.id] = '';
        void import('./tex').then(({ exerciseHtml }) => (shown[n.id] = exerciseHtml(n.body)));
      }
    }
  });

  /** A note goes up once its body is ready, so it unfolds to its whole height. The first
   *  one waits for the renderer to load; shown at once, it would unfold to a title and
   *  then jump when its formulas landed. */
  const ready = $derived(notes.filter((n) => shown[n.id]));

  // Sent off before it was ever on the screen, a note has no fold to run, so nothing
  // would drop it: it goes now.
  $effect(() => {
    for (const n of notes) {
      if (!shown[n.id] && leaving.has(n.id)) {
        dropNote(n.id);
      }
    }
  });

  /** The fold has run: the note's own opacity, not a transition bubbling up from inside
   *  it (the close button has its own). Opacity, because it runs in every browser — the
   *  height runs only where `interpolate-size` does. */
  function folded(e: TransitionEvent): boolean {
    return e.target === e.currentTarget && e.propertyName === 'opacity';
  }
</script>

{#if running || ready.length}
  <section class="card notes" class:pad={onPad} aria-live="polite">
    {#if running}
      <p class="lstate" data-state={live.state} data-blind={live.blind || undefined}>{@html IconLive}{liveLabel()}</p>
    {/if}
    {#each ready as n, i (n.id)}
      {@const goes = i >= NOTES_MAX || leaving.has(n.id)}
      <article
        class="note chamfer-s"
        data-leaving={goes || undefined}
        inert={goes}
        ontransitionend={(e) => {
          if (goes && folded(e)) {
            dropNote(n.id);
          }
        }}
      >
        <h3>{n.title}</h3>
        <div class="nbody">{@html shown[n.id]}</div>
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
    /* How the card and each note fold, in and out: height, the room around it, and
       light. One list for both, so they run as one. Twice the skin's longest snap: the
       curve is front-loaded, and at 200 ms a note pushing the board down was done in 80
       — measured, and it read as the page jumping, not as a note arriving. */
    --fold-dur: calc(var(--dur-long) * 2);
    --fold:
      block-size var(--fold-dur) var(--ease-emph),
      margin-block-end var(--fold-dur) var(--ease-emph),
      padding-block var(--fold-dur) var(--ease-emph),
      /* at once, at the start: a border under 1px is drawn as 1px, so a running one held
         the last 4px open and the board jumped them when the note went */
      border-block-width var(--fold-dur) step-start,
      opacity var(--fold-dur) var(--ease-emph);

    /* the MathML's hidden annotation is absolutely placed; keep it in here */
    position: relative;
    display: flex;
    flex: none;
    flex-direction: column;
    max-block-size: 32svh;
    margin-block-end: 14px;
    overflow-y: auto;

    /* the last note's own 8px under it makes the bottom 10 */
    padding: 10px 14px 2px;

    /* lets the folds run to and from `auto` */
    interpolate-size: allow-keywords;
    transition: var(--fold);

    &.pad {
      max-block-size: 22svh;
      margin-block-end: 10px;
      padding: 6px 10px;
    }

    /* Every note in it on its way out: the card folds with the last of them, so nothing
       is left standing to vanish in one frame when the list empties. Its height is not
       folded here: it is its notes', and follows theirs — a card running its own height
       would overflow mid-fold and flash the scrollbar it keeps for a long list. */
    &:has(.note):not(:has(.note:not([data-leaving]))) {
      margin-block-end: 0;
      padding-block: 0;
      border-block-width: 0;
      opacity: 0%;
    }

    /* After the card's own padding and margin above, not before: the two tie on
       specificity, and where the card comes FROM has to be the one that wins. */
    @starting-style {
      margin-block-end: 0;
      padding-block: 0;
      border-block-width: 0;
      opacity: 0%;
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
    flex: none;
    margin-block-end: 8px;
    padding-block: 8px 10px;
    padding-inline: 12px 44px;
    border: 2px solid var(--border);
    background: var(--surface-2);

    /* The fold shuts over what is inside. And down to nothing: a flex item will not go
       below its content's height on its own, and `clip` does not make it a scroller that
       would — measured, the fold stopped at 55 px and the note then vanished from there. */
    overflow: clip;
    min-block-size: 0;
    transition: var(--fold);

    h3 {
      margin-block: 0 4px;
      margin-inline: 0;
      font: var(--t-title-s);
      letter-spacing: 0.07em;
    }

    &[data-leaving] {
      block-size: 0;
      margin-block-end: 0;
      padding-block: 0;
      border-block-width: 0;
      opacity: 0%;
    }

    @starting-style {
      block-size: 0;
      margin-block-end: 0;
      padding-block: 0;
      border-block-width: 0;
      opacity: 0%;
    }
  }

  .nbody {
    color: var(--fg);
    font-size: 17px;
    line-height: 1.8;

    /* a note is a few lines; keep them, as the exercises do (lib/tex.ts) */
    white-space: pre-line;

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
