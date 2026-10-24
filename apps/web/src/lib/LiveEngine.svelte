<script lang="ts">
  /* ---- which engine runs Gemini Live ----------------------------------------
     Beside the Live button, desktop only: the tablet is a page to write on, and the
     session runs on the desktop either way. Folded to one line — the engine in use —
     because it is chosen once and then left alone; it opens by itself when a start
     finds the key missing (App.svelte `toggleLive` → live.svelte.ts `canStart`).

     The subscription goes through the extension, so it is offered only where the
     extension is, with Google's risk spelled out under it. The key is typed once, kept
     in this device's storage, and never shown again: it can be replaced or forgotten,
     not read. Every word comes from lib/engine.ts. */
  import { tick } from 'svelte';
  import { extensionPresent } from './check';
  import {
    API_KEY_CREATE_URL,
    ENGINE_DETAIL,
    ENGINE_LABEL,
    Engine,
    NEEDS_EXTENSION,
    SUBSCRIPTION_CONSEQUENCE,
    SUBSCRIPTION_RISK
  } from './engine';
  import { chooseEngine, dropApiKey, isRunning, live, saveApiKey, tutorSetup } from './live.svelte';

  let { onstart }: { onstart: () => void } = $props();

  const hasExtension = extensionPresent();
  const isLocked = $derived(isRunning(live.state));
  const needsKey = $derived(tutorSetup.engine === Engine.API_KEY && !tutorSetup.hasKey);

  let isOpen = $state(tutorSetup.engine === Engine.API_KEY && !tutorSetup.hasKey);
  let isReplacing = $state(false);
  let draft = $state('');
  let keyInput = $state<HTMLInputElement>();

  const isFormShown = $derived(tutorSetup.engine === Engine.API_KEY && (!tutorSetup.hasKey || isReplacing));

  // A start that found no key: open up, and put the cursor where the key goes.
  $effect(() => {
    if (!tutorSetup.isKeyAsked) {
      return;
    }

    isOpen = true;
    void tick().then(() => keyInput?.focus());
  });

  function save(): void {
    const key = draft.trim();
    if (!key) {
      return;
    }

    const wasAsked = tutorSetup.isKeyAsked;
    saveApiKey(key);
    draft = '';
    isReplacing = false;
    // the start that asked for the key goes ahead, on this same click
    if (wasAsked) {
      onstart();
    }
  }
</script>

<details class="engines" bind:open={isOpen}>
  <summary>
    <span class="elabel">מנוע</span>
    <span class="ename">{ENGINE_LABEL[tutorSetup.engine]}</span>
    {#if needsKey}
      <span class="chip">חסר מפתח</span>
    {/if}
  </summary>

  <fieldset class="choices" disabled={isLocked}>
    <legend class="elabel">מי מריץ את ג׳מיני לייב</legend>
    {#each Object.values(Engine) as option (option)}
      {@const isOffered = option !== Engine.SUBSCRIPTION || hasExtension}
      <label class="choice chamfer-s" class:off={!isOffered}>
        <input
          type="radio"
          name="engine"
          value={option}
          checked={tutorSetup.engine === option}
          disabled={!isOffered}
          onchange={() => chooseEngine(option)}
        />
        <span class="ctext">
          <span class="cname">{ENGINE_LABEL[option]}</span>
          {#if option === Engine.SUBSCRIPTION}
            <span class="callout risk" data-kind="warn">
              {SUBSCRIPTION_RISK} <strong>{SUBSCRIPTION_CONSEQUENCE}</strong>
            </span>
            {#if !isOffered}
              <span class="cdetail">{NEEDS_EXTENSION}</span>
            {/if}
          {:else}
            <span class="cdetail">{ENGINE_DETAIL[option]}</span>
          {/if}
        </span>
      </label>
    {/each}
    {#if isLocked}
      <span class="cdetail">מחליפים מנוע אחרי סיום השיעור</span>
    {/if}
  </fieldset>

  {#if isFormShown}
    <form
      class="keyform"
      onsubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <label class="keyfield">
        <span class="elabel">המפתח שלך</span>
        <input
          bind:this={keyInput}
          bind:value={draft}
          type="password"
          dir="ltr"
          autocomplete="off"
          spellcheck="false"
          placeholder="AIza…"
        />
      </label>
      <button class="btn" data-variant="primary" type="submit" disabled={!draft.trim()}>שמור</button>
      {#if isReplacing}
        <button class="btn" type="button" onclick={() => {
            isReplacing = false;
            draft = '';
          }}>ביטול</button>
      {/if}
      <p class="cdetail keynote">
        <a href={API_KEY_CREATE_URL} target="_blank" rel="noreferrer">להוציא מפתח חינם ב־<span dir="ltr">Google AI Studio</span></a>
        · נשמר רק בדפדפן הזה, ולא עובר לטאבלט
      </p>
    </form>
  {:else if tutorSetup.engine === Engine.API_KEY}
    <div class="keyrow">
      <span class="chip">מפתח שמור בדפדפן הזה</span>
      <button class="btn" type="button" disabled={isLocked} onclick={() => (isReplacing = true)}>החלף</button>
      <button class="btn" type="button" data-variant="danger" disabled={isLocked} onclick={dropApiKey}>שכח</button>
    </div>
  {/if}
</details>

<style>
  .engines {
    margin-block-start: 10px;
  }

  summary {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 10px;
    align-items: center;
    width: fit-content;
    cursor: pointer;
    list-style: none;

    &::-webkit-details-marker {
      display: none;
    }

    /* the same chevron as the pickers', turning as the fold opens */
    &::before {
      content: "";
      width: 7px;
      height: 7px;
      border-right: 2px solid var(--primary);
      border-bottom: 2px solid var(--primary);
      transform: rotate(135deg);
      transition: transform var(--dur-short) var(--ease-emph);
    }

    &:focus-visible {
      outline: 2px solid var(--primary);
      outline-offset: 3px;
    }
  }

  .engines[open] summary::before {
    transform: rotate(45deg);
  }

  .elabel {
    color: var(--fg-muted);
    font-family: var(--font-mono);
    font-size: 12px;
    letter-spacing: 0.07em;
  }

  .ename {
    color: var(--fg);
    font-size: 14px;
  }

  .choices {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr));
    gap: 8px;
    min-width: 0;
    margin: 10px 0 0;
    padding: 0;
    border: none;

    & legend {
      margin-block-end: 6px;
      padding: 0;
    }
  }

  .choice {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    min-width: 0;
    padding: 10px 12px;
    border: 2px solid var(--border);
    background: var(--surface-2);
    cursor: pointer;
    transition:
      background var(--dur-short) var(--ease-emph),
      border-color var(--dur-short) var(--ease-emph);

    &:hover {
      background: var(--hover);
    }

    &:has(input:checked) {
      border-color: var(--primary);
      box-shadow: var(--cyber-glow-primary);
    }

    &.off {
      cursor: not-allowed;
      opacity: 60%;
    }

    & input {
      flex: none;
      margin: 3px 0 0;
      accent-color: var(--primary);
    }
  }

  .choices:disabled .choice {
    cursor: not-allowed;
    opacity: 60%;
  }

  .ctext {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }

  .cname {
    color: var(--fg);
    font-size: 14.5px;
    font-weight: 600;
  }

  .cdetail {
    color: var(--fg-muted);
    font-size: 12.5px;
    line-height: 1.5;
  }

  /* the skin's callout rail is on the physical left; in this RTL page it belongs where
     the line starts */
  .risk {
    border-inline-start: 6px solid var(--accent);
    border-inline-end: 2px solid var(--border);
    padding: 6px 10px;
    color: var(--fg);
    font-size: 12.5px;
    line-height: 1.5;
  }

  .keyform,
  .keyrow {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 10px;
    align-items: flex-end;
    margin-block-start: 10px;
  }

  .keyrow {
    align-items: center;
  }

  .keyfield {
    display: flex;
    flex: 1 1 240px;
    flex-direction: column;
    gap: 4px;
    min-width: 0;

    & input {
      min-width: 0;
      padding: 8px 12px;
      border: 2px solid var(--border);
      background: var(--surface-2);
      color: var(--fg);
      clip-path:
        polygon(
          var(--chamfer-s) 0,
          100% 0,
          100% calc(100% - var(--chamfer-s)),
          calc(100% - var(--chamfer-s)) 100%,
          0 100%,
          0 var(--chamfer-s)
        );
      font: var(--t-body-m);
      font-family: var(--font-mono);

      /* a clipped box eats an outline, so the focus ring is drawn inside it */
      &:focus-visible {
        outline: none;
        box-shadow: inset 0 0 0 2px var(--primary), var(--cyber-glow-primary);
      }
    }
  }

  .keynote {
    flex-basis: 100%;
    margin: 0;

    & a {
      color: var(--fg);
      text-decoration-color: var(--primary);
      text-decoration-thickness: 2px;
      text-underline-offset: 3px;
    }
  }
</style>
