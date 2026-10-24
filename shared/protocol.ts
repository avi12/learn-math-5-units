/** The contract between the pad (apps/web) and the Chrome extension (apps/extension).
 *
 * Both sides import it from here. Before the monorepo it was typed out on each side of a
 * repo boundary, with a comment begging whoever changed one to change the other in the
 * same commit — and a mismatch fails silently: the page posts, nothing answers, and the
 * clipboard fallback looks like intended behaviour.
 *
 * The wire is @webext-core/messaging's window messenger: `PadProtocolMap` below is every
 * message between the page and the extension's script on it, each a function from what
 * it carries to what it answers. The `@1` in the namespace is the wire version, so a
 * build of one side that is older than the other still tells them apart. */
import { defineWindowMessaging } from '@webext-core/messaging/page';

/** The extension stamps `document.documentElement.dataset[PRESENCE_FLAG] = PRESENCE_READY`
 *  at document_start, so the pad knows BEFORE a click whether anyone is listening: the
 *  clipboard fallback has to happen inside the click's own user gesture. */
export const PRESENCE_FLAG = 'aviMathCheck';
export const PRESENCE_READY = 'ready';

/** What the pad sends, and what the Claude tab collects. */
export interface CheckPayload {
  /** the board, as a PNG data URL */
  image: string;
  /** the full prompt, criteria included */
  prompt: string;
  /** a human label for the exercise, for the banner in the Claude tab */
  topic: string;
}

/* ---- Gemini Live: the tutor who watches the board ------------------------------------
 *
 * The second button beside "שקלוד יבדוק". Claude marks the work when it is done; Gemini
 * Live helps while it is being done. The extension opens the Gemini web client in a
 * window of its own, briefs it as a private tutor, and from then on Gemini pulls a
 * picture of the board every second — and every picture is drawn here, by the pad, on
 * request (`frame`): the question, and the whole board or, while the pen is on it, the
 * board close up around the pen. Nothing about the real screen is ever shared. */

export const LiveAction = {
  /** open Gemini, brief it, go live — or bring an open session to the front */
  START: 'start',
  /** the exercise changed under a running session: a new name for the shared tab and a
   *  new note request. Not a new brief — that would pause Live (live_prompt_text). */
  RETARGET: 'retarget',
  STOP: 'stop'
} as const;
export type LiveAction = (typeof LiveAction)[keyof typeof LiveAction];

/** One session's life, in order. `IDLE` is the pad's own word for "none"; the extension
 *  never sends it, it sends `ENDED`. */
export const LiveState = {
  IDLE: 'idle',
  /** the Gemini window is loading */
  OPENING: 'opening',
  /** the tutor's brief is being typed in, and answered */
  BRIEFING: 'briefing',
  /** Gemini is writing a note down, beside Live — which goes on */
  WRITING: 'writing',
  /** Gemini is listening and watching */
  LIVE: 'live',
  /** Gemini paused itself and is being resumed */
  PAUSED: 'paused',
  /** Gemini broke ("Something went wrong") and its window is being reloaded, briefed
   *  again and taken back into Live */
  RECONNECTING: 'reconnecting',
  ENDED: 'ended',
  FAILED: 'failed'
} as const;
export type LiveState = (typeof LiveState)[keyof typeof LiveState];

export interface LiveRequest {
  action: LiveAction;
  /** the tutor's brief, criteria and exercise included (START) */
  prompt?: string;
  /** a human label for the exercise, for the Gemini window's shared-tab chip (START,
   *  RETARGET) */
  title?: string;
  /** how a note is asked for, for this exercise (START, RETARGET) */
  notes?: NoteRequest;
}

/** How Gemini is asked to write something down, all of it worded in the workbook
 *  (build/rebuild.py `live_note_text`): the extension only fills slots and compares. */
export interface NoteRequest {
  /** what Gemini says when it is writing something down, as a regular expression */
  cue: string;
  /** the request, the exercise already in it */
  template: string;
  /** where in `template` the person's words go, as the Live transcript heard them */
  heard: string;
  /** where in `template` Gemini's own words go — the sentence that said the cue */
  said: string;
  /** the whole answer when there is nothing to write */
  none: string;
}

/** A note: a title and a body, the body Hebrew prose with every formula in `$…$` — the
 *  same fence the exercises use (lib/tex.ts). */
export interface LiveNote {
  id: string;
  title: string;
  body: string;
}

export interface LiveStatus {
  state: LiveState;
  /** what went wrong, in words the pad can show as they are (FAILED) */
  detail?: string;
}

/** One picture, as the Gemini client's host API hands it over. */
export interface Frame {
  /** JPEG, base64, no data: prefix */
  base64: string;
  mimeType: string;
  width: number;
  height: number;
}

/** The messages between the pad page and the extension. */
export const PadMessage = {
  CHECK: 'check',
  LIVE: 'live',
  FRAME: 'frame',
  LIVE_STATUS: 'liveStatus',
  LIVE_NOTE: 'liveNote'
} as const;
export type PadMessage = (typeof PadMessage)[keyof typeof PadMessage];

/** Every message between the pad page and the extension's script on it. */
export interface PadProtocolMap {
  /** pad → extension: here is a board and a prompt, for Claude */
  [PadMessage.CHECK](data: CheckPayload): void;
  /** pad → extension: start, re-aim, or end the Gemini session */
  [PadMessage.LIVE](data: LiveRequest): void;
  /** extension → pad: Gemini wants a picture of the board */
  [PadMessage.FRAME](): Frame | null;
  /** extension → pad: how the session is doing */
  [PadMessage.LIVE_STATUS](data: LiveStatus): void;
  /** extension → pad: something Gemini wrote down for the board */
  [PadMessage.LIVE_NOTE](data: LiveNote): void;
}

/** The window messenger's namespace; the version is the wire's. */
export const PAD_NAMESPACE = 'avi-math@1';

export const padMessenger = defineWindowMessaging<PadProtocolMap>({ namespace: PAD_NAMESPACE });
