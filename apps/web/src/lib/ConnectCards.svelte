<script lang="ts">
  /** Desktop only. On the tablet these two cards are noise: the QR exists to get the
   *  tablet into the room, so by the time it is being read there it has done its job,
   *  and the instructions are about pasting into Claude, which happens on the desktop. */
  import { confirm, say } from './notify.svelte';
  import { joinUrl } from './qr';
  import { newRoom } from './room';
  import iconLink from './icons/IconLink.svg?raw';
  import iconPlus from './icons/IconPlus.svg?raw';

  let { id, qr }: { id: string; qr: string } = $props();

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
  <div class="card">
    <h2 class="card-head">חיבור הטאבלט</h2>
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
  </div>

  <div class="card">
    <h2 class="card-head">מה עושים עם זה</h2>
    <ol class="note">
      <li>כותבים את התרגיל או מציירים את הצורה בטאבלט.</li>
      <li>הכתב מופיע כאן במחשב תוך כדי כתיבה.</li>
      <li><b>העתק כתמונה</b> ואז מדביקים ישירות בשיחה עם קלוד או שולחים למורה.</li>
    </ol>
    <p class="note dim">
      הכתב עובר כתמונה, וקלוד קורא אותה ישירות — כתב יד, סרטוטים וסימנים שאין להם
      מקלדת. אין כאן שלב של הקלדה מחדש ואין מה לתקן בדרך.
    </p>
  </div>
</section>

<style>
  .pair {
    display: grid;
    gap: 16px;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    margin-top: 26px;
  }
  .qrrow {
    display: flex;
    gap: 16px;
    align-items: flex-start;
    flex-wrap: wrap;
  }
  .qr {
    width: 132px;
    height: 132px;
    border: 2px solid var(--border);
    background: #fff;
    image-rendering: pixelated;
  }
  .note {
    margin: 0 0 12px;
    font-family: var(--font-mono);
    font-size: 12.5px;
    line-height: 1.6;
    color: var(--fg-muted);
  }
  .note.dim {
    color: var(--fg-subtle);
    margin-bottom: 0;
  }
  ol.note {
    padding-inline-start: 1.2em;
  }
  ol.note li {
    margin-block: 4px;
  }
  .roomid {
    margin: 10px 0 0;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg-subtle);
  }
</style>
