<script lang="ts">
  /* ---- how the Gemini Live session is doing, in one line ----------------------------
     The same line in two places: beside the Live button on the desktop, and on the
     tablet in the notes card, where the icon pulses while Gemini listens so the state can
     be read without looking up. The words are lib/live.svelte.ts `liveLabel`. */
  import iconLive from './icons/IconLive.svg?raw';
  import { live, liveLabel } from './live.svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  let { hasIcon = false, ...rest }: { hasIcon?: boolean } & HTMLAttributes<HTMLSpanElement> = $props();
</script>

<span class="lstate" data-blind={live.blind || undefined} data-state={live.state} {...rest}>
  {#if hasIcon}{@html iconLive}{/if}{liveLabel()}
</span>

<style>
  /* In a row it takes the start and pushes what follows to the far end. */
  .lstate {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-inline-end: auto;
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

  @keyframes live-pulse {
    50% {
      opacity: 35%;
    }
  }
</style>
