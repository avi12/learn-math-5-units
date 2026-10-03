<script lang="ts">
  /* ---- one question at a time -----------------------------------------------
     Avi: "כל פעם רק שאלה אחת מופיעה ואני בוחר מה היא, כך שגם השאלה מוצגת לי, וכשסיימתי
     לפתור אני יכול ללחוץ על כפתור הסיום". So the card reads top to bottom as the work goes:
     choose, read, (write on the board below), finish. It is two controls over the one
     `pick` value — the chapter, then the exercise inside it. They cannot disagree: the
     chapter select only READS `pick`, and changing it writes a whole pick.

     Both devices show the card, because the choice syncs through the room: choose on
     either, write on the tablet, finish on the desktop. The finish button is desktop
     only — it hands the drawing to a conversation through a Chrome extension, and
     inside the Android wrapper there is no extension to hand it to. */
  import { untrack } from 'svelte';
  import { RUNG_LIST, TOPICS, exKey, type Topic } from './check';
  import type { Role } from './device';
  import { pickOf, type Choice } from './pick.svelte';
  import { readFlag, writeFlag } from './preferences';
  import iconFold from './icons/IconFold.svg?raw';
  import iconInspect from './icons/IconInspect.svg?raw';
  import iconNext from './icons/IconNext.svg?raw';
  import iconPlay from './icons/IconPlay.svg?raw';
  import iconPrev from './icons/IconPrev.svg?raw';
  import iconUnfold from './icons/IconUnfold.svg?raw';

  let { choice, role, oncheck }: { choice: Choice; role: Role; oncheck: () => void } = $props();

  const OTHER = 'אחר — לא מהחוברת';
  const LAST_TIER = RUNG_LIST[RUNG_LIST.length - 1].tier;

  function chapterName(t: Topic): string {
    return `${t.id} · ${t.title}`;
  }

  /** A lesson's length, so the row says how long it is before it is opened. */
  function mmss(s: number): string {
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  /* On the tablet the board is the screen, so the question can be folded away to its
     controls once it has been read. Per device, like the tool and the pen. */
  const SHOWQ_KEY = 'avi-math-showq';
  let showQ = $state(readFlag(SHOWQ_KEY));
  $effect(() => writeFlag(SHOWQ_KEY, showQ));

  /* Which way the question card's entrance sweeps: along the reading direction when the
     new question comes later in ORDER, against it when it comes earlier — so "הבא" and
     "הקודם" feel like moving through one list. Set in a pre-effect, i.e. before the keyed
     block re-renders with the new question. */
  let swapDir = $state<'fwd' | 'back'>('fwd');
  let swapAt = untrack(() => choice.at);
  /** The box the keyed question sits in. It outlives every swap, so it is what can go
   *  from the old question's height to the new one's. */
  let qbox = $state<HTMLDivElement>();
  /** the box's height just before the new question replaced the old one */
  let swapFrom = 0;
  $effect.pre(() => {
    const at = choice.at;
    if (at === swapAt) {
      return;
    }

    swapDir = at < swapAt ? 'back' : 'fwd';
    swapAt = at;
    swapFrom = untrack(() => qbox?.offsetHeight ?? 0);
  });

  /** A CSS time as milliseconds. The token is written `200ms` and read back as `0.2s`. */
  function toMs(v: string): number {
    return (parseFloat(v) || 0) * (/[^m]s\s*$/.test(v) ? 1000 : 1);
  }

  /* Avi: "צריך שגם הגובה ישתנה באנימציה". A height from one `auto` to another is not a
     change CSS can see — the content changed, not a style — so it is measured on both sides
     of the swap and played with the Web Animations API. It reads its duration and easing
     off the same tokens as the sweep, `--swap-dur` included, so reduced motion stops both
     from one place. The box clips while it moves, or the taller of the two questions would
     spill over the board for those frames; `overflow` animates discretely, so the clip is
     gone the moment the height lands. */
  $effect(() => {
    void choice.at;
    const box = untrack(() => qbox);
    const from = swapFrom;
    swapFrom = 0;
    if (!box || !from) {
      return;
    }

    const to = box.offsetHeight;
    if (Math.abs(to - from) < 1) {
      return;
    }

    const css = getComputedStyle(box);
    box.animate(
      [
        { height: `${from}px`, overflow: 'clip' },
        { height: `${to}px`, overflow: 'clip' }
      ],
      {
        duration: toMs(css.getPropertyValue('--swap-dur')),
        easing: css.getPropertyValue('--ease-emph').trim() || 'ease-out'
      }
    );
  });

  const ex = $derived(choice.exercise);
  const compact = $derived(role === 'pad');
  const folded = $derived(compact && !showQ);
</script>

<section class="card question" class:compact>
  <div class="qbar">
    <label class="group topic chapter">
      פרק
      <select value={choice.topic.id} onchange={(e) => choice.chooseChapter(e.currentTarget.value)}>
        {#each TOPICS as t (t.id)}
          <option value={t.id}><span class="tx">{chapterName(t)}</span></option>
        {/each}
      </select>
    </label>
    <label class="group topic exercise">
      תרגיל
      <select bind:value={choice.pick}>
        <!-- One group per rung, as the workbook is laid out. `label` is for the
             browser's own popup, `legend` for the styled one: with `appearance:
             base-select` the legend is a real element and can carry the rung and the
             workbook's own pips. -->
        {#each RUNG_LIST as r (r.tier)}
          {@const rows = choice.topic.exercises.filter((e) => e.tier === r.tier)}
          {@const lastRung = r.tier === LAST_TIER}
          {#if rows.length || lastRung}
            <optgroup label="מדרגה {r.tier} · {r.name}">
              <legend>
                <span class="grung">
                  <span class="tw tier" data-tier={r.tier}></span>
                  <span class="tx">
                    מדרגה {r.tier} · {r.name}
                    <span class="pips">
                      {#each RUNG_LIST as pp (pp.tier)}
                        <i class:on={Number(pp.tier) <= Number(r.tier)}></i>
                      {/each}
                    </span>
                  </span>
                </span>
              </legend>
              {#each rows as e (exKey(e))}
                <option value={pickOf(choice.topic.id, exKey(e))}>
                  <span class="tw"></span>
                  <span class="tx">{e.short}</span>
                </option>
              {/each}
              {#if lastRung}
                <!-- The pad is also used for a real bagrut question, so "not from the
                     workbook" has to be sayable — per chapter, because the criteria are. -->
                <option value={pickOf(choice.topic.id, '')} class="leaf">
                  <span class="tw"></span>
                  <span class="tx">{OTHER}</span>
                </option>
              {/if}
            </optgroup>
          {/if}
        {/each}
      </select>
    </label>
    {#if choice.letters.length}
      <label class="group topic narrow">
        סעיף
        <select bind:value={choice.section}>
          <option value=""><span class="tx">כל התרגיל</span></option>
          {#each choice.letters as l (l)}
            <option value={l}><span class="tx">{l}</span></option>
          {/each}
        </select>
      </label>
    {/if}
    <div class="group steps">
      <button class="btn" onclick={() => choice.step(-1)} disabled={choice.isFirst}>
        {@html iconPrev}הקודם
      </button>
      <button class="btn" onclick={() => choice.step(1)} disabled={choice.isLast}>
        הבא{@html iconNext}
      </button>
      {#if compact}
        <button class="btn" onclick={() => (showQ = !showQ)} aria-expanded={showQ}>
          {#if showQ}
            {@html iconFold}הסתר שאלה
          {:else}
            {@html iconUnfold}הצג שאלה
          {/if}
        </button>
      {/if}
    </div>
  </div>

  <!-- Keyed on the pick, so a new question is a new element and its entrance plays —
       whichever device or control changed it. -->
  <div class="qbox" bind:this={qbox}>
    {#key choice.pick}
      <div class="qswap" data-dir={swapDir}>
        <p class="qmeta">
          {chapterName(choice.topic)} · {ex?.label ?? OTHER}
        </p>
        {#if folded}
          <!-- folded: the controls stay, the question text goes -->
        {:else if ex}
          <div class="qtext">{@html ex.html}</div>
        {:else}
          <p class="qtext dim">
            שאלה שאינה מהחוברת: כתבו אותה על הלוח, וקלוד יקרא אותה משם. הבדיקה תיעשה לפי
            הקריטריונים של הפרק.
          </p>
        {/if}
        <!-- How this particular question is solved. Avi: "בעבור כל שאלה תוסיף קישורים
             לסרטונים רלוונטיים שמסבירים איך לפתור", then "אבל רק בדסקטופ" — so the row
             is gated on the role, like the finish button, and the tablet stays a page
             for writing on. Which videos those are is decided in the workbook repo
             (build/exvids.py) and arrives in graders.json; this only shows them.
             Inside the swap, so they arrive with the question they belong to. -->
        {#if !compact && ex?.videos.length}
          <div class="qvids">
            <span class="vlabel">איך פותרים</span>
            {#each ex.videos as v (v.id)}
              <a class="vlink chamfer-s" href={v.url} target="_blank" rel="noopener">
                {@html iconPlay}
                <span class="vtext">
                  <span class="vtitle">{v.title}</span>
                  <span class="vwho">{v.author} · <span dir="ltr">{mmss(v.sec)}</span></span>
                </span>
              </a>
            {/each}
          </div>
        {/if}
      </div>
    {/key}
  </div>

  {#if !compact}
    <div class="qfoot">
      <button class="btn big" data-variant="primary" onclick={oncheck}>
        {@html iconInspect}סיימתי — שקלוד יבדוק
      </button>
    </div>
  {/if}
</section>

<style>
  /* ---- the question card ---------------------------------------------------
     The chosen question, above the board. On the tablet the board is what the screen is
     for, so the card is compact there and the question scrolls inside it rather than
     pushing the board down; on the desktop it takes the room it needs. */
  .question {
    flex: none;
    margin-bottom: 14px;
    padding: 14px 16px;
    border-color: var(--border-strong);
  }
  .qbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 14px;
  }
  .topic.chapter {
    flex: 1 1 300px;
  }
  .topic.exercise {
    flex: 1 1 220px;
  }
  .steps .btn {
    padding-inline: 12px;
  }
  .qmeta {
    margin: 14px 0 6px;
    padding-bottom: 6px;
    border-bottom: 2px solid var(--border);
    background: linear-gradient(var(--cyber-stripe), var(--cyber-stripe)) bottom right / 44px 4px
      no-repeat;
    font-family: var(--font-mono);
    font-size: 12px;
    letter-spacing: 0.06em;
    color: var(--fg-muted);
  }
  .qtext {
    margin: 0;
    font-size: 17px;
    line-height: 1.85;
    color: var(--fg);
    /* an exercise with lettered parts breaks them onto lines (lib/tex.ts) */
    white-space: pre-line;
  }
  .qtext.dim {
    font-size: 14px;
    color: var(--fg-muted);
  }
  /* Every formula is its own LTR run — see lib/tex.ts for why that is not styling. NOT a
     scroll box: as one, a root sign's one-pixel overhang drew a scrollbar under formulas as
     short as √(x+4). A long formula wraps at its top-level = and + instead — Temml marks
     those breaks, and its stylesheet lets <math> wrap there.
     Avi: "לא טוב שיש גלילה אופקית". */
  .qtext :global(.tex) {
    unicode-bidi: isolate;
    white-space: normal;
  }
  .qtext :global(math) {
    font-size: 1.05em;
  }

  /* ---- a new question comes in -----------------------------------------------
     Avi: "כשאני מעביר בין תרגילים תעשה גם אנימציה מגניבה". A scanline crosses the card
     and the question resolves behind it: the text is uncovered at the line, flickers the
     way a tube settles, and a tint trails the line and fades. The heading glitches
     sideways once. It runs along the reading direction for a later question and against
     it for an earlier one (`swapDir`).

     Linear, like the capture scan in Surface.svelte and for the same reason: a scanner
     moves at one speed, and the skin's easing would have it at the far edge by a third of
     the way. Inside the skin's 200ms, so switching fast never waits on it. Nothing
     travels past the card's edges — the line and the tint grow inside it — so it cannot
     grow a scrollbar, and every layer ends at rest: the text un-clipped, the line and the
     tint at opacity 0. */
  .qbox {
    --swap-dur: var(--dur-long);
    /* the heading's margin stays inside, so the height measured is the height animated */
    display: flow-root;
  }
  .qswap {
    position: relative;
  }
  .qswap > :global(*) {
    animation: qResolveFwd var(--swap-dur) linear;
  }
  .qswap[data-dir='back'] > :global(*) {
    animation-name: qResolveBack;
  }
  .qswap > .qmeta {
    animation:
      qResolveFwd var(--swap-dur) linear,
      qGlitch var(--dur-medium) steps(4, end);
  }
  .qswap[data-dir='back'] > .qmeta {
    animation-name: qResolveBack, qGlitch;
  }
  .qswap::before,
  .qswap::after {
    content: '';
    position: absolute;
    inset-block: 0;
    pointer-events: none;
    opacity: 0;
    animation: qScan var(--swap-dur) linear;
  }
  /* the tint: from the edge the line left, up to the line */
  .qswap::before {
    inset-inline-start: 0;
    background: linear-gradient(to left, transparent, var(--accent-tint));
  }
  /* the line */
  .qswap::after {
    inset-inline-start: 0;
    border-inline-end: 2px solid var(--cyber-stripe);
    box-shadow: var(--cyber-glow-mark);
  }
  .qswap[data-dir='back']::before,
  .qswap[data-dir='back']::after {
    inset-inline: auto 0;
  }
  .qswap[data-dir='back']::before {
    background: linear-gradient(to right, transparent, var(--accent-tint));
  }
  .qswap[data-dir='back']::after {
    border-inline-end: none;
    border-inline-start: 2px solid var(--cyber-stripe);
  }
  /* The page is RTL, so "along the reading direction" is right to left: the uncovered
     part grows from the right edge. clip-path is physical, hence the two keyframes. */
  @keyframes qResolveFwd {
    0% {
      clip-path: inset(0 0 0 100%);
      opacity: 0.4;
    }
    20% {
      opacity: 1;
    }
    30% {
      opacity: 0.55;
    }
    45% {
      opacity: 1;
    }
    100% {
      clip-path: inset(0 0 0 0);
    }
  }
  @keyframes qResolveBack {
    0% {
      clip-path: inset(0 100% 0 0);
      opacity: 0.4;
    }
    20% {
      opacity: 1;
    }
    30% {
      opacity: 0.55;
    }
    45% {
      opacity: 1;
    }
    100% {
      clip-path: inset(0 0 0 0);
    }
  }
  @keyframes qScan {
    0% {
      width: 0;
      opacity: 1;
    }
    85% {
      opacity: 1;
    }
    100% {
      width: 100%;
      opacity: 0;
    }
  }
  /* four hard frames: a split into the two accents, a kick each way, and gone */
  @keyframes qGlitch {
    0% {
      transform: translateX(3px);
      text-shadow:
        -2px 0 var(--accent-2),
        2px 0 var(--cyber-stripe);
    }
    25% {
      transform: translateX(-2px);
    }
    50% {
      transform: translateX(1px);
      text-shadow:
        1px 0 var(--accent-2),
        -1px 0 var(--cyber-stripe);
    }
    100% {
      transform: none;
      text-shadow: none;
    }
  }
  /* The skin's global rule already cuts every CSS duration to nothing; the line and the tint
     are not shown at all, so what is left is the new question, at once. */
  @media (prefers-reduced-motion: reduce) {
    .qbox {
      --swap-dur: 0.001ms; /* the height is played from script, out of the global rule's reach */
    }
    .qswap::before,
    .qswap::after {
      display: none;
    }
  }
  .question.compact {
    padding: 10px 12px;
    margin-bottom: 10px;
  }
  /* the selects already say which chapter and which question; the meta line is the
     desktop's, where there is room for it */
  .question.compact .qmeta {
    display: none;
  }
  .question.compact .qtext {
    margin-top: 8px;
    max-height: 17svh;
    overflow-y: auto;
    /* scrolling on one axis makes the other one `auto` too, and the same one-pixel
       overhang would then scroll sideways; questioncheck.mjs proves nothing real is cut */
    overflow-x: hidden;
    font-size: 15.5px;
    line-height: 1.7;
  }
  /* ---- how this question is solved ------------------------------------------
     Two links under the question, in the chassis language of everything else: chamfered,
     2px outline, mono for the channel and the length. Not thumbnails — the card sits on
     top of the board and every pixel it takes is a pixel not being written on, and a row
     of images would also be the only part of this page that waits on the network.

     They wrap instead of scrolling. A title here can be sixty characters and arrive in
     Hebrew or in English, so the chip grows downwards, `min-width: 0` lets it be
     narrower than its text, and the text breaks anywhere rather than pushing the page
     sideways — Avi: "לא טוב שיש גלילה אופקית", and questioncheck.mjs measures it.
     `isolate` on the title and on the length is the same rule as on a formula: a mixed
     run inside an RTL line has to be its own box, or "8:13" and a trailing "| Algebra"
     land on the wrong side. */
  .qvids {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 14px;
  }
  .vlabel {
    flex: none;
    align-self: center;
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.07em;
    color: var(--fg-muted);
  }
  .vlink {
    flex: 1 1 300px;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 10px;
    border: 2px solid var(--border);
    background: var(--surface-2);
    color: var(--fg);
    text-decoration: none;
    transition:
      background var(--dur-short) var(--ease-emph),
      border-color var(--dur-short) var(--ease-emph);
  }
  .vlink:hover,
  .vlink:focus-visible {
    background: var(--hover);
    border-color: var(--primary);
  }
  .vtext {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .vtitle {
    unicode-bidi: isolate;
    overflow-wrap: anywhere;
    font-size: 13.5px;
    line-height: 1.35;
  }
  .vwho {
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.04em;
    color: var(--fg-muted);
    unicode-bidi: isolate;
  }
  .qfoot {
    display: flex;
    justify-content: flex-end;
    margin-top: 12px;
  }
</style>
