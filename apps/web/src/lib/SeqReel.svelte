<script lang="ts">
  /** The סדרות chapter's explainer: two acts of narrated scenes that move.
   *
   *  Avi could not follow the playlist the workbook's block used to open with, and the
   *  first cut of these scenes was still too abstract — so act one now solves one
   *  exercise from the first line to the last and shows the same skeleton under a second
   *  story, and act two derives every formula on screen rather than stating it
   *  ("למה הנוסחאות הן ככה וככה, איך הגיעו לכל דבר").
   *
   *  Nothing here is authored in this file. The drawings, the markup, the scripts and the
   *  stylesheet all come from `workbook/build/seqreel.py`, which writes `seqreel.json` and
   *  `seqreel.css` beside this component and inlines the very same scenes into the
   *  workbook page — one home, like the marking criteria in `graders.json`. The maths
   *  arrives fenced in `$…$` and becomes MathML at build time in the `exercise-html`
   *  plugin (vite.config.ts), so this component only shows what it is handed.
   *
   *  `data-narrate` on each figure is the script for the ear, and the `[[cue]]` markers in
   *  it name the `data-cue` parts of the scene; two rules in seqreel.css dim a part until
   *  the voice reaches it. Every scene is complete at rest, so a panel reads as a picture
   *  even with no voice available.
   *
   *  One <details> per act, collapsed until asked for, and desktop only — the same
   *  reasoning as the "how to solve" video row above: the tablet is a page to write on. */
  import reelData from './seqreel.json';

  interface Scene {
    id: string;
    title: string;
    script: string;
    /** `bodyTex`/`captionTex` rendered — added at build time, not in seqreel.json itself */
    body: string;
    caption: string;
  }
  interface Act {
    title: string;
    blurb: string;
    scenes: Scene[];
  }
  const REEL = reelData as unknown as { block: string; groups: Act[] };

  /** Which chapter this reel belongs to is decided once, in seqreel.py, and travels with
   *  the scenes — the page does not keep a second copy of the block number. */
  let { topicId, desktop }: { topicId: string; desktop: boolean } = $props();
  const show = $derived(desktop && topicId === REEL.block);
</script>

{#if show}
  {#each REEL.groups as act (act.title)}
    <details class="card reelcard">
      <summary>
        <span class="rtag">סרטון</span>
        {act.title} — {act.blurb}
      </summary>
      <div class="reel">
        {#each act.scenes as scene (scene.id)}
          <figure
            class="scene"
            id={scene.id}
            data-narrate-title={scene.title}
            data-narrate={scene.script}
          >
            {@html scene.body}
            <figcaption>{@html scene.caption}</figcaption>
          </figure>
        {/each}
      </div>
    </details>
  {/each}
{/if}

<style>
  /* The scenes themselves are styled by lib/seqreel.css, which is generated beside this
     file and imported in main.ts — global, because the drawings arrive as raw markup and
     a scoped rule would never reach inside them. What is left here is the panel. */
  .reelcard {
    margin-block-end: 14px;
    padding: 0;
  }

  summary {
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 12px 16px;
    color: var(--fg-muted);
    list-style: none;
    font-family: var(--font-mono);
    font-size: 13px;
    cursor: pointer;

    &::-webkit-details-marker {
      display: none;
    }

    &::after {
      content: "+";
      margin-inline-start: auto;
      color: var(--primary);
    }

    .reelcard[open] &::after {
      content: "\2212";
    }

    &:hover {
      background: var(--hover);
      color: var(--fg);
    }

    &:focus-visible {
      outline: 2px solid var(--border-strong);
      outline-offset: -2px;
    }
  }

  .rtag {
    padding: 2px 9px;
    background: var(--primary);
    color: var(--on-primary);
    clip-path:
      polygon(
        var(--chamfer-s) 0,
        100% 0,
        100% calc(100% - var(--chamfer-s)),
        calc(100% - var(--chamfer-s)) 100%,
        0 100%,
        0 var(--chamfer-s)
      );
    font-size: 11px;
    letter-spacing: 0.08em;
    box-shadow: var(--cyber-glow-primary);
  }

  .reel {
    padding-block-end: 14px;
    padding-inline: 14px;
  }
</style>
