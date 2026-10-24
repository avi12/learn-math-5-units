/** The lesson: a Gemini Live session tied to the exercise on the page. lib/live.svelte.ts
 *  runs the session whichever engine carries it; this is what the PAGE owes it — the
 *  picture of the board and the question, the exercise it is about as that changes, the
 *  notes folded away with their question, and the one button that starts and ends it.
 *
 *  Called once, while App.svelte initialises, so its effects live as long as the page. */
import { checkLabel, liveBrief, noteRequest } from './check';
import type { Question, Scene } from './frame';
import { canStart, clearNotes, installLive, isRunning, live, retargetLive, startLive, stopLive } from './live.svelte';
import type { Choice } from './pick.svelte';
import { LiveState } from '@learn-math/shared/protocol';
import { onMount, untrack } from 'svelte';

const NOT_FROM_WORKBOOK = 'התרגיל אינו מהחוברת: השאלה כתובה על הלוח.';

/** The question as Gemini's picture shows it, with the newest note under it. */
function question(choice: Choice): Question {
  return {
    meta: checkLabel(choice),
    html: choice.exercise?.html ?? NOT_FROM_WORKBOOK,
    note: live.notes[0]
  };
}

/** What the engine needs to know about the exercise: its name, for the shared tab, and
 *  how to ask for a note about it. */
function exercise(choice: Choice) {
  return {
    title: checkLabel(choice),
    notes: noteRequest(choice)
  };
}

export function lesson({ choice, scene }: {
  choice: Choice;
  /** the board as the picture needs it; undefined until the board is mounted */
  scene: () => Scene | undefined;
}): { toggle: () => void } {
  // The picture is drawn only while a session runs, so its code — and the maths
  // stylesheet it carries into the question panel — is not in the page's main chunk.
  onMount(() =>
    installLive({
      async draw() {
        const board = scene();
        if (!board) {
          return null;
        }

        const q = question(choice);
        const { drawFrame } = await import('./frame');
        return drawFrame({ scene: board, question: q });
      }
    })
  );

  /** The exercise last told to the session, so a change can be told apart from a session
   *  that is merely changing state. */
  let told = '';

  // A new exercise mid-session is NOT briefed again: that would be a text turn, and a
  // text turn inside Live left it listening and silent (Avi, 14.10.2026). Gemini sees the
  // new question in its picture, and the brief says to follow it; this only renames the
  // shared tab and re-aims the note request.
  $effect(() => {
    const next = exercise(choice);
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
    if (choice.pick === notesFor) {
      return;
    }

    notesFor = choice.pick;
    untrack(clearNotes);
  });

  function toggle(): void {
    if (isRunning(live.state)) {
      stopLive();
      return;
    }

    // On the key with no key yet, the question card opens the key field instead; the
    // subscription is only offered where the extension is (lib/engine.ts `readEngine`).
    if (!canStart()) {
      return;
    }

    const next = exercise(choice);
    told = next.notes.template;
    live.state = LiveState.OPENING;
    startLive({ prompt: liveBrief(choice), ...next });
  }

  return { toggle };
}
