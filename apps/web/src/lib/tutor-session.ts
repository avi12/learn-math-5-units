/** A Gemini Live session on the person's own API key, run by this page — the in-page
 *  counterpart of the extension's apps/extension/src/utils/live.ts, and the pad's version
 *  of interview-prep's apps/gemini-live/src/voice/tutor-session.ts.
 *
 *   1. The brief is the session's system instruction, so there is no text turn to type:
 *      the official API takes a system prompt, the web client does not.
 *   2. A picture every second, drawn by the same `draw` that answers the extension's pulls
 *      (lib/frame.ts), and handed over through the same function so the blind watchdog
 *      counts both (live.svelte.ts `frame`).
 *   3. The mic goes up the socket, Gemini's voice comes back down into the speaker, and the
 *      speaker is flushed the moment Gemini is interrupted.
 *   4. Notes, as the extension writes them (shared/notes.ts): both transcripts go into the
 *      cue watch, and when Gemini has said the cue and finished the sentence, the request
 *      goes to the text model BESIDE Live (gemini/generate.ts) while Live talks on.
 *
 *  Loaded with `import()` only when such a session starts (live.svelte.ts), so the socket,
 *  the mic and the speaker never weigh on a page that rides the subscription. */
import { askForNote, createCueWatch, type NoteExchange } from '@learn-math/shared/notes';
import { LiveState, type Frame, type LiveNote, type LiveStatus, type LiveTarget } from '@learn-math/shared/protocol';
import { generateText } from './gemini/generate';
import { openMic } from './gemini/mic';
import { createPlayback } from './gemini/playback';
import { LiveConnection, openLiveSession, type LiveClosure } from './gemini/session';

const FRAME_INTERVAL_MS = 1000;

const CONNECTION_STATE: Record<LiveConnection, LiveState> = {
  [LiveConnection.CONNECTING]: LiveState.OPENING,
  [LiveConnection.READY]: LiveState.LIVE,
  [LiveConnection.RECONNECTING]: LiveState.RECONNECTING
};

const MIC_DENIED_ERROR = 'NotAllowedError';
const MIC_DENIED = 'אין גישה למיקרופון — אשר אותה בכרום ונסה שוב';
const SETUP_REJECTED = 'ג׳מיני דחה את החיבור — בדוק שהמפתח נכון ושיש לו גישה ל־Live API';

export interface TutorSessionEvents {
  /** the session's state; `detail` says what went wrong (FAILED) */
  onState(status: LiveStatus): void;
  onNote(note: LiveNote): void;
  /** a note was asked for and did not come; Live goes on */
  onNoteFailed(): void;
  /** the speaker is held back until the page is clicked (the browser's autoplay rule) */
  onSpeakerBlocked(isBlocked: boolean): void;
}

export interface TutorSessionOptions {
  apiKey: string;
  /** the tutor's brief, the exercise and its criteria in it (check.ts `liveBrief`) */
  brief: string;
  target: LiveTarget;
  /** a fresh picture of the board, through the page's one frame function */
  captureFrame: () => Promise<Frame | null>;
  events: TutorSessionEvents;
}

/** Why a session closed, as the pad says it. */
function closedStatus(closure: LiveClosure): LiveStatus {
  if (closure.isSetupRejected) {
    return { state: LiveState.FAILED, detail: SETUP_REJECTED };
  }

  return { state: LiveState.ENDED };
}

/** What went wrong before the socket was even opened, in the pad's words. */
export function startFailure(error: unknown): string {
  if (error instanceof DOMException && error.name === MIC_DENIED_ERROR) {
    return MIC_DENIED;
  }

  return error instanceof Error ? error.message : String(error);
}

/** One side's utterance, as its transcript arrives in pieces: the first piece after
 *  `close` starts a new one. */
function createUtterance() {
  let text = '';
  let isOpen = false;
  return {
    /** adds a piece; true when it opened a new utterance */
    add(piece: string): boolean {
      const isNew = !isOpen;
      if (isNew) {
        text = '';
        isOpen = true;
      }
      text += piece;
      return isNew;
    },
    close() {
      isOpen = false;
    },
    get text() {
      return text.trim();
    }
  };
}

export async function startTutorSession({ apiKey, brief, target, captureFrame, events }: TutorSessionOptions) {
  let request = target.notes ?? null;
  let connection: LiveState = LiveState.OPENING;
  /** notes being written right now; WRITING shows over LIVE while there is one */
  let writing = 0;
  let isStopped = false;
  const stoppers: (() => void)[] = [];

  function report(): void {
    if (isStopped) {
      return;
    }

    const state = writing && connection === LiveState.LIVE ? LiveState.WRITING : connection;
    events.onState({ state });
  }

  function stop(): void {
    isStopped = true;
    watch.reset();
    for (const stopper of stoppers.splice(0)) {
      stopper();
    }
  }

  async function writeNote(exchange: NoteExchange): Promise<void> {
    const asked = request;
    if (!asked || isStopped) {
      return;
    }

    writing++;
    report();
    const { note, isNone } = await askForNote({
      request: asked,
      exchange,
      ask: (prompt) => generateText({ apiKey, prompt })
    });
    writing--;
    if (isStopped) {
      return;
    }

    if (note) {
      events.onNote(note);
    } else if (!isNone) {
      events.onNoteFailed();
    }
    report();
  }

  const watch = createCueWatch({ release: (exchange) => void writeNote(exchange) });

  /* A Gemini utterance runs from its first piece to its turn's end and gets the next
     index; the person's runs until Gemini answers. */
  const heard = createUtterance();
  const said = createUtterance();
  let saidIndex = -1;

  events.onState({ state: LiveState.OPENING });
  const playback = createPlayback((isBlocked) => events.onSpeakerBlocked(isBlocked));
  stoppers.push(() => playback.close());
  playback.resume();

  let session: ReturnType<typeof openLiveSession> | null = null;
  const mic = await openMic((pcm) => session?.sendAudio(pcm)).catch((error: unknown) => {
    stop();
    throw error;
  });
  stoppers.push(() => mic.close());

  session = openLiveSession({
    apiKey,
    systemInstruction: brief,
    events: {
      onConnection(c) {
        connection = CONNECTION_STATE[c];
        report();
      },
      onAudio: (bytes) => playback.play(bytes),
      onInterrupted: () => playback.flush(),
      onUserText(text) {
        heard.add(text);
        watch.user(heard.text);
      },
      onModelText(text) {
        heard.close();
        if (said.add(text)) {
          saidIndex++;
        }
        watch.model({ text: said.text, index: saidIndex, cue: request?.cue });
      },
      onTurnComplete() {
        said.close();
        watch.turnEnded(saidIndex);
      },
      onClosed(closure) {
        if (isStopped) {
          return;
        }

        events.onState(closedStatus(closure));
        stop();
      }
    }
  });
  const live = session;
  stoppers.push(() => live.close());

  let isDrawing = false;
  const timer = setInterval(() => {
    if (isDrawing || connection !== LiveState.LIVE) {
      return;
    }

    isDrawing = true;
    void captureFrame()
      .then((frame) => frame && live.sendFrame(frame))
      .catch(() => {})
      .finally(() => (isDrawing = false));
  }, FRAME_INTERVAL_MS);
  stoppers.push(() => clearInterval(timer));

  return {
    /** The exercise changed: a new note request. Live is not told in words — it sees the
     *  new question in the next picture, and the brief says to follow it. */
    retarget(next: LiveTarget) {
      request = next.notes ?? request;
    },
    /** A click on the page lets a held-back speaker play. */
    unblockSpeaker: () => playback.resume(),
    stop
  };
}

export type TutorSession = Awaited<ReturnType<typeof startTutorSession>>;
