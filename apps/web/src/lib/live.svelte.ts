/** The pad's half of a Gemini Live session: what state it is in, the pictures Gemini
 *  asks for, and the notes it writes down.
 *
 *  Two engines run the session (lib/engine.ts). On the subscription the extension does the
 *  talking to Gemini (apps/extension, background.ts); this side only ever posts a request
 *  to its own window and listens for what comes back, exactly like the Claude check
 *  (lib/check.ts). Two things come back unasked: the session's state, and a request for a
 *  picture, which Gemini pulls about once a second. On the API key this page runs the
 *  session itself (lib/tutor-session.ts, loaded only then) and pushes a picture every
 *  second. Either way every picture is drawn fresh by `draw` (lib/frame.ts) and goes out
 *  through one function, `frame`, so it always shows the board as it is and the blind
 *  watchdog counts both kinds.
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
  type LiveStatus,
  type LiveTarget
} from '@learn-math/shared/protocol';
import { SvelteSet } from 'svelte/reactivity';
import { Engine, forgetApiKey, readApiKey, readEngine, writeApiKey, writeEngine } from './engine';
import { say } from './notify.svelte';
import type { TutorSession } from './tutor-session';

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

/** What each state says on the page. FAILED says what the engine reported instead. */
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

/* ---- the engine, and the key ----------------------------------------------------- */

/** Which engine this device runs, and whether it holds a key. The key itself is not
 *  here: it is read from storage at the moment a session needs it, and never shown. */
export const tutorSetup = $state({
  engine: readEngine(),
  hasKey: readApiKey() !== '',
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
  tutorSetup.hasKey = readApiKey() !== '';
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

/* ---- the session on the key, run here ---------------------------------------------- */

const NOTE_FAILED = 'הפתק לא נכתב — בקש שוב';
const LOAD_FAILED = 'הקוד של ג׳מיני לא נטען — בדוק את החיבור ונסה שוב';

let tutor: TutorSession | null = null;
/** bumped by every start and stop, so a start overtaken while the mic was being asked
 *  for, or the code was loading, closes what it opened and says nothing */
let attempt = 0;

async function startOnKey(start: LiveStart): Promise<void> {
  const mine = ++attempt;
  const isCurrent = () => mine === attempt;
  setStatus({ state: LiveState.OPENING });
  // Only now: the socket, the mic and the speaker are not in the page's main chunk.
  const loaded = await import('./tutor-session').catch(() => null);
  if (!isCurrent()) {
    return;
  }
  if (!loaded) {
    setStatus({ state: LiveState.FAILED, detail: LOAD_FAILED });
    return;
  }

  try {
    const session = await loaded.startTutorSession({
      apiKey: readApiKey(),
      brief: start.prompt,
      target: start,
      captureFrame: frame,
      events: {
        onState(status) {
          if (!isCurrent()) {
            return;
          }
          setStatus(status);
          if (!isRunning(status.state)) {
            tutor = null;
          }
        },
        onNote(n) {
          if (isCurrent()) {
            receiveNote(n);
          }
        },
        // Live goes on, so the state stays what it is; the toast says the note is missing
        onNoteFailed() {
          if (isCurrent()) {
            say({ text: NOTE_FAILED });
          }
        },
        onSpeakerBlocked(isBlocked) {
          if (isBlocked && isCurrent()) {
            // the browser holds sound back until the page is used; the next touch frees it
            addEventListener('pointerdown', () => tutor?.unblockSpeaker(), { once: true });
          }
        }
      }
    });
    if (isCurrent()) {
      tutor = session;
    } else {
      session.stop();
    }
  } catch (e) {
    if (isCurrent()) {
      setStatus({ state: LiveState.FAILED, detail: loaded.startFailure(e) });
    }
  }
}

function stopOnKey(): void {
  attempt++;
  tutor?.stop();
  tutor = null;
  setStatus({ state: LiveState.ENDED });
}

/* ---- start, aim, end: to whichever engine runs the session ------------------------
   To the extension these are fire and forget: what happens arrives as a status. */

export function startLive(start: LiveStart): void {
  runningOn = tutorSetup.engine;
  if (runningOn === Engine.API_KEY) {
    void startOnKey(start);
    return;
  }

  void padMessenger.sendMessage(PadMessage.LIVE_START, start, location.origin).catch(() => {});
}

export function retargetLive(target: LiveTarget): void {
  if (runningOn === Engine.API_KEY) {
    tutor?.retarget(target);
    return;
  }

  void padMessenger.sendMessage(PadMessage.LIVE_RETARGET, target, location.origin).catch(() => {});
}

export function stopLive(): void {
  if (runningOn === Engine.API_KEY) {
    stopOnKey();
    return;
  }

  void padMessenger.sendMessage(PadMessage.LIVE_STOP, undefined, location.origin).catch(() => {});
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
  }, 1000);

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
