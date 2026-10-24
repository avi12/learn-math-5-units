/** The API-key engine as the page drives it: start, aim and end a session this page runs
 *  itself (lib/tutor-session.ts). What the session reports goes back through `sink`, the
 *  same ways in that the extension's messages use (live.svelte.ts), so the rest of the page
 *  cannot tell the engines apart.
 *
 *  The session's code is loaded with `import()` on the first start and only then: the
 *  socket, the mic and the speaker are not in the page's main chunk. This file imports only
 *  its type. */
import {
  LiveState,
  NOTE_FAILED,
  isRunning,
  type Frame,
  type LiveNote,
  type LiveStart,
  type LiveStatus
} from '@learn-math/shared/protocol';
import { readApiKey, type LiveRunner } from './engine';
import { say } from './notify.svelte';
import type { TutorSession } from './tutor-session';

const LOAD_FAILED = 'הקוד של ג׳מיני לא נטען — בדוק את החיבור ונסה שוב';

/** Where a session's news goes on the page. */
export interface LiveSink {
  /** a fresh picture of the board, through the page's one frame function */
  captureFrame(): Promise<Frame | null>;
  onState(status: LiveStatus): void;
  onNote(note: LiveNote): void;
}

export function createKeyRunner(sink: LiveSink): LiveRunner {
  let tutor: TutorSession | null = null;
  /** bumped by every start and stop, so a start overtaken while the mic was being asked
   *  for, or the code was loading, closes what it opened and says nothing */
  let attempt = 0;

  async function open(start: LiveStart): Promise<void> {
    const mine = ++attempt;
    const isCurrent = () => mine === attempt;
    sink.onState({ state: LiveState.OPENING });
    const loaded = await import('./tutor-session').catch(() => null);
    if (!isCurrent()) {
      return;
    }
    if (!loaded) {
      sink.onState({ state: LiveState.FAILED, detail: LOAD_FAILED });
      return;
    }

    const session = await loaded.startTutorSession({
      apiKey: readApiKey(),
      brief: start.prompt,
      target: start,
      captureFrame: () => sink.captureFrame(),
      events: {
        onState(status) {
          if (!isCurrent()) {
            return;
          }
          sink.onState(status);
          if (!isRunning(status.state)) {
            tutor = null;
          }
        },
        onNote(n) {
          if (isCurrent()) {
            sink.onNote(n);
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
    }).catch((e: unknown) => {
      if (isCurrent()) {
        sink.onState({ state: LiveState.FAILED, detail: loaded.startFailure(e) });
      }
      return null;
    });
    if (!session) {
      return;
    }
    if (!isCurrent()) {
      session.stop();
      return;
    }

    tutor = session;
  }

  return {
    start(start) {
      void open(start);
    },
    retarget(target) {
      tutor?.retarget(target);
    },
    stop() {
      attempt++;
      tutor?.stop();
      tutor = null;
      sink.onState({ state: LiveState.ENDED });
    }
  };
}
