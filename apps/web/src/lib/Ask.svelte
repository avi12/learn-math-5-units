<script lang="ts">
  /** The page's own confirm and prompt, as elements.
   *
   * `window.confirm` and `window.prompt` were doing this job and they were the wrong tool
   * three times over. They are the browser's chrome, so they cannot wear the skin — a
   * grey system box in the middle of a HUD. They block the main thread, which on a board
   * that is mid-stroke is not free. And inside the Android wrapper they do not exist
   * unless the WebChromeClient answers them: a WebView with no chrome client replies "no"
   * instantly and by itself, so "נקה" would quietly do nothing at all on the tablet.
   *
   * `<dialog>` with `showModal()` gives the same modality — focus trapped, Escape closes,
   * a real backdrop — out of elements the page owns and can style.
   *
   * The API is deliberately the shape the old calls had, so the call sites read the same
   * way they always did, except for an `await`.
   */
  import iconCheck from './icons/IconCheck.svg?raw';
  import iconClose from './icons/IconClose.svg?raw';

  let el = $state<HTMLDialogElement>();
  let mode = $state<'confirm' | 'prompt'>('confirm');
  let text = $state('');
  let value = $state('');
  let field = $state<HTMLInputElement>();
  let settle: ((v: boolean | string | null) => void) | null = null;

  function open(next: 'confirm' | 'prompt', message: string, initial = '') {
    mode = next;
    text = message;
    value = initial;
    el?.showModal();
    if (next === 'prompt') {
      queueMicrotask(() => field?.select());
    }
  }

  /** true if confirmed. */
  export function confirm(message: string): Promise<boolean> {
    return new Promise((resolve) => {
      settle = (v) => resolve(v === true);
      open('confirm', message);
    });
  }

  /** the typed text, or null if it was dismissed — exactly what window.prompt returned. */
  export function prompt(message: string, initial = ''): Promise<string | null> {
    return new Promise((resolve) => {
      settle = (v) => resolve(typeof v === 'string' ? v : null);
      open('prompt', message, initial);
    });
  }

  /** What the caller is handed: null for a cancel, else the typed text or true. */
  function answerFor(ok: boolean): boolean | string | null {
    if (!ok) {
      return null;
    }

    return mode === 'prompt' ? value : true;
  }

  function done(ok: boolean) {
    const answer = answerFor(ok);
    el?.close();
    const f = settle;
    settle = null;
    f?.(answer);
  }

  /* Escape, or a click on the backdrop, is a cancel — and it has to settle the promise
     or the caller waits for ever. `close` fires for every one of those routes. */
  function onclose() {
    const f = settle;
    settle = null;
    f?.(null);
  }
</script>

<dialog
  bind:this={el}
  class="ask"
  {onclose}
  onclick={(e) => {
    if (e.target === el) {
      done(false);
    }
  }}
>
  <form
    method="dialog"
    onsubmit={(e) => {
      e.preventDefault();
      done(true);
    }}
  >
    <p class="msg">{text}</p>
    {#if mode === 'prompt'}
      <!-- svelte-ignore a11y_autofocus -->
      <input bind:this={field} bind:value class="field" autofocus dir="auto" />
    {/if}
    <div class="row">
      <button class="btn" data-variant="primary" data-ask="ok" type="submit">
        {@html iconCheck}אישור
      </button>
      <button class="btn" data-ask="cancel" type="button" onclick={() => done(false)}>
        {@html iconClose}ביטול
      </button>
    </div>
  </form>
</dialog>

<style>
  .ask {
    /* Two knobs for the whole entrance, so reduced motion is a value and not a rewrite. */
    --ask-dur: var(--dur-long);
    --ask-fast: 90ms;
    padding: 0;
    /* The sweep below travels past the bottom edge on its way out. `clip-path` hides it
       but does not stop it counting as overflow, and the panel grew a scrollbar — visible
       in a frame capture, not by looking at the CSS. */
    overflow: hidden;
    border: 2px solid var(--border-strong);
    background: var(--surface);
    color: var(--fg);
    box-shadow: var(--shadow-lg);
    max-width: min(30rem, calc(100vw - 32px));
    clip-path: polygon(
      var(--chamfer) 0,
      100% 0,
      100% calc(100% - var(--chamfer)),
      calc(100% - var(--chamfer)) 100%,
      0 100%,
      0 var(--chamfer)
    );
  }
  /* It powers on like a screen: a bright slit that snaps open vertically. That is the
     whole trick — opacity arrives almost at once (90ms) while the height takes the full
     200ms, so what you see is a lit line that opens, not a box that fades in.
     A <dialog> is `display: none` until it opens, so the entrance needs `allow-discrete`:
     without it the box appears at full size and only the opacity moves, and on the way
     OUT it vanishes on the first frame because display flips before anything can run. */
  .ask {
    opacity: 0;
    transform: scaleY(0.02);
    /* LEAVING. The two move together, so the box is still there while it collapses.
       The fast opacity below belongs to the entrance only: applied to the exit as well it
       made the panel blink out in about 15ms and leave the scrim fading over the page on
       its own for the remaining 200 — which looked like a dark wash appearing on click,
       with nothing to explain it. A transition is read off the state being moved TO, so
       putting each timing on its own state is all it takes to make them differ. */
    transition:
      opacity var(--ask-dur) var(--ease-emph),
      transform var(--ask-dur) var(--ease-emph),
      overlay var(--ask-dur) allow-discrete,
      display var(--ask-dur) allow-discrete;
  }
  .ask[open] {
    opacity: 1;
    transform: none;
    /* ARRIVING. Light first, then height — that is what makes it a slit opening. */
    transition:
      opacity var(--ask-fast) var(--ease-emph),
      transform var(--ask-dur) var(--ease-emph),
      overlay var(--ask-dur) allow-discrete,
      display var(--ask-dur) allow-discrete;
  }
  /* Where it comes FROM. Without this the element is already at its open value on the
     first frame and there is nothing to animate. */
  @starting-style {
    .ask[open] {
      opacity: 0;
      transform: scaleY(0.02);
    }
  }

  /* One scanline crossing the panel as it settles. It is ambience and nothing depends on
     it, so it is `pointer-events: none` and it runs exactly once — a loop here would turn
     a dialog you are reading into a thing that keeps moving. The chamfer clip-path on the
     panel is what stops it spilling past the corners. */
  .ask::after {
    content: '';
    position: absolute;
    inset-inline: 0;
    top: 0;
    height: 40%;
    background: linear-gradient(180deg, transparent, var(--accent-tint), transparent);
    /* `forwards` is not optional here. The default fill mode is `none`, so the moment the
       sweep finishes the element snaps back to its UNANIMATED position — top: 0, height
       40% — and a pale blue wash parks itself across the title and stays there. It looked
       like a gradient someone had put on the heading on purpose. */
    animation: sweep 420ms var(--ease-emph) 1 forwards;
    pointer-events: none;
  }
  @keyframes sweep {
    from {
      transform: translateY(-110%);
    }
    to {
      transform: translateY(360%);
    }
  }

  .ask::backdrop {
    background: var(--scrim);
    opacity: 0;
    transition:
      opacity var(--ask-dur) var(--ease-emph),
      overlay var(--ask-dur) allow-discrete,
      display var(--ask-dur) allow-discrete;
  }
  .ask[open]::backdrop {
    opacity: 1;
  }
  @starting-style {
    .ask[open]::backdrop {
      opacity: 0;
    }
  }

  /* The skin's global reduced-motion rule is `*, *::before, *::after` — and a backdrop is
     none of those, so it would keep fading after the box had stopped. Killing it here by
     the same knob covers both, and covers them together. */
  @media (prefers-reduced-motion: reduce) {
    .ask {
      --ask-dur: 0.001ms;
      --ask-fast: 0.001ms;
    }
    /* The sweep is decoration, so under reduce it does not run at all rather than run
       instantly — an instant flash is still a flash. */
    .ask::after {
      animation: none;
      display: none;
    }
  }
  form {
    display: flex;
    flex-direction: column;
    gap: var(--s-5);
    padding: var(--s-6);
  }
  /* No 44px stub here. That mark means "this is a card header" everywhere else in these
     pages, and a one-line question is not a section heading — on a sentence it reads as
     decoration, which is what it looked like. The 2px rule stays: it does actual work,
     separating the question from the two buttons that answer it. */
  .msg {
    margin: 0;
    padding-block-end: var(--s-3);
    border-block-end: 2px solid var(--border);
    font: var(--t-title-m);
    letter-spacing: 0.05em;
  }
  .field {
    padding: 10px 12px;
    border: 2px solid var(--border);
    background: var(--surface-2);
    color: var(--fg);
    font: var(--t-body-m);
    font-family: var(--font-mono);
  }
  .field:focus-visible {
    outline: none;
    box-shadow: inset 0 0 0 2px var(--primary), var(--cyber-glow-primary);
  }
  .row {
    display: flex;
    gap: var(--s-3);
    justify-content: flex-start;
  }
</style>
