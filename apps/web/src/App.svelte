<script lang="ts">
  /** The page: which device this is, the room both devices share, and how the parts sit
   *  on the screen. Each part owns its own job —
   *    QuestionCard   which exercise, and the question itself
   *    Surface        the board
   *    PadTools       what the pen draws with (tablet)
   *    CopyTools      the board out to the clipboard (desktop)
   *    RoomJoin       the tablet's ways into the desktop's room
   *    ConnectCards   the desktop's code and link for the tablet
   *    LiveNotes      what Gemini Live wrote down, and how the session is doing
   *  — and this file only wires them together. */
  import { onMount, untrack } from 'svelte';
  import { LiveState } from '@learn-math/shared/protocol';
  import Ask from './lib/Ask.svelte';
  import ConnectCards from './lib/ConnectCards.svelte';
  import CopyTools from './lib/CopyTools.svelte';
  import LiveNotes from './lib/LiveNotes.svelte';
  import PadTools from './lib/PadTools.svelte';
  import QuestionCard from './lib/QuestionCard.svelte';
  import SeqReel from './lib/SeqReel.svelte';
  import RoomJoin from './lib/RoomJoin.svelte';
  import Surface, { type SurfaceApi } from './lib/Surface.svelte';
  import { checkLabel, extensionPresent, liveBrief, noteRequest, sendForCheck } from './lib/check';
  import { LinkMessage, LinkState, Side, decodeHover, encodeHover, openLink, type Hover, type Link } from './lib/directlink';
  import { drawFrame, type Question } from './lib/frame';
  import { clearNotes, installLive, isRunning, live, retargetLive, startLive, stopLive } from './lib/live.svelte';
  import { Role, initialRole } from './lib/device';
  import { ActionKind, History } from './lib/history.svelte';
  import { ASPECT, GRID_SCALE, gridCell, PEN_SIZE, Tool } from './lib/ink';
  import { confirm, provideAsk, say, toast } from './lib/notify.svelte';
  import { Choice } from './lib/pick.svelte';
  import { RoomValue } from './lib/roomvalue.svelte';
  import { StorageKey, readFlag, writeFlag } from './lib/preferences';
  import { joinUrl, qrImage } from './lib/qr';
  import { watchRelease } from './lib/release';
  import { clearAll, room as makeRoom, PrefSlot, roomId, unsentWrites } from './lib/room';
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
  const isPad = $derived(role === Role.PAD);

  let tool = $state<Tool>(Tool.INK);
  /* Shape corners snap to the notebook grid. Per device, like the question fold, and
     on by default: a straight line in a math notebook is meant to sit on the squares. */
  let isSnapping = $state(readFlag(StorageKey.SNAP));
  $effect(() => writeFlag(StorageKey.SNAP, isSnapping));

  const grid = new RoomValue(id, PrefSlot.GRID, GRID_SCALE);
  const size = new RoomValue(id, PrefSlot.SIZE, PEN_SIZE);

  let surface = $state<SurfaceApi>();
  /** How many page-sized parts the strip exports as, and which one the board is sitting
   *  on. One part means a strip that fits a page, and then there is nothing to choose. */
  let parts = $state(1);
  let part = $state(0);
  /** the pen is on the glass right now — a reload waits it out. See lib/release.ts. */
  let penDown = $state(false);
  let qr = $state('');

  const history = new History(id);
  const choice = new Choice(id);

  let ask = $state<Ask>();
  $effect(() => provideAsk(ask));

  /* ---- the direct link, and Gemini Live ------------------------------------
     The tablet's pen hover goes to the desktop, and the session's state comes back, over
     a link between the two devices (lib/directlink.ts). Gemini's notes do not: they are
     the desktop's alone. Which end this page is follows the role, so it is rebuilt when
     the role changes. */
  let link: Link | null = null;
  /** where the tablet's pen is hovering — the desktop's to draw, and Gemini's to see */
  let remoteHover = $state<Hover>(null);
  /** the last hover sent, so an unmoved pen is not sent again on every event */
  let sentHover = '';

  $effect(() => {
    const side = isPad ? Side.PAD : Side.DESK;
    const mine = openLink(id, side, {
      // what the other end missed while it was not there
      open() {
        if (side === Side.DESK) {
          mine.sendMessage(LinkMessage.LIVE, { state: live.state, blind: live.blind });
        } else {
          mine.sendMessage(LinkMessage.HOVER, sentHover);
        }
      },
      state(st) {
        if (st !== LinkState.OPEN && side === Side.DESK) {
          remoteHover = null;
        }
      }
    });
    if (side === Side.DESK) {
      mine.onMessage(LinkMessage.HOVER, (at) => (remoteHover = decodeHover(at)));
    } else {
      mine.onMessage(LinkMessage.LIVE, (m) => {
        live.state = m.state;
        live.blind = m.blind;
      });
    }
    link = mine;
    return () => {
      mine.stop();
      link = null;
      remoteHover = null;
    };
  });

  function penHover(h: Hover) {
    const at = encodeHover(h);
    if (at === sentHover) {
      return;
    }

    sentHover = at;
    link?.sendMessage(LinkMessage.HOVER, at);
  }

  // The desktop passes the session's state on to the tablet as it changes.
  $effect(() => {
    const state = live.state;
    const blind = live.blind;
    if (!isPad) {
      link?.sendMessage(LinkMessage.LIVE, { state, blind });
    }
  });

  /** The question as Gemini's picture shows it, with the newest note under it. */
  function question(): Question {
    return {
      meta: checkLabel(choice.topic, choice.exercise, choice.section || null),
      html: choice.exercise?.html ?? 'התרגיל אינו מהחוברת: השאלה כתובה על הלוח.',
      note: live.notes[0]
    };
  }

  onMount(() =>
    installLive(async () => {
      const board = surface?.scene();
      return board ? drawFrame(board, question()) : null;
    })
  );

  /** What the extension needs to know about the exercise: its name, for the shared tab,
   *  and how to ask for a note about it. */
  function exercise() {
    const section = choice.section || null;
    return {
      title: checkLabel(choice.topic, choice.exercise, section),
      notes: noteRequest(choice.topic, choice.exercise, section)
    };
  }

  /** The exercise last told to the session, so a change can be told apart from a session
   *  that is merely changing state. */
  let told = '';

  // A new exercise mid-session is NOT briefed again: that would be a text turn, and a
  // text turn inside Live left it listening and silent (Avi, 14.10.2026). Gemini sees the
  // new question in its picture, and the brief says to follow it; this only renames the
  // shared tab and re-aims the note request.
  $effect(() => {
    const next = exercise();
    if (!isRunning(live.state) || !told || next.notes.template === told) {
      return;
    }

    told = next.notes.template;
    retargetLive(next);
  });

  /** The question Gemini's notes were written for. Another question — picked here, or on
   *  the tablet and synced through the room — folds them all away; another section of
   *  the same one does not, since its formulas still hold. */
  let notesFor = choice.pick;
  $effect(() => {
    if (choice.pick !== notesFor) {
      notesFor = choice.pick;
      untrack(clearNotes);
    }
  });

  function toggleLive() {
    if (isRunning(live.state)) {
      stopLive();
      return;
    }

    // There is no fallback here, unlike the Claude check: a live session IS the
    // extension's window, and there is nothing to paste anywhere.
    if (!extensionPresent()) {
      say('ג׳מיני לייב נפתח דרך התוסף של הלוח בכרום, והתוסף לא מותקן כאן');
      return;
    }

    const next = exercise();
    told = next.notes.template;
    live.state = LiveState.OPENING;
    startLive({ prompt: liveBrief(choice.topic, choice.exercise, choice.section || null), ...next });
  }

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

    if (a.kind !== ActionKind.ERASE) {
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
        <button class="qrchip" popovertarget="qrbig" title="הגדל כדי לסרוק מהטאבלט">
          <img src={qr} alt="קוד QR לחדר הזה" />
          <span>סרוק<code class="rid">{id.slice(0, 6)}</code></span>
        </button>
      {/if}
      <button class="btn" data-active={isPad} onclick={() => (role = Role.PAD)}>
        {@html iconPad}לוח כתיבה
      </button>
      <button class="btn" data-active={!isPad} onclick={() => (role = Role.BOARD)}>
        {@html iconDisplay}תצוגה
      </button>
    </div>
  </header>

  <main>
    <QuestionCard {choice} {role} oncheck={checkWithClaude} onlive={toggleLive} />

    <LiveNotes onPad={isPad} />

    <!-- The סדרות chapter's own explainer, under its question. Desktop only, like
         the "how to solve" videos inside the card: the tablet is a page to write on. -->
    <SeqReel topicId={choice.topic.id} desktop={!isPad} />

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
        hover={remoteHover}
        onhover={penHover}
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

  <!-- The QR blown up, for scanning from across the desk. A popover, so showing it, Esc,
       the top layer and the backdrop are the browser's; the one button inside covers the
       whole screen, because there is no "outside" left to light-dismiss on. -->
  {#if qr}
    <div id="qrbig" class="qrbig" popover>
      <button popovertarget="qrbig" popovertargetaction="hide" aria-label="סגור את הקוד">
        <img src={qr} alt="קוד QR לחדר הזה" />
        <span class="qrsay">סרוק מהאפליקציה בטאבלט — כפתור <b>סרוק QR</b></span>
        <code class="qrid">{id}</code>
      </button>
    </div>
  {/if}

  {#if toast.text}<div class="toast chamfer-s">{toast.text}</div>{/if}
</div>

<style>
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

  .page {
    max-width: 1180px;
    margin: 0 auto;
    padding-block: 20px 64px;
    padding-inline: 18px;

    /* the role switch (below `main`) does not run under reduced motion */
    @media (prefers-reduced-motion: reduce) {
      main,
      main::after {
        animation: none;
      }
    }

    &.mirror {
      display: flex;
      flex-direction: column;
      height: 100svh;
      padding-block-end: 20px;

      main {
        container-type: inline-size;
        display: flex;
        flex: 1 1 0;
        flex-direction: column;
        min-height: 0;
        animation: role-to-mirror var(--dur-long) var(--ease-emph); /* the role switch, below */

        &::after {
          inset-block: 0;
          width: 2px;
          animation: role-scan-across var(--dur-long) linear;
        }
      }

      .slot {
        container-type: size;
        display: block;
        flex: 0 1 calc(100cqw / var(--aspect));
        min-height: 200px;

        :global(.host) {
          width: min(100cqw, 100cqh * var(--aspect));
          max-width: none;
        }
      }
    }

    /* The pad is pinned to the viewport: the board must be on screen at every moment, and
       a long exercise is served by scrolling INSIDE it rather than by scrolling the page.
       Those two are the same requirement — the moment the document scrolls, the board is
       something you can lose, and on a tablet you lose it constantly, because the canvas
       takes finger drags for ink and only the thin margins around it ever scrolled.
       So: no document scroll here at all. The board takes the space that is left after the
       header and the tools, and the strip runs underneath it. */
    &.pinned {
      display: flex;
      flex-direction: column;
      overflow: hidden;
      height: 100svh;
      padding-block: 12px;

      /* On a phone in landscape the brand block is most of the height. The board wins. */
      @media (height <= 520px) {
        .brand .sub,
        .mark {
          display: none;
        }
      }

      main {
        display: flex;
        flex: 1 1 0;
        flex-direction: column;
        min-height: 0;
        animation: role-to-pad var(--dur-long) var(--ease-emph); /* the role switch, below */

        &::after {
          inset-inline: 0;
          height: 2px;
          animation: role-scan-down var(--dur-long) linear;
        }
      }

      header {
        margin-block-end: 12px;
        padding-block-end: 10px;
      }

      /* the toolbars are rows of the components below; their spacing is the page's */
      :global(.tools) {
        margin-block-start: 10px;
      }
    }
  }

  /* Switching role is a channel change, and it looks like one: the new layout powers on
     from a lit slit, overexposed for a beat, while a scanline crosses it. The writing
     board opens top-and-bottom from a horizontal line (a CRT waking up); the mirror opens
     side-to-side from a vertical one (a monitor), so the two directions say which way
     you went.

     No JS: each role has its own animation NAME, and a changed animation-name restarts
     the animation, so the class swap on .page is the trigger. No `forwards` on `main` —
     the last frame equals the resting state, and holding a clip-path or a filter after
     the gesture would clip card shadows and turn `main` into a containing block for
     fixed descendants. The scanline rests at opacity 0, so nothing is left behind.
     Under reduced motion none of it runs: the layout simply appears. */
  main {
    position: relative;

    &::after {
      content: "";
      position: absolute;
      background: var(--primary);
      opacity: 0%;
      box-shadow: 0 0 14px 2px var(--primary);
      pointer-events: none;
    }
  }

  @keyframes role-to-pad {
    0% {
      clip-path: inset(50% 0 50% 0);
      filter: brightness(2.2) contrast(1.3);
    }

    30% {
      clip-path: inset(48% 0 48% 0);
    }

    100% {
      clip-path: inset(0);
      filter: none;
    }
  }

  @keyframes role-to-mirror {
    0% {
      clip-path: inset(0 50% 0 50%);
      filter: brightness(2.2) contrast(1.3);
    }

    30% {
      clip-path: inset(0 48% 0 48%);
    }

    100% {
      clip-path: inset(0);
      filter: none;
    }
  }

  @keyframes role-scan-down {
    from {
      top: 0;
      opacity: 100%;
    }

    to {
      top: 100%;
      opacity: 0%;
    }
  }

  /* Physical `left`, in an RTL page: the sweep follows the reading direction, right to
     left, the way the eye goes. */
  @keyframes role-scan-across {
    from {
      left: 100%;
      opacity: 100%;
    }

    to {
      left: 0;
      opacity: 0%;
    }
  }

  header {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    justify-content: space-between;
    align-items: center;
    margin-block-end: 18px;
    padding-block-end: 14px;
    border-block-end: 2px solid var(--border);
    background:
      linear-gradient(var(--cyber-stripe), var(--cyber-stripe)) bottom right / 44px 4px
      no-repeat;
  }

  .brand {
    display: flex;
    gap: 14px;
    align-items: center;
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
    margin-block: 2px 0;
    margin-inline: 0;
    color: var(--fg-muted);
    font-family: var(--font-mono);
    font-size: 12px;
  }

  .roles {
    display: flex;
    gap: 8px;
  }

  /* A QR has to be scannable, small or blown up: a plain white plate, because the dark
     palette would swallow it. */
  :is(.qrchip, .qrbig) img {
    background: #ffffff;
    image-rendering: pixelated;
  }

  /* the chip: small, always on screen */
  .qrchip {
    display: flex;
    gap: 9px;
    align-items: center;
    padding-block: 5px;
    padding-inline: 10px 5px;
    border: 2px solid var(--border);
    background: var(--surface);
    color: var(--fg);
    font: inherit;
    cursor: pointer;

    &:hover {
      border-color: var(--border-strong);
      background: var(--surface-2);
    }

    img {
      width: 44px;
      height: 44px;
      padding: 2px;
    }

    & span {
      display: grid;
      gap: 2px;
      color: var(--fg-muted);
      font-family: var(--font-mono);
      font-size: 11px;
      letter-spacing: 0.08em;
    }
  }

  .qrbig {
    /* the UA popover box, undone: this one is the whole viewport */
    inset: 0;
    width: 100%;
    max-width: none;
    height: 100%;
    max-height: none;
    margin: 0;
    padding: 0;
    border: 0;
    background: transparent;

    &::backdrop {
      background: var(--scrim);
    }

    button {
      display: grid;
      gap: 18px;
      place-content: center;
      justify-items: center;
      width: 100%;
      height: 100%;
      padding: 24px;
      border: 0;
      background: none;
      font: inherit;
      cursor: zoom-out;
    }

    img {
      width: min(74vmin, 560px);
      height: auto;
      padding: 18px;
      box-shadow: var(--shadow-lg);
    }
  }

  .qrsay {
    color: var(--fg);
    font-family: var(--font-sans);
    font-size: 16px;
    text-shadow: 0 1px 8px var(--scrim);
  }

  .qrid {
    color: var(--fg-muted);
    font-family: var(--font-mono);
    font-size: 12px;
    direction: ltr;
  }

  .toast {
    position: fixed;
    inset-block-end: 22px;
    inset-inline-start: 50%;
    padding: 10px 20px;
    border: 2px solid var(--border-strong);
    background: var(--surface-2);
    color: var(--fg);
    font-family: var(--font-mono);
    font-size: 13px;
    box-shadow: var(--shadow-md);
    transform: translateX(50%);
  }
</style>
