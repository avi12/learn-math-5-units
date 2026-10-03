<script lang="ts">
  /* Copy, and only copy. The board exists to get handwriting into a conversation with
     Claude, and that is a paste; downloading a file was a second way to do the same thing
     that ended one step further from it. The download stays in lib/deliver.ts — it is the
     fallback for when the browser refuses the clipboard.

     DESKTOP ONLY, and for the same reason שקלוד יבדוק is: the paste happens in a
     conversation, and the conversation is on the desktop. On the tablet the button did not
     fail — it landed somewhere else. Inside the Android wrapper the clipboard write is
     refused and the bytes go to the system share sheet, so the label promised a paste and
     delivered a share menu. Avi's call: the copy belongs where the pasting is. */
  import { copyImage, type Delivered } from './deliver';
  import { say } from './notify.svelte';
  import type { SurfaceApi } from './Surface.svelte';
  import iconCamera from './icons/IconCamera.svg?raw';
  import iconParts from './icons/IconParts.svg?raw';

  let { surface, parts, part }: { surface: SurfaceApi | undefined; parts: number; part: number } =
    $props();

  const PASTE = 'הדבק בקלוד';
  const FAILED: Record<Exclude<Delivered, 'copied'>, string> = {
    downloaded: 'הדפדפן חסם העתקה — הקובץ ירד במקום',
    'share-failed': 'השיתוף נכשל',
    'export-failed': 'הייצוא נכשל'
  };

  /** Canvas to clipboard, with the board's own acknowledgement. Returns whether the
   *  bytes got out — by either route, since the download fallback is still a delivery. */
  async function deliver(c: HTMLCanvasElement | undefined, ok: string): Promise<boolean> {
    if (!c) {
      return false;
    }

    // The board says it was read, and it says so HERE — in the same frame as the press,
    // before the clipboard has answered. The toast reports the outcome; this reports that
    // something happened at all, and it does it on the thing that was copied rather than
    // in a corner of the screen. It fires even when the clipboard refuses, because the
    // capture is what it is acknowledging and the capture did happen.
    surface?.flash();
    const result = await copyImage(c);
    say(result === 'copied' ? ok : FAILED[result]);
    return result !== 'export-failed';
  }

  function copyAll() {
    void deliver(surface?.exportCanvas(), `הועתק ללוח — ${PASTE}`);
  }

  /** One page-sized part, and then the board moves to the next one.
   *
   *  Avi (19.09.2026): "הדחיסה על הקנבס אצל claude.ai גדולה מדי… תאפשר לצלם בחלקים".
   *  The clipboard holds one image, so parts cannot be one press — but they can be one
   *  press REPEATED: copy, paste, copy, paste, and the board walks the strip on its own.
   *
   *  The picker follows the board, so the part being copied is the one already on the
   *  screen — there is nothing to scroll to first. What moves is the step AFTER, and the
   *  picker comes with it.
   *
   *  THE LAST PART IS WHERE IT STOPS. Avi (20.09.2026): "אני בוחר בחלק האחרון ואז אני
   *  מעתיק את החלק הזה הקנבס גולל פתאום לטופ". The counter used to wrap to the first
   *  part, which cost nothing while it was only a number — but the same wrap, once it
   *  moves the board, throws the reader to the top of the strip the moment they copy the
   *  end of their working. The picker beside this button can jump anywhere in one choice,
   *  so the walk ends where the writing ends. */
  async function copyPart() {
    const n = part + 1;
    const last = n >= parts;
    const which = last ? `הועתק החלק האחרון, ${n} מתוך ${parts}` : `הועתק חלק ${n} מתוך ${parts}`;
    const got = await deliver(surface?.exportCanvas(1800, part), `${which} — ${PASTE}`);
    if (!got || last) {
      return;
    }

    surface?.showPart(n);
  }

  /* Two listeners, and the first one is not redundant. `change` fires only when the value
     actually MOVES, so picking the part that is already picked fires nothing at all — and
     after scrolling away, choosing part 3 again to get back to part 3 did nothing.

     So the board follows the click on the OPTION, which happens every time a choice is
     made. That is reachable because the picker is `appearance: base-select`: the list is
     real DOM and an option's click bubbles here. Clicking the closed control to open it
     has no option under it and is ignored — opening a menu is not choosing. `change`
     stays as the portable path for a keyboard, and for a browser that still opens a
     native popup where no option click exists. */
  function onOptionClick(e: MouseEvent) {
    const opt = (e.target as HTMLElement).closest?.('option');
    if (!opt) {
      return;
    }

    surface?.showPart(Number(opt.value));
  }
</script>

<div class="group">
  <button class="btn" data-variant="primary" onclick={copyAll}>
    {@html iconCamera}העתק כתמונה
  </button>
  <!-- Only once the strip is longer than a page. On a one-page drawing the two buttons
       would copy the same image, and a choice between identical things is a control that
       can only be got wrong.

       A picker and not a counter on the button: Avi's own board splits into nine parts,
       and a button that only steps forward makes "the one with that exercise on it" six
       presses away. Choosing also scrolls the board there, so the picker doubles as the
       way to look before copying. -->
  {#if parts > 1}
    <label class="topic narrow">
      <select
        aria-label="איזה חלק להעתיק"
        value={part}
        onclick={onOptionClick}
        onchange={(e) => surface?.showPart(Number(e.currentTarget.value))}
      >
        {#each { length: parts } as _, i (i)}
          <option value={i}>חלק {i + 1} מתוך {parts}</option>
        {/each}
      </select>
    </label>
    <button class="btn" onclick={copyPart} title="שני עמודים בתמונה אחת — כמעט בלי דחיסה בשיחה">
      {@html iconParts}העתק חלק
    </button>
  {/if}
</div>
