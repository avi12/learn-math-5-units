<script lang="ts">
  import { onMount, tick } from 'svelte';
  import QRCode from 'qrcode';
  import Surface from './lib/Surface.svelte';
  import Formula from './lib/Formula.svelte';
  import { clearAll, deleteDoc, joinRoom, newRoom, room as makeRoom, roomId, strokeRef } from './lib/room';
  import { watchRelease } from './lib/release';
  import { scan } from './lib/scan';
  import { pad } from './lib/spen';
  import type { Pen, Tool } from './lib/ink';

  const id = roomId();
  const room = makeRoom(id);

  // The tablet gets the pen, the desktop gets the mirror. ?role= overrides.
  const forced = new URL(location.href).searchParams.get('role');
  let role = $state<'pad' | 'board'>(
    forced === 'pad' || forced === 'board'
      ? forced
      : matchMedia('(pointer: coarse)').matches
        ? 'pad'
        : 'board'
  );

  let tool = $state<Tool>('ink');
  let pen = $state<Pen>('ink');
  let size = $state(6);
  let surface = $state<{
    keys(): string[];
    exportCanvas(w?: number): HTMLCanvasElement;
    exportLines(w?: number): { key: string; canvas: HTMLCanvasElement }[];
  }>();
  /** identifies the current drawing, so recognition re-runs only on real change */
  let strokeKey = $state('');
  /** the pen is on the glass right now — the formula bar waits it out */
  let penDown = $state(false);
  let toast = $state('');
  let qr = $state('');
  let formula = $state<{ value(): string }>();
  let showTex = $state(false);
  /** the QR blown up, for scanning from across the desk */
  let bigQr = $state(false);

  const TOOLS: [Tool, string][] = [
    ['ink', 'עט'],
    ['erase', 'מחק'],
    ['line', 'ישר'],
    ['rect', 'מלבן'],
    ['ellipse', 'מעגל']
  ];
  const PENS: [Pen, string][] = [
    ['ink', 'דיו'],
    ['accent', 'הדגשה'],
    ['warn', 'הערה'],
    ['danger', 'תיקון']
  ];

  /** A device that scans is a device that is HELD. Inside the wrapper that is certain;
   *  otherwise it takes a touch-primary pointer and a camera. The desktop is the screen
   *  SHOWING the code — a scan button there is a button that can only ever fail, and it
   *  is the mirror image of the mistake the QR made by being board-only. */
  const canScan =
    !!pad() ||
    (matchMedia('(pointer: coarse)').matches && !!navigator.mediaDevices?.getUserMedia);

  /** What the QR encodes. Explicitly role=pad: the code is scanned BY the tablet, and
   *  encoding location.href would hand it `role=board` and open a second mirror — two
   *  screens watching each other and nothing to write on. */
  const joinUrl = `${location.origin}${location.pathname}?role=pad&room=${id}`;

  onMount(() => {
    void QRCode.toDataURL(joinUrl, { margin: 1, width: 300 }).then((d) => (qr = d));
    // A deploy reaches the tab over the Firestore socket that is already open; see
    // lib/release.ts for why it waits for the pen before it takes the page away.
    return watchRelease({
      busy: () => penDown,
      oncoming: () => say('גרסה חדשה עלתה — הדף ייטען מחדש', true),
      onstuck: () => say('יש גרסה חדשה אבל הדפדפן מגיש גרסה ישנה. רענן ידנית.', true)
    });
  });

  /** A sticky toast is one the page is not going to outlive, so it must not fade. */
  function say(t: string, sticky = false) {
    toast = t;
    if (!sticky) setTimeout(() => (toast = ''), 2400);
  }

  function undoLast() {
    const k = surface?.keys() ?? [];
    if (!k.length) return say('אין מה לבטל');
    void deleteDoc(strokeRef(id, k[k.length - 1]));
  }

  async function copyPng() {
    const c = surface?.exportCanvas();
    if (!c) return;
    const blob: Blob | null = await new Promise((r) => c.toBlob(r, 'image/png'));
    if (!blob) return say('הייצוא נכשל');
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      say('הועתק ללוח — הדבק בקלוד');
    } catch {
      void download(blob);
      say('הדפדפן חסם העתקה — הקובץ ירד במקום');
    }
  }

  function downloadPng() {
    const c = surface?.exportCanvas();
    if (!c) return;
    c.toBlob((b) => b && void download(b), 'image/png');
  }

  /** Inside the Android wrapper an <a download> does nothing at all — a WebView ignores
   *  downloads, and a blob: URL cannot be handed to a system downloader either. So the
   *  bytes go over the bridge and out through the share sheet, which on a tablet is the
   *  more useful destination anyway. In a browser tab nothing changes. */
  async function download(blob: Blob) {
    const name = `math-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
    const bridge = pad();
    if (bridge) {
      const b64 = await blobToBase64(blob);
      if (!bridge.share(name, blob.type || 'image/png', b64)) say('השיתוף נכשל');
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onerror = () => reject(r.error);
      // readAsDataURL gives "data:<mime>;base64,<payload>"; the bridge wants the payload
      r.onload = () => resolve(String(r.result).split(',', 2)[1] ?? '');
      r.readAsDataURL(blob);
    });
  }

  async function copyTex() {
    const tex = formula?.value() ?? '';
    if (!tex.trim()) return say('אין עדיין נוסחה');
    await navigator.clipboard.writeText(tex);
    say('ה-LaTeX הועתק');
  }

  /** The tablet's way into the room the desktop is already watching. On the desktop the
   *  QR and the link do this job; on the pad there was nothing at all, which is exactly
   *  the device that needs it. */
  function askRoom() {
    const v = prompt('הדבק את הקישור מהמחשב, או את מזהה החדר:', '');
    if (v === null || !v.trim()) return;
    if (v.includes(id)) return say('אתה כבר בחדר הזה');
    if (!joinRoom(v)) say('לא מצאתי מזהה חדר בטקסט הזה');
  }

  async function copyLink() {
    await navigator.clipboard.writeText(joinUrl);
    say('הקישור הועתק');
  }

  /* ---- scanning the desktop's code ----------------------------------------
     The tablet cannot type 32 hex characters and, inside the wrapper, has nothing to
     paste from either. The camera is the way in. */
  let scanning = $state(false);
  let cam = $state<HTMLVideoElement>();
  let stopScan: (() => void) | null = null;

  async function startScan() {
    scanning = true;
    await tick(); // the <video> has to exist before the camera can be pointed at it
    try {
      stopScan = await scan(cam!, (text) => {
        closeScan();
        if (!joinRoom(text)) say('אין מזהה חדר בקוד הזה');
      });
    } catch {
      scanning = false;
      say('אין גישה למצלמה');
    }
  }

  function closeScan() {
    stopScan?.();
    stopScan = null;
    scanning = false;
  }
</script>

<div class="page" class:pinned={role === 'pad'} dir="rtl">
  <header>
    <div class="brand">
      <span class="mark">∫</span>
      <div>
        <h1>לוח מתמטיקה</h1>
        <p class="sub">כותבים בטאבלט, רואים במחשב</p>
      </div>
    </div>
    <div class="roles">
      <!-- The code lives in the room, at the top of it. It used to sit in a card below
           the board, the toolbars and the formula bar — present, and three screens away
           from the person holding the tablet, which is the same as absent.
           Shown in BOTH roles, and hidden only inside the Android wrapper. The role is a
           guess (`pointer: coarse`), and a desktop that guessed wrong had no code at all
           — which is the one failure that leaves the tablet with nothing to scan. The
           wrapper, by contrast, is known for certain: it is the tablet. -->
      {#if qr && !pad()}
        <button class="qrchip" onclick={() => (bigQr = true)} title="הגדל כדי לסרוק מהטאבלט">
          <img src={qr} alt="קוד QR לחדר הזה" />
          <span>סרוק<code class="rid">{id.slice(0, 6)}</code></span>
        </button>
      {/if}
      <button class="btn" data-active={role === 'pad'} onclick={() => (role = 'pad')}>לוח כתיבה</button>
      <button class="btn" data-active={role === 'board'} onclick={() => (role = 'board')}>תצוגה</button>
    </div>
  </header>

  <main>
    <Surface
      bind:this={surface}
      {room}
      readonly={role === 'board'}
      fill={role === 'pad'}
      {tool}
      {pen}
      {size}
      onstrokes={(keys) => (strokeKey = keys.join(','))}
      onpen={(down) => (penDown = down)}
    />

    {#if role === 'pad'}
      <div class="tools">
        <div class="group">
          {#each TOOLS as [t, label] (t)}
            <button class="btn" data-tool={t} data-active={tool === t} onclick={() => (tool = t)}>
              {label}
            </button>
          {/each}
        </div>
        <div class="group">
          {#each PENS as [p, label] (p)}
            <button class="btn swatch" data-pen={p} data-active={pen === p} onclick={() => (pen = p)}>
              {label}
            </button>
          {/each}
        </div>
        <label class="group size">
          {tool === 'erase' ? 'גודל המחק' : 'עובי'}
          <input type="range" min="2" max="16" step="1" bind:value={size} />
          <span class="num">{size}</span>
        </label>
      </div>
    {/if}

    <div class="tools">
      <div class="group">
        <button class="btn" onclick={undoLast}>בטל אחרון</button>
        <button class="btn" onclick={() => confirm('למחוק הכול?') && void clearAll(id)}>נקה</button>
      </div>
      <div class="group">
        <button class="btn" data-variant="primary" onclick={copyPng}>העתק כתמונה</button>
        <button class="btn" onclick={downloadPng}>{pad() ? 'שתף PNG' : 'הורד PNG'}</button>
      </div>
      {#if role === 'pad'}
        <div class="group">
          {#if canScan}
            <button class="btn" data-variant="primary" onclick={startScan}>סרוק QR</button>
          {/if}
          <button class="btn" onclick={askRoom} title="הצטרף לחדר של המחשב">
            חדר <code class="rid">{id.slice(0, 6)}</code>
          </button>
        </div>
      {/if}
    </div>

    <section class="tex-pane">
      <button class="btn wide" onclick={() => (showTex = !showTex)} aria-expanded={showTex}>
        {showTex ? 'סגור את שורת הנוסחה' : 'נוסחה ב-LaTeX'}
      </button>
      {#if showTex}
        <p class="note">
          השורה קוראת את הקנבס וממירה ל-LaTeX. היא ממתינה שתרים את העט ותשתהה רגע לפני
          שהיא מריצה, כדי לא לזהות משוואה באמצע הכתיבה. התוצאה נשארת ניתנת לעריכה, כי
          זיהוי אף פעם לא מושלם ולתקן סימן אחד עדיף על להקליד הכול.
        </p>
        <Formula
          bind:this={formula}
          roomId={id}
          readonly={role === 'board'}
          {strokeKey}
          {penDown}
          getLines={() => surface?.exportLines(1200) ?? []}
          getWhole={() => surface?.exportCanvas(1200)}
        />
        <div class="group">
          <button class="btn" data-variant="primary" onclick={copyTex}>העתק LaTeX</button>
        </div>
      {/if}
    </section>

    <!-- Desktop only. On the tablet these two cards are noise: the QR exists to get the
         tablet into the room, so by the time it is being read there it has done its job,
         and the instructions are about pasting into Claude, which happens on the desktop.
         Hiding them puts the canvas and its tools on the screen alone. -->
    {#if role === 'board'}
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
              <button class="btn" onclick={copyLink}>העתק קישור</button>
              <button class="btn" onclick={() => confirm('לפתוח חדר חדש? הישן יישאר במקומו.') && newRoom()}>
                חדר חדש
              </button>
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
          שתי דרכים, לפי מה שאתה צריך: <b>תמונה</b> לכתב יד וצורות — קלוד קורא אותה ישירות.
          <b>LaTeX</b> לנוסחה שצריכה להיות מדויקת, למשל לשלוח למורה בהודעה. שורת הנוסחה
          מזהה את הכתב מהקנבס לבד ומריצה שוב בכל שינוי, ומה שיצא נשאר ניתן לתיקון.
        </p>
      </div>
    </section>
    {/if}
  </main>

  {#if bigQr}
    <button class="qrbig" onclick={() => (bigQr = false)} aria-label="סגור את הקוד">
      <img src={qr} alt="קוד QR לחדר הזה" />
      <span class="qrsay">סרוק מהאפליקציה בטאבלט — כפתור <b>סרוק QR</b></span>
      <code class="qrid">{id}</code>
    </button>
  {/if}

  {#if scanning}
    <div class="scanner">
      <!-- svelte-ignore a11y_media_has_caption -->
      <video bind:this={cam} muted playsinline></video>
      <div class="reticle"></div>
      <p class="shint">כוון את המצלמה אל הקוד שעל מסך המחשב</p>
      <button class="btn" onclick={closeScan}>בטל</button>
    </div>
  {/if}

  {#if toast}<div class="toast">{toast}</div>{/if}
</div>

<style>
  .page {
    max-width: 1180px;
    margin: 0 auto;
    padding: 20px 18px 64px;
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
  .page.pinned .tools {
    margin-top: 10px;
  }
  .page.pinned .tex-pane {
    margin-top: 12px;
    overflow-y: auto;
    flex: 0 1 auto;
    min-height: 0;
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
    clip-path: polygon(
      var(--chamfer-s) 0,
      100% 0,
      100% calc(100% - var(--chamfer-s)),
      calc(100% - var(--chamfer-s)) 100%,
      0 100%,
      0 var(--chamfer-s)
    );
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
  .tools {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 18px;
    justify-content: space-between;
    margin-top: 14px;
  }
  .group {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .size {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--fg-muted);
  }
  input[type='range'] {
    accent-color: var(--primary);
    width: 130px;
  }
  .btn[data-active='true'] {
    border-color: var(--border-strong);
    background: var(--primary);
    color: var(--on-primary);
    box-shadow: var(--cyber-glow-primary);
  }
  /* The swatch has to read on ANY button background. When a pen button is active the
     button fills with --primary, which in the light palette is the same ink navy as the
     "דיו" pen itself — so the chip was invisible exactly on the selected pen. Sitting it
     on a --surface plate with a --border ring makes it independent of the button state
     and of the theme. */
  .swatch::before {
    content: '';
    width: 13px;
    height: 13px;
    flex: none;
    background: var(--swatch);
    box-shadow:
      0 0 0 2px var(--surface),
      0 0 0 3px var(--border);
    margin-inline-end: 3px;
  }
  .swatch[data-pen='ink'] {
    --swatch: var(--fg);
  }
  .swatch[data-pen='accent'] {
    --swatch: var(--secondary);
  }
  .swatch[data-pen='warn'] {
    --swatch: var(--warn);
  }
  .swatch[data-pen='danger'] {
    --swatch: var(--danger);
  }
  .tex-pane {
    display: grid;
    gap: 12px;
    margin-top: 22px;
  }
  .btn.wide {
    justify-content: center;
  }
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
  .rid {
    font-family: var(--font-mono);
    font-size: .85em;
    opacity: .75;
    direction: ltr;
    display: inline-block;
  }
  .roomid {
    margin: 10px 0 0;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg-subtle);
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
  .scanner {
    position: fixed;
    inset: 0;
    z-index: 20;
    display: grid;
    place-items: center;
    background: var(--scrim);
  }
  .scanner video {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  /* the frame is the instruction: people aim at a box without being told to */
  .reticle {
    position: relative;
    width: min(62vw, 62vh);
    aspect-ratio: 1;
    border: 3px solid var(--primary);
    box-shadow:
      0 0 0 100vmax var(--scrim),
      var(--cyber-glow-primary);
    clip-path: polygon(
      var(--chamfer) 0,
      100% 0,
      100% calc(100% - var(--chamfer)),
      calc(100% - var(--chamfer)) 100%,
      0 100%,
      0 var(--chamfer)
    );
  }
  .shint {
    position: absolute;
    inset-block-start: 24px;
    inset-inline: 0;
    margin: 0;
    text-align: center;
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--fg);
    text-shadow: 0 1px 6px var(--scrim);
  }
  .scanner .btn {
    position: absolute;
    inset-block-end: 28px;
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
    clip-path: polygon(
      var(--chamfer-s) 0,
      100% 0,
      100% calc(100% - var(--chamfer-s)),
      calc(100% - var(--chamfer-s)) 100%,
      0 100%,
      0 var(--chamfer-s)
    );
  }
</style>
