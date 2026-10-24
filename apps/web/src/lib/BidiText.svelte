<script lang="ts">
  /* ---- Hebrew with Latin words in it ----------------------------------------------
     "ה־API הרשמי והציבורי של Gemini Live, בחיוב…": left to the bidi algorithm, a Latin
     run in an RTL line takes its neighbours' neutrals with it — the maqaf, the comma, the
     space — and the words land out of order. Each Latin run here is its own isolated LTR
     box, the same rule as a formula (lib/tex.ts) and a video title (QuestionCard), so
     the Hebrew around it reads as if it were one word. The strings stay plain text in
     their home (lib/engine.ts); only the rendering knows about direction. */
  let { text }: { text: string } = $props();

  /** A Latin run: words of letters and digits, joined inside by . - ' and between by one
   *  space — "API", "Gemini Live", "Google AI Studio". Punctuation after it stays Hebrew. */
  const LATIN = /([A-Za-z][A-Za-z0-9]*(?:[.\-'][A-Za-z0-9]+)*(?: [A-Za-z][A-Za-z0-9]*(?:[.\-'][A-Za-z0-9]+)*)*)/;

  // split() with a capturing group: the even parts are the Hebrew, the odd ones the runs
  const parts = $derived(text.split(LATIN));
</script>

{#each parts as part, i (i)}{#if i % 2}<bdi dir="ltr">{part}</bdi>{:else}{part}{/if}{/each}
