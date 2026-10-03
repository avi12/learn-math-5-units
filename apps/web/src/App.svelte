<script lang="ts">
  /** The page: which device this is, the room both devices share, and how the parts sit
   *  on the screen. Each part owns its own job —
   *    QuestionCard   which exercise, and the question itself
   *    Surface        the board
   *    PadTools       what the pen draws with (tablet)
   *    CopyTools      the board out to the clipboard (desktop)
   *    RoomJoin       the tablet's ways into the desktop's room
   *    ConnectCards   the desktop's code and link for the tablet
   *  — and this file only wires them together. */
  import { onMount } from 'svelte';
  import Ask from './lib/Ask.svelte';
  import ConnectCards from './lib/ConnectCards.svelte';
  import CopyTools from './lib/CopyTools.svelte';
  import PadTools from './lib/PadTools.svelte';
  import QuestionCard from './lib/QuestionCard.svelte';
  import RoomJoin from './lib/RoomJoin.svelte';
  import Surface, { type SurfaceApi } from './lib/Surface.svelte';
  import { sendForCheck } from './lib/check';
  import { initialRole } from './lib/device';
  import { History } from './lib/history.svelte';
  import { ASPECT, GRID_SCALE, gridCell, PEN_SIZE, type Tool } from './lib/ink';
  import { confirm, provideAsk, say, toast } from './lib/notify.svelte';
  import { Choice } from './lib/pick.svelte';
  import { RoomValue } from './lib/roomvalue.svelte';
  import { readFlag, writeFlag } from './lib/preferences';
  import { joinUrl, qrImage } from './lib/qr';
  import { watchRelease } from './lib/release';
  import { clearAll, room as makeRoom, roomId, unsentWrites } from './lib/room';
  import { pad } from './lib/spen';
  import iconDisplay from './lib/icons/IconDisplay.svg?raw';
  import iconPad from './lib/icons/IconPad.svg?raw';
  import iconRedo from './lib/icons/IconRedo.svg?raw';
  import iconTrash from './lib/icons/IconTrash.svg?raw';
  import iconUndo from './lib/icons/IconUndo.svg?raw';

  const id = roomId();
  const room = makeRoom(id);
  const inWrapper = !!pad();

  let role = $state(initialRole());
  const isPad = $derived(role === 'pad');

  let tool = $state<Tool>('ink');
  /* Shape corners snap to the notebook grid. Per device, like the question fold, and
     on by default: a straight line in a math notebook is meant to sit on the squares. */
  const SNAP_KEY = 'avi-math-snap';
  let isSnapping = $state(readFlag(SNAP_KEY));
  $effect(() => writeFlag(SNAP_KEY, isSnapping));

  const grid = new RoomValue(id, 'grid', GRID_SCALE);
  const size = new RoomValue(id, 'size', PEN_SIZE);

  let surface = $state<SurfaceApi>();
  /** How many page-sized parts the strip exports as, and which one the board is sitting
   *  on. One part means a strip that fits a page, and then there is nothing to choose. */
  let parts = $state(1);
  let part = $state(0);
  /** the pen is on the glass right now — a reload waits it out. See lib/release.ts. */
  let penDown = $state(false);
  let qr = $state('');
  /** the QR blown up, for scanning from across the desk */
  let bigQr = $state(false);

  const history = new History(id);
  const choice = new Choice(id);

  let ask = $state<Ask>();
  $effect(() => provideAsk(ask));

  onMount(() => {
    // Inside the wrapper no code is ever shown (see the chip below), so it is not made.
    if (!inWrapper) {
      void qrImage(joinUrl(id)).then((d) => (qr = d));
    }

    // A deploy reaches the tab by asking hosting what is live; see lib/release.ts for
    // why it waits before it takes the page away, and what it waits for.
    return watchRelease({
      // The pen on the glass, OR ink the server has not taken. The second one was
      // missing and it is the one that loses work: Firestore is on the memory cache, so
      // the queue of unsent strokes dies with the document. On 19.09.2026 the write
      // quota ran out while the tablet had a full board of working on it, and a deploy
      // at that moment would have reloaded the page and thrown all of it away — the
      // auto-reload doing exactly what it was asked to do, to the worst possible end.
      // A tab that cannot save yet stays where it is, however old its bundle.
      busy: () => penDown || unsentWrites() > 0,
      oncoming: () => say('גרסה חדשה עלתה — הדף ייטען מחדש', true),
      onstuck: () => say('יש גרסה חדשה אבל הדפדפן מגיש גרסה ישנה. רענן ידנית.', true)
    });
  });

  function undoLast() {
    const a = history.undo();
    if (!a) {
      say('אין מה לבטל');
      return;
    }

    if (a.kind !== 'erase') {
      return;
    }

    say(a.items.length === 1 ? 'הוחזרה משיכה שנמחקה' : `הוחזרו ${a.items.length} משיכות שנמחקו`);
  }

  function redoLast() {
    if (!history.redo()) {
      say('אין מה להחזיר');
    }
  }

  async function clearBoard() {
    if (!(await confirm('למחוק הכול?'))) {
      return;
    }

    void clearAll(id);
  }

  async function checkWithClaude() {
    const board = surface?.exportCanvas(1600);
    if (!board) {
      return;
    }

    say(await sendForCheck(board, choice.topic, choice.exercise, choice.section || null));
  }
</script>

<div class="page" class:pinned={isPad} class:mirror={!isPad} dir="rtl">
  <header>
    <div class="brand">
      <span class="mark chamfer-s">∫</span>
      <div>
        <h1>לוח מתמטיקה</h1>
        <p class="sub">כותבים בטאבלט, רואים במחשב</p>
      </div>
    </div>
    <div class="roles">
      <!-- The code lives in the room, at the top of it. It used to sit in a card below
           the board and the toolbars — present, and three screens away
           from the person holding the tablet, which is the same as absent.
           This chip is the FALLBACK, not the main way in: the "חיבור הטאבלט" card at the
           bottom carries the same code with the link and the room id beside it, and it is
           the one to scan. But that card is desktop-only, and the role is a guess
           (`pointer: coarse`), so a desktop that guessed 'pad' would be left with no code
           at all — the one failure that leaves the tablet with nothing to scan.
           So: shown exactly where the card is not, and never both at once. Inside the
           Android wrapper neither appears; the wrapper is known for certain to be the
           tablet, and it is already in the room. -->
      {#if qr && isPad}
        <button class="qrchip" onclick={() => (bigQr = true)} title="הגדל כדי לסרוק מהטאבלט">
          <img src={qr} alt="קוד QR לחדר הזה" />
          <span>סרוק<code class="rid">{id.slice(0, 6)}</code></span>
        </button>
      {/if}
      <button class="btn" data-active={isPad} onclick={() => (role = 'pad')}>
        {@html iconPad}לוח כתיבה
      </button>
      <button class="btn" data-active={!isPad} onclick={() => (role = 'board')}>
        {@html iconDisplay}תצוגה
      </button>
    </div>
  </header>

  <main>
    <QuestionCard {choice} {role} oncheck={checkWithClaude} />

    <div class="slot" style:--aspect={ASPECT}>
      <Surface
        bind:this={surface}
        {room}
        readonly={!isPad}
        fill={isPad}
        onparts={(n, at) => {
          parts = n;
          // The ONLY writer of `part`. It follows the board rather than being held here,
          // so the picker cannot say one thing while the screen shows another — which is
          // also what keeps a shrinking strip honest: an erase or a clear moves the board,
          // and the index that arrives with it is already inside the new count.
          part = at;
        }}
        {tool}
        size={size.value}
        {isSnapping}
        gridCell={gridCell(grid.value)}
        onpen={(down) => {
          penDown = down;
          // Drawing again is what makes "forward" meaningless, so the stack empties on the
          // way DOWN — before the stroke exists, not after it has landed.
          if (down) {
            history.forgetRedo();
          }
        }}
        onaction={(a) => history.record(a)}
      />
    </div>

    {#if isPad}
      <PadTools bind:tool {size} bind:isSnapping {grid} />
    {/if}

    <div class="tools">
      <div class="group">
        <button class="btn" onclick={undoLast}>{@html iconUndo}בטל אחרון</button>
        <!-- Disabled rather than shouting when there is nothing to redo. Undo is not,
             because an empty board is the normal state and a permanently dead button
             beside a live one reads as broken; a redo stack, by contrast, is empty
             almost always, and a button that says so is the honest one. -->
        <button class="btn" onclick={redoLast} disabled={!history.canRedo}>
          {@html iconRedo}החזר
        </button>
        <button class="btn" onclick={clearBoard}>{@html iconTrash}נקה</button>
      </div>
      {#if isPad}
        <RoomJoin {id} />
      {:else}
        <CopyTools {surface} {parts} {part} />
      {/if}
    </div>

    {#if !isPad}
      <ConnectCards {id} {qr} />
    {/if}
  </main>

  <!-- One instance for the whole page: a modal is modal, so there is never a second. -->
  <Ask bind:this={ask} />

  {#if bigQr}
    <button class="qrbig" onclick={() => (bigQr = false)} aria-label="סגור את הקוד">
      <img src={qr} alt="קוד QR לחדר הזה" />
      <span class="qrsay">סרוק מהאפליקציה בטאבלט — כפתור <b>סרוק QR</b></span>
      <code class="qrid">{id}</code>
    </button>
  {/if}

  {#if toast.text}<div class="toast chamfer-s">{toast.text}</div>{/if}
</div>

<style>
  .page {
    max-width: 1180px;
    margin: 0 auto;
    padding: 20px 18px 64px;
  }

  /* The desktop mirror fits the viewport too, but for the opposite reason: everything
     around the board (the tools, the QR to pair the tablet) has to stay on screen, so the
     board gets only the height that is left. The slot is that leftover; the board keeps
     its 3:2 page shape inside it, as wide as the slot's height allows. On a tall screen
     the leftover is more than a full-width page needs, so the slot does not grow: its
     basis IS the full-width page height (100cqw of `main`), and it only shrinks from
     there — the tools stay attached under the board instead of drifting to the bottom.
     `min-height` is the floor below which a short window scrolls the page instead of
     shrinking the board to nothing. On the pad the slot is not a box at all. */
  .slot {
    display: contents;
  }
  .page.mirror {
    height: 100svh;
    padding-bottom: 20px;
    display: flex;
    flex-direction: column;
  }
  .page.mirror main {
    flex: 1 1 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    container-type: inline-size;
  }
  .page.mirror .slot {
    display: block;
    flex: 0 1 calc(100cqw / var(--aspect));
    min-height: 200px;
    container-type: size;
  }
  .page.mirror .slot :global(.host) {
    width: min(100cqw, 100cqh * var(--aspect));
    max-width: none;
  }

  /* The pad is pinned to the viewport: the board must be on screen at every moment, and
     a long exercise is served by scrolling INSIDE it rather than by scrolling the page.
     Those two are the same requirement — the moment the document scrolls, the board is
     something you can lose, and on a tablet you lose it constantly, because the canvas
     takes finger drags for ink and only the thin margins around it ever scrolled.
     So: no document scroll here at all. The board takes the space that is left after the
     header and the tools, and the strip runs underneath it. */
  .page.pinned {
    height: 100svh;
    padding-block: 12px 12px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .page.pinned main {
    flex: 1 1 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .page.pinned header {
    padding-bottom: 10px;
    margin-bottom: 12px;
  }
  /* On a phone in landscape the brand block is most of the height. The board wins. */
  @media (max-height: 520px) {
    .page.pinned .brand .sub,
    .page.pinned .mark {
      display: none;
    }
  }
  /* the toolbars are rows of the components below; their spacing is the page's */
  .page.pinned :global(.tools) {
    margin-top: 10px;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
    padding-bottom: 14px;
    margin-bottom: 18px;
    border-bottom: 2px solid var(--border);
    background: linear-gradient(var(--cyber-stripe), var(--cyber-stripe)) bottom right / 44px 4px
      no-repeat;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .mark {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border: 2px solid var(--border);
    background: var(--surface-2);
    color: var(--primary);
    font-size: 26px;
    text-shadow: var(--cyber-glow-primary);
  }
  h1 {
    margin: 0;
    font: var(--t-headline-s);
    letter-spacing: 0.07em;
  }
  .sub {
    margin: 2px 0 0;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--fg-muted);
  }
  .roles {
    display: flex;
    gap: 8px;
  }
  /* the chip: small, always on screen, and a plain white plate because a QR has to be
     scannable and the dark palette would swallow it */
  .qrchip {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 5px 10px 5px 5px;
    border: 2px solid var(--border);
    background: var(--surface);
    color: var(--fg);
    cursor: pointer;
    font: inherit;
  }
  .qrchip:hover {
    border-color: var(--border-strong);
    background: var(--surface-2);
  }
  .qrchip img {
    width: 44px;
    height: 44px;
    background: #fff;
    padding: 2px;
    image-rendering: pixelated;
  }
  .qrchip span {
    display: grid;
    gap: 2px;
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.08em;
    color: var(--fg-muted);
  }
  .qrbig {
    position: fixed;
    inset: 0;
    z-index: 30;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 18px;
    padding: 24px;
    border: 0;
    background: var(--scrim);
    cursor: zoom-out;
    font: inherit;
  }
  .qrbig img {
    width: min(74vmin, 560px);
    height: auto;
    background: #fff;
    padding: 18px;
    image-rendering: pixelated;
    box-shadow: var(--shadow-lg);
  }
  .qrsay {
    font-family: var(--font-sans);
    font-size: 16px;
    color: var(--fg);
    text-shadow: 0 1px 8px var(--scrim);
  }
  .qrid {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--fg-muted);
    direction: ltr;
  }
  .toast {
    position: fixed;
    inset-block-end: 22px;
    inset-inline-start: 50%;
    transform: translateX(50%);
    padding: 10px 20px;
    border: 2px solid var(--border-strong);
    background: var(--surface-2);
    color: var(--fg);
    font-family: var(--font-mono);
    font-size: 13px;
    box-shadow: var(--shadow-md);
  }
</style>
