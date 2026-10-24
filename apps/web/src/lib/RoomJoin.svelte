<script lang="ts">
  /** The tablet's ways into the room the desktop is already watching. On the desktop the
   *  QR and the link do this job; on the pad there was nothing at all, which is exactly
   *  the device that needs it. */
  import { tick } from 'svelte';
  import { canScan } from './device';
  import { prompt, say } from './notify.svelte';
  import { joinRoom } from './room';
  import { scan } from './scan';
  import iconClose from './icons/IconClose.svg?raw';
  import iconEnter from './icons/IconEnter.svg?raw';
  import iconQr from './icons/IconQr.svg?raw';

  let { id }: { id: string } = $props();

  async function askRoom() {
    const v = (await prompt({ message: 'הדבק את הקישור מהמחשב, או את מזהה החדר:' }))?.trim();
    if (!v) {
      return;
    }

    if (v.includes(id)) {
      say({ text: 'אתה כבר בחדר הזה' });
      return;
    }

    if (!joinRoom(v)) {
      say({ text: 'לא מצאתי מזהה חדר בטקסט הזה' });
    }
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
    if (!cam) {
      scanning = false;
      return;
    }

    try {
      stopScan = await scan({
        video: cam,
        onfound(text) {
          closeScan();
          if (!joinRoom(text)) {
            say({ text: 'אין מזהה חדר בקוד הזה' });
          }
        }
      });
    } catch {
      scanning = false;
      say({ text: 'אין גישה למצלמה' });
    }
  }

  function closeScan() {
    stopScan?.();
    stopScan = null;
    scanning = false;
  }
</script>

<div class="group">
  {#if canScan}
    <button class="btn" data-variant="primary" onclick={startScan}>
      {@html iconQr}סרוק QR
    </button>
  {/if}
  <button class="btn" onclick={askRoom} title="הצטרף לחדר של המחשב">
    {@html iconEnter}חדר <code class="rid">{id.slice(0, 6)}</code>
  </button>
</div>

{#if scanning}
  <div class="scanner">
    <!-- svelte-ignore a11y_media_has_caption -->
    <video bind:this={cam} muted playsinline></video>
    <div class="reticle chamfer"></div>
    <p class="shint">כוון את המצלמה אל הקוד שעל מסך המחשב</p>
    <button class="btn" onclick={closeScan}>{@html iconClose}בטל</button>
  </div>
{/if}

<style>
  .scanner {
    position: fixed;
    inset: 0;
    z-index: 20;
    display: grid;
    place-items: center;
    background: var(--scrim);

    video {
      position: absolute;
      inset: 0;
      object-fit: cover;
      width: 100%;
      height: 100%;
    }

    .btn {
      position: absolute;
      inset-block-end: 28px;
    }
  }

  /* the frame is the instruction: people aim at a box without being told to */
  .reticle {
    position: relative;
    width: 62vmin;
    border: 3px solid var(--primary);
    box-shadow:
      0 0 0 100vmax var(--scrim),
      var(--cyber-glow-primary);
    aspect-ratio: 1;
  }

  .shint {
    position: absolute;
    inset-inline: 0;
    inset-block-start: 24px;
    margin: 0;
    color: var(--fg);
    font-family: var(--font-mono);
    font-size: 13px;
    text-align: center;
    text-shadow: 0 1px 6px var(--scrim);
  }
</style>
