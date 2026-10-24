/** When Gemini writes a note, and what the note is — the same for every engine that runs
 *  the tutor: the extension riding the Gemini subscription (apps/extension, live.ts), and
 *  the pad on the person's own API key. Nothing here knows how a transcript arrives or
 *  where a request goes; an engine feeds the watch what it hears, sends the prompt it is
 *  handed to Gemini's text side, and judges the answer here.
 *
 * The flow, as the workbook teaches it (build/rebuild.py `live_note_text`):
 *   1. Gemini says the cue it was taught for "write that down".
 *   2. The note waits for that sentence to end — what Gemini says it is writing is what
 *      the note is made from — or for NOTE_WAIT_MS, whichever comes first.
 *   3. The request goes out with both sides of the exchange in it (`notePrompt`), BESIDE
 *      Live, which goes on talking the whole time.
 *   4. The answer is a note, or "nothing to write" (`noteFromAnswer`). */
import type { LiveNote, NoteRequest } from './protocol';

/** The longest a note waits for Gemini to finish the sentence that said the cue. */
export const NOTE_WAIT_MS = 15_000;

/** How Gemini's text stands in for a part it rendered instead — an app's action card, a
 *  picture, a canvas: `http://googleusercontent.com/action_card_content/<id>` and its
 *  kin. Such an answer has done something elsewhere (a note made in an app, Avi
 *  15.10.2026) and holds no note of its own. */
const RENDERED_PART = /\bgoogleusercontent\.com\//;

/** A note out of the answer's markdown: inside a code fence if Gemini used one, the
 *  first line its title, and the markdown's own marks (bold, headings, bullets) dropped —
 *  the pad renders `$…$` and plain lines, nothing else. */
export function noteOf(answer: string): LiveNote | null {
  if (RENDERED_PART.test(answer)) {
    return null;
  }

  const fenced = /```[a-z]*\n?([\s\S]*?)```/i.exec(answer)?.[1] ?? answer;
  const lines = fenced
    .split('\n')
    .map((l) => l.replace(/^\s*(?:#+|[-*•]|\d+\.)\s+/, '').replace(/\*\*|__/g, '').trim())
    .filter(Boolean);
  if (!lines.length) {
    return null;
  }

  const [title = '', ...rest] = lines;
  return {
    id: crypto.randomUUID(),
    title: rest.length ? title : 'מג׳מיני',
    body: rest.length ? rest.join('\n') : title
  };
}

/** The request for a note: the workbook's template, with the person's last words and
 *  Gemini's sentence in their slots. */
export function notePrompt({
  request,
  heardText,
  saidText
}: {
  request: NoteRequest;
  heardText: string;
  saidText: string;
}): string {
  return request.template.replace(request.heard, heardText).replace(request.said, saidText);
}

/** What an answer to `notePrompt` comes to. `isNone` is Gemini saying there is nothing to
 *  write — an answer, and the right one for a cue said in passing; a null note without it
 *  is a note that failed. */
export function noteFromAnswer({ answer, request }: { answer: string; request: NoteRequest }): {
  note: LiveNote | null;
  isNone: boolean;
} {
  const text = answer.trim();
  const isNone = text.replace(/["'.״]/g, '').trim() === request.none;
  return { note: text && !isNone ? noteOf(text) : null, isNone };
}

/** What the transcript is listened for. An engine tells it each line as it arrives and
 *  each Gemini turn as it ends; it calls `release` once per note. */
export interface CueWatch {
  /** the person said `text` — the latest line of their utterance */
  user(text: string): void;
  /** Gemini's utterance `index` reads `text` so far; `cue` is the session's, if it has one */
  model({ text, index, cue }: { text: string; index: number; cue: string | null | undefined }): void;
  /** Gemini's utterance `index` is over */
  turnEnded(index: number): void;
  /** forget everything: the session ended or started over */
  reset(): void;
}

export function createCueWatch({
  release,
  waitMs = NOTE_WAIT_MS
}: {
  release: (said: { heardText: string; saidText: string }) => void;
  waitMs?: number;
}): CueWatch {
  /** The person's last words, which the note request quotes — as context only: a
   *  transcript of the room can be anything. */
  let lastHeard = '';
  /** The Gemini utterance that said the cue, and what it has said so far. */
  let armed = -1;
  let saying = '';
  /** If the end of the sentence never arrives, the note goes anyway after `waitMs`. */
  let fallback: ReturnType<typeof setTimeout> | undefined;

  const disarm = () => {
    clearTimeout(fallback);
    armed = -1;
    saying = '';
  };

  const fire = () => {
    if (armed < 0) {
      clearTimeout(fallback);
      return;
    }

    const said = { heardText: lastHeard, saidText: saying };
    disarm();
    release(said);
  };

  return {
    user(text) {
      lastHeard = text;
    },
    model({ text, index, cue }) {
      if (index === armed) {
        saying = text;
        return;
      }
      if (!cue || !new RegExp(cue).test(text)) {
        return;
      }

      armed = index;
      saying = text;
      clearTimeout(fallback);
      fallback = setTimeout(fire, waitMs);
    },
    turnEnded(index) {
      if (index === armed) {
        fire();
      }
    },
    reset() {
      disarm();
      lastHeard = '';
    }
  };
}
