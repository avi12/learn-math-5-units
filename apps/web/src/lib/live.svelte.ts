/** The pad's half of a Gemini Live session: what state it is in, the pictures Gemini
 *  asks for, and the notes it writes down.
 *
 *  The extension does the talking to Gemini (apps/extension, background.ts); this side
 *  only ever posts a request to its own window and listens for what comes back, exactly
 *  like the Claude check (lib/check.ts). Two things come back unasked: the session's
 *  state, and a request for a picture — Gemini pulls one about once a second, and every
 *  one is drawn fresh by `draw` (lib/frame.ts), so it always shows the board as it is.
 *
 *  One instance for the page, like the toast: the session is the page's, not a
 *  component's, and the question card, the notes and the frame all read the same one. */
import {
  LiveState,
  PadMessage,
  padMessenger,
  type Frame,
  type LiveNote,
  type LiveStart,
  type LiveTarget
} from '@learn-math/shared/protocol';
import { SvelteSet } from 'svelte/reactivity';

/** How many notes stay up at once. A note is a reminder for the exercise in hand; a
 *  wall of them would push the board down the screen. */
export const NOTES_MAX = 3;

export const live = $state({
  state: LiveState.IDLE as LiveState,
  /** what went wrong, as the extension worded it (FAILED) */
  detail: '',
  /** Live is up but Gemini has stopped asking for pictures, so what it says about the
   *  board is about an old one. The desktop knows, since it draws them; it tells the tablet */
  blind: false,
  /** newest first */
  notes: [] as LiveNote[]
});

/** The states in which there is a session to end. */
const RUNNING: ReadonlySet<LiveState> = new Set([
  LiveState.OPENING,
  LiveState.BRIEFING,
  LiveState.WRITING,
  LiveState.LIVE,
  LiveState.PAUSED,
  LiveState.RECONNECTING
]);

export function isRunning(s: LiveState): boolean {
  return RUNNING.has(s);
}

/** What each state says on the page. FAILED says what the extension reported instead. */
export const LIVE_LABEL: Record<LiveState, string> = {
  [LiveState.IDLE]: '',
  [LiveState.OPENING]: 'פותח את ג׳מיני…',
  [LiveState.BRIEFING]: 'מתדרך את המורה…',
  [LiveState.WRITING]: 'ג׳מיני רושם לך…',
  [LiveState.LIVE]: 'ג׳מיני מקשיב ורואה את הלוח',
  [LiveState.PAUSED]: 'ג׳מיני חוזר לשיחה…',
  [LiveState.RECONNECTING]: 'ג׳מיני נפל — מתחבר מחדש…',
  [LiveState.ENDED]: 'השיעור הסתיים',
  [LiveState.FAILED]: 'ג׳מיני לא עלה'
};

/** Gemini asks for a picture about once a second; this long without one means it stopped. */
const BLIND_MS = 5000;
const BLIND_LABEL = 'ג׳מיני מקשיב, אבל הפסיק להסתכל על הלוח';

/** The line to show for the session right now. */
export function liveLabel(): string {
  if (live.state === LiveState.LIVE && live.blind) {
    return BLIND_LABEL;
  }

  return live.state === LiveState.FAILED && live.detail ? live.detail : LIVE_LABEL[live.state];
}

/** Notes on their way off the screen. None is taken off the list here: the card folds it
 *  away (LiveNotes.svelte), and drops it once the fold has run (`dropNote`). */
export const leaving = new SvelteSet<string>();

/** One past NOTES_MAX is kept: the note a new one pushes out folds away the same way. */
function addNote(n: LiveNote): void {
  live.notes = [n, ...live.notes.filter((x) => x.id !== n.id)].slice(0, NOTES_MAX + 1);
}

/** One note closed. */
export function dismissNote(id: string): void {
  leaving.add(id);
}

/** All of them: a new question, and the notes were for the last one. Avi: "כשאני עובר
 *  שאלה זה צריך לרוקן את הסעיפים שג'מיני יצר בצורה של אנימציה". */
export function clearNotes(): void {
  for (const n of live.notes) {
    leaving.add(n.id);
  }
}

export function dropNote(id: string): void {
  leaving.delete(id);
  live.notes = live.notes.filter((n) => n.id !== id);
}

/* Asking the extension for a session, a new aim, an end. Fire and forget: what happens
   arrives as a status. */

export function startLive(start: LiveStart): void {
  void padMessenger.sendMessage(PadMessage.LIVE_START, start, location.origin).catch(() => {});
}

export function retargetLive(target: LiveTarget): void {
  void padMessenger.sendMessage(PadMessage.LIVE_RETARGET, target, location.origin).catch(() => {});
}

export function stopLive(): void {
  void padMessenger.sendMessage(PadMessage.LIVE_STOP, undefined, location.origin).catch(() => {});
}

/** Listen for the session, answer its picture requests with `draw`, and hand each new
 *  note to `onnote` as well as keeping it. Returns the teardown. */
export function installLive(draw: () => Promise<Frame | null>, onnote?: (n: LiveNote) => void): () => void {
  /** when Gemini last asked this page for a picture; 0 on a page it never talks to — the
   *  tablet, which hears `blind` from the desktop instead */
  let asked = 0;
  const watch = setInterval(() => {
    if (!asked) {
      return;
    }

    const blind = live.state === LiveState.LIVE && performance.now() - asked > BLIND_MS;
    if (live.blind !== blind) {
      live.blind = blind;
    }
  }, 1000);

  const listeners = [
    padMessenger.onMessage(PadMessage.FRAME, () => {
      asked = performance.now();
      return draw().catch(() => null);
    }),
    padMessenger.onMessage(PadMessage.LIVE_STATUS, ({ data }) => {
      if (data.state === LiveState.LIVE && live.state !== LiveState.LIVE) {
        asked = performance.now(); // a grace period from the moment Live comes up
      }
      live.state = data.state;
      live.detail = data.detail ?? '';
    }),
    padMessenger.onMessage(PadMessage.LIVE_NOTE, ({ data }) => {
      addNote(data);
      onnote?.(data);
    })
  ];

  return () => {
    clearInterval(watch);
    for (const off of listeners) {
      off();
    }
  };
}
