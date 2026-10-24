/** The pad's half of a Gemini Live session: what state it is in, the pictures Gemini
 *  asks for, and the notes it writes down.
 *
 *  Two engines run the session (lib/engine.ts). On the subscription the extension does the
 *  talking to Gemini (apps/extension, background.ts); this side only ever posts a request
 *  to its own window and listens for what comes back, exactly like the Claude check
 *  (lib/check.ts). Two things come back unasked: the session's state, and a request for a
 *  picture, which Gemini pulls about once a second. On the API key this page runs the
 *  session itself (lib/live-key.ts, which loads lib/tutor-session.ts only then) and
 *  pushes a picture every second. Either way every picture is drawn fresh by `draw`
 *  (lib/frame.ts) and goes out through one function, `frame`, so it always shows the
 *  board as it is and the blind watchdog counts both kinds.
 *
 *  One instance for the page, like the toast: the session is the page's, not a
 *  component's, and the question card, the notes and the frame all read the same one. */
import {
  LiveState,
  PadMessage,
  isRunning,
  padMessenger,
  type Frame,
  type LiveNote,
  type LiveStart,
  type LiveStatus,
  type LiveTarget
} from '@learn-math/shared/protocol';
import { SvelteSet } from 'svelte/reactivity';
import { Engine, forgetApiKey, hasApiKey, readEngine, writeApiKey, writeEngine, type LiveRunner } from './engine';
import { createKeyRunner } from './live-key';

/** How many notes stay up at once. A note is a reminder for the exercise in hand; a
 *  wall of them would push the board down the screen. */
export const NOTES_MAX = 3;

export const live = $state({
  state: LiveState.IDLE as LiveState,
  /** what went wrong, as the engine worded it (FAILED) */
  detail: '',
  /** Live is up but Gemini has stopped asking for pictures, so what it says about the
   *  board is about an old one. The desktop knows, since it draws them; it tells the tablet */
  blind: false,
  /** newest first */
  notes: [] as LiveNote[]
});

/** Its home is the protocol, beside the states; the page's components import it from here. */
export { isRunning };

/** What each state says on the page. FAILED says what the engine reported instead, and
 *  this only when the engine reported nothing — so no engine has to word it again. */
const LIVE_LABEL: Record<LiveState, string> = {
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
/** How often the watchdog looks. */
const BLIND_CHECK_MS = 1000;
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

/* ---- the engine, and the key ----------------------------------------------------- */

/** Which engine this device runs, and whether it holds a key. The key itself is not
 *  here: it is read from storage at the moment a session needs it, and never shown. */
export const tutorSetup = $state({
  engine: readEngine(),
  hasKey: hasApiKey(),
  /** a start found no key, so the key field is where to look */
  isKeyAsked: false
});

/** The engine the running session started on — the one stop and retarget go to. */
let runningOn: Engine = tutorSetup.engine;

export function chooseEngine(engine: Engine): void {
  if (isRunning(live.state)) {
    return;
  }

  tutorSetup.engine = engine;
  writeEngine(engine);
}

export function saveApiKey(key: string): void {
  writeApiKey(key);
  tutorSetup.hasKey = hasApiKey();
  tutorSetup.isKeyAsked = false;
}

export function dropApiKey(): void {
  forgetApiKey();
  tutorSetup.hasKey = false;
}

/** A start can go ahead: the subscription needs nothing more here, the key needs a key.
 *  When it is missing, the key field is asked for instead (QuestionCard). */
export function canStart(): boolean {
  if (tutorSetup.engine === Engine.API_KEY && !tutorSetup.hasKey) {
    tutorSetup.isKeyAsked = true;
    return false;
  }

  return true;
}

/* ---- one way in for each thing that comes back, whichever engine sent it ---------- */

/** `draw`, once installLive has it; null on a page that has not mounted the board */
let draw: (() => Promise<Frame | null>) | null = null;
let onNote: ((n: LiveNote) => void) | undefined;
/** when a picture last went to Gemini, pulled or pushed; 0 on a page it never talks to —
 *  the tablet, which hears `blind` from the desktop instead */
let asked = 0;

/** A fresh picture of the board for Gemini. Every picture goes out through here. */
function frame(): Promise<Frame | null> {
  asked = performance.now();
  return draw ? draw().catch(() => null) : Promise.resolve(null);
}

function setStatus({ state, detail }: LiveStatus): void {
  if (state === LiveState.LIVE && live.state !== LiveState.LIVE) {
    asked = performance.now(); // a grace period from the moment Live comes up
  }
  live.state = state;
  live.detail = detail ?? '';
}

function receiveNote(n: LiveNote): void {
  addNote(n);
  onNote?.(n);
}

/* ---- start, aim, end: to whichever engine runs the session ------------------------ */

const RUNNERS: Record<Engine, LiveRunner> = {
  // the extension runs it; to the extension these are fire and forget
  [Engine.SUBSCRIPTION]: {
    start(start) {
      void padMessenger.sendMessage(PadMessage.LIVE_START, start, location.origin).catch(() => {});
    },
    retarget(target) {
      void padMessenger.sendMessage(PadMessage.LIVE_RETARGET, target, location.origin).catch(() => {});
    },
    stop() {
      void padMessenger.sendMessage(PadMessage.LIVE_STOP, undefined, location.origin).catch(() => {});
    }
  },
  // this page runs it, its code loaded only when a session starts
  [Engine.API_KEY]: createKeyRunner({ captureFrame: frame, onState: setStatus, onNote: receiveNote })
};

export function startLive(start: LiveStart): void {
  runningOn = tutorSetup.engine;
  RUNNERS[runningOn].start(start);
}

export function retargetLive(target: LiveTarget): void {
  RUNNERS[runningOn].retarget(target);
}

export function stopLive(): void {
  RUNNERS[runningOn].stop();
}

/** Listen for the session, answer its picture requests with `draw`, and hand each new
 *  note to `onnote` as well as keeping it. Returns the teardown. */
export function installLive({ draw: drawer, onnote }: {
  draw: () => Promise<Frame | null>;
  onnote?: (n: LiveNote) => void;
}): () => void {
  draw = drawer;
  onNote = onnote;
  const watch = setInterval(() => {
    if (!asked) {
      return;
    }

    const blind = live.state === LiveState.LIVE && performance.now() - asked > BLIND_MS;
    if (live.blind !== blind) {
      live.blind = blind;
    }
  }, BLIND_CHECK_MS);

  const listeners = [
    padMessenger.onMessage(PadMessage.FRAME, frame),
    padMessenger.onMessage(PadMessage.LIVE_STATUS, ({ data }) => setStatus(data)),
    padMessenger.onMessage(PadMessage.LIVE_NOTE, ({ data }) => receiveNote(data))
  ];

  return () => {
    clearInterval(watch);
    draw = null;
    onNote = undefined;
    for (const off of listeners) {
      off();
    }
  };
}
