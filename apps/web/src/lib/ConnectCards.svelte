<script lang="ts">
  /** Desktop only. On the tablet these two cards are noise: the QR exists to get the
   *  tablet into the room, so by the time it is being read there it has done its job,
   *  and the instructions are about pasting into Claude, which happens on the desktop.
   *
   *  Each folds to its heading, and stays folded across reloads: once the tablet is paired
   *  and the steps are known, they are only taking height from the board — and the board
   *  takes back whatever they give up (the mirror's slot is the page's leftover, App.svelte). */
  import { confirm, say } from './notify.svelte';
  import { StorageKey, readFlag, writeFlag } from './preferences';
  import { joinUrl } from './qr';
  import { newRoom } from './room';
  import iconLink from './icons/IconLink.svg?raw';
  import iconPlus from './icons/IconPlus.svg?raw';

  let { id, qr }: { id: string; qr: string } = $props();

  let showConnect = $state(readFlag(StorageKey.SHOW_CONNECT));
  let showHowto = $state(readFlag(StorageKey.SHOW_HOWTO));
  $effect(() => writeFlag(StorageKey.SHOW_CONNECT, showConnect));
  $effect(() => writeFlag(StorageKey.SHOW_HOWTO, showHowto));

  async function copyLink() {
    await navigator.clipboard.writeText(joinUrl(id));
    say('הקישור הועתק');
  }

  async function openNewRoom() {
    if (!(await confirm('לפתוח חדר חדש? הישן יישאר במקומו.'))) {
      return;
    }

    newRoom();
  }
</script>

<section class="pair">
  <details class="card" bind:open={showConnect}>
    <summary><h2 class="card-head">חיבור הטאבלט</h2></summary>
    <div class="qrrow">
      {#if qr}<img class="qr" src={qr} alt="קוד QR לפתיחת אותו חדר בטאבלט" />{/if}
      <div>
        <p class="note">
          סרוק פעם אחת מהטאבלט, או העתק את הקישור ושלח לעצמך. שני המכשירים נשארים באותו חדר
          גם אחרי סגירה — הוא נשמר בדפדפן.
        </p>
        <div class="group">
          <button class="btn" onclick={copyLink}>{@html iconLink}העתק קישור</button>
          <button class="btn" onclick={openNewRoom}>{@html iconPlus}חדר חדש</button>
        </div>
        <p class="roomid">חדר <code>{id.slice(0, 8)}…</code></p>
      </div>
    </div>
  </details>

  <details class="card" bind:open={showHowto}>
    <summary><h2 class="card-head">מה עושים עם זה</h2></summary>
    <ol class="note">
      <li>כותבים את התרגיל או מציירים את הצורה בטאבלט.</li>
      <li>הכתב מופיע כאן במחשב תוך כדי כתיבה.</li>
      <li><b>העתק כתמונה</b> ואז מדביקים ישירות בשיחה עם קלוד או שולחים למורה.</li>
    </ol>
    <p class="note dim">
      הכתב עובר כתמונה, וקלוד קורא אותה ישירות — כתב יד, סרטוטים וסימנים שאין להם
      מקלדת. אין כאן שלב של הקלדה מחדש ואין מה לתקן בדרך.
    </p>
  </details>
</section>

<style>
  .pair {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 16px;
    align-items: start;
    margin-block-start: 26px;

    /* lets the fold animate to and from `auto` */
    interpolate-size: allow-keywords;
  }

  summary {
    display: flex;
    align-items: center;
    cursor: pointer;
    list-style: none;

    &::-webkit-details-marker {
      display: none;
    }

    .card-head {
      flex: 1;
      margin: 0;
    }

    /* the same + / − the reel's acts fold with (SeqReel.svelte) */
    &::after {
      content: "−";
      margin-inline-start: 12px;
      color: var(--primary);
      font: 700 20px/1 var(--font-mono);
    }

    &:focus-visible {
      outline: 2px solid var(--border-strong);
      outline-offset: 2px;
    }

    & + * {
      margin-block-start: var(--s-4);
    }
  }

  details {
    &:not([open]) summary::after {
      content: "+";
    }

    /* The fold: the content's height runs to and from nothing, and the browser keeps it
       rendered until the closing run ends. The gap under the heading is the content's
       own, so a folded card is its heading and nothing more. */
    &::details-content {
      block-size: 0;
      overflow: clip;
      transition:
        block-size var(--dur-long) var(--ease-emph),
        content-visibility var(--dur-long) allow-discrete;
    }

    &[open]::details-content {
      block-size: auto;
    }

    @media (prefers-reduced-motion: reduce) {
      &::details-content {
        transition: none;
      }
    }
  }

  .qrrow {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    align-items: flex-start;
  }

  .qr {
    width: 132px;
    height: 132px;
    border: 2px solid var(--border);
    background: #ffffff;
    image-rendering: pixelated;
  }

  .note {
    margin-block: 0 12px;
    margin-inline: 0;
    color: var(--fg-muted);
    font-family: var(--font-mono);
    font-size: 12.5px;
    line-height: 1.6;

    &.dim {
      margin-block-end: 0;
      color: var(--fg-subtle);
    }

    &:is(ol) {
      padding-inline-start: 1.2em;

      li {
        margin-block: 4px;
      }
    }
  }

  .roomid {
    margin-block: 10px 0;
    margin-inline: 0;
    color: var(--fg-subtle);
    font-family: var(--font-mono);
    font-size: 11px;
  }
</style>
