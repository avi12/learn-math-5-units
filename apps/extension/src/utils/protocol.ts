/** The extension's own wiring: the worker and its content scripts, the Gemini page's two
 *  worlds, and the parked payload.
 *
 * The pad <-> extension half of the contract (`PadProtocolMap`, `CheckPayload`, the presence
 * flag) is shared with the pad and lives in `shared/protocol.ts`. Every channel is an
 * @webext-core/messaging messenger over a protocol map, as that one is. */
import type {
  CheckPayload,
  Frame,
  LiveNote,
  LiveRequest,
  LiveStatus
} from '@learn-math/shared/protocol';
import { defineExtensionMessaging } from '@webext-core/messaging';
import { defineCustomEventMessaging } from '@webext-core/messaging/page';

/** The one row in `chrome.storage.local`. */
export const PENDING = 'pending';

/** Where a check goes. */
export const NEW_CHAT = 'https://claude.ai/new';

/** How long a parked payload stays valid. A stale one is worse than none: it would be
 *  pasted into whatever Claude tab opens next, days later. */
export const PENDING_TTL_MS = 5 * 60 * 1000;

/** The same, once the background has stamped it. */
export type PendingCheck = CheckPayload & { at: number };

/* ---- Gemini Live ------------------------------------------------------------------
 *
 * Three parties on the Gemini side. The BRIDGE runs in the Gemini page's own world
 * (glic.content.ts): it stands in for the browser host the Gemini client expects and
 * answers its calls. The RELAY runs beside it in the extension's world
 * (glic-relay.content.ts), because only that world can reach the worker. The WORKER
 * (live.ts) owns the session: the window, the brief, the frames from the pad. */

/** The Gemini web client — the one behind Gemini in Chrome. Both Gemini-side scripts
 *  match under it. */
export const GLIC_URL = 'https://gemini.google.com/glic';

export interface GlicHello {
  mine: boolean;
  /** the exercise, for the chip Gemini shows over a shared tab */
  title: string;
  /** the pad's address, which that chip also shows */
  url: string;
}

/** What makes a Gemini tab a session's, and what the shared-tab chip says. Live sends
 *  that name with every start (agentic-gaming-assistant, AIDA-LIVE-FINDINGS.md: the
 *  "Surface" frame), so it is one more place Gemini reads which exercise this is. */
export interface Activation {
  title: string;
  url: string;
}

/** What the bridge reports. */
export const BridgeUp = {
  /** Gemini adopted our host */
  BOOTED: 'booted',
  /** Live is on: Gemini is listening */
  READY: 'ready',
  STATE: 'state',
  ERROR: 'error',
  /** a line of what was said */
  TRANSCRIPT: 'transcript',
  /** Gemini finished (or was cut off in) what it was saying */
  TURN_END: 'turn-end'
} as const;
export type BridgeUp = (typeof BridgeUp)[keyof typeof BridgeUp];

export type BridgeReport =
  | { kind: typeof BridgeUp.BOOTED }
  | { kind: typeof BridgeUp.READY }
  | { kind: typeof BridgeUp.STATE; state: GlicState }
  | { kind: typeof BridgeUp.ERROR; message: string }
  | { kind: typeof BridgeUp.TRANSCRIPT; direction: Direction; text: string; index: number }
  | { kind: typeof BridgeUp.TURN_END; index: number };

/** The calls the bridge answers. */
export const BridgeCall = {
  /** go Live (or resume it) */
  START: 'start',
  STOP: 'stop',
  /** leave Live for the text box, emptied and focused, ready to be typed into */
  BEGIN_TEXT: 'beginText',
  /** send what was typed, wait for the answer, return it as a `TextReply` */
  SUBMIT: 'submitAndRead',
  /** ask Gemini `arg` in a conversation of its own, beside Live, and return the answer's
   *  text — the page's own signed-in text endpoint, so Live is never paused for it */
  ASK: 'ask'
} as const;
export type BridgeCall = (typeof BridgeCall)[keyof typeof BridgeCall];

/** What a text turn came back with. `code` is the last code block, character for
 *  character; `text` is everything, as the page shows it. */
export interface TextReply {
  text: string;
  code: string;
}

/** Live's own states, as the bridge reports them in STATE. */
export const GlicState = { IDLE: 'idle', LISTENING: 'listening', RESUMING: 'resuming' } as const;
export type GlicState = (typeof GlicState)[keyof typeof GlicState];

/** Who said a TRANSCRIPT line. */
export const Direction = { USER: 'user', ASSISTANT: 'assistant' } as const;
export type Direction = (typeof Direction)[keyof typeof Direction];

/** The failures the bridge reports in ERROR that mean "sign in", not "broken". Any other
 *  ERROR message is already words for the pad. */
export const BridgeFailure = {
  SIGNED_OUT: 'signed-out',
  UNAVAILABLE: 'unavailable',
  /** Live stopped and did not come back by itself — an error screen, or a pause it would
   *  not leave. The worker reloads the window and starts the session over. */
  LIVE_BROKE: 'live-broke'
} as const;
export type BridgeFailure = (typeof BridgeFailure)[keyof typeof BridgeFailure];

/* ---- the channels ------------------------------------------------------------------ */

/** The messages between the worker and its content scripts. */
export const ExtensionMessage = {
  CHECK: 'check',
  TAKE: 'take',
  LIVE: 'live',
  PAD_HELLO: 'padHello',
  FRAME: 'frame',
  LIVE_STATUS: 'liveStatus',
  LIVE_NOTE: 'liveNote',
  GLIC_HELLO: 'glicHello',
  GLIC_CAPTURE: 'glicCapture',
  GLIC_REPORT: 'glicReport',
  GLIC_CALL: 'glicCall',
  GLIC_RETITLE: 'glicRetitle'
} as const;
export type ExtensionMessage = (typeof ExtensionMessage)[keyof typeof ExtensionMessage];

/** Worker ↔ content scripts (the pad's, the Claude tab's, the Gemini relay). */
export interface ExtensionProtocolMap {
  /** pad → worker: open Claude with this board */
  [ExtensionMessage.CHECK](data: CheckPayload): void;
  /** Claude tab → worker: what was I opened for? */
  [ExtensionMessage.TAKE](): PendingCheck | null;
  /** pad → worker: start, re-aim, or end the session */
  [ExtensionMessage.LIVE](data: LiveRequest): void;
  /** pad → worker: "this page just loaded; is a session already running for it?" */
  [ExtensionMessage.PAD_HELLO](): LiveStatus | null;
  /** worker → pad: a picture for Gemini */
  [ExtensionMessage.FRAME](): Frame | null;
  /** worker → pad: how the session is doing */
  [ExtensionMessage.LIVE_STATUS](data: LiveStatus): void;
  /** worker → pad: something Gemini wrote down */
  [ExtensionMessage.LIVE_NOTE](data: LiveNote): void;
  /** relay → worker: "was this tab opened for a session?" */
  [ExtensionMessage.GLIC_HELLO](): GlicHello;
  /** relay → worker: Gemini wants a picture */
  [ExtensionMessage.GLIC_CAPTURE](): Frame | null;
  /** relay → worker: something the bridge reported */
  [ExtensionMessage.GLIC_REPORT](data: BridgeReport): void;
  /** worker → relay: run one of the bridge's calls and answer with its result */
  [ExtensionMessage.GLIC_CALL](data: { name: BridgeCall; arg?: unknown }): unknown;
  /** worker → relay: the exercise changed; name the shared tab after the new one */
  [ExtensionMessage.GLIC_RETITLE](data: Activation): void;
}

export const extensionMessenger = defineExtensionMessaging<ExtensionProtocolMap>();

/** The messages between the Gemini page's two worlds. */
export const BridgeMessage = {
  PRESENT: 'present',
  CAPTURE: 'capture',
  REPORT: 'report',
  ACTIVATE: 'activate',
  CALL: 'call'
} as const;
export type BridgeMessage = (typeof BridgeMessage)[keyof typeof BridgeMessage];

/** Bridge (the Gemini page's world) ↔ relay (the extension's world), in the one document
 *  the two worlds share. */
export interface BridgeProtocolMap {
  /** bridge → relay: installed; is this tab a session's? */
  [BridgeMessage.PRESENT](): Activation | null;
  /** bridge → relay: Gemini wants a picture */
  [BridgeMessage.CAPTURE](): Frame | null;
  /** bridge → relay: for the worker */
  [BridgeMessage.REPORT](data: BridgeReport): void;
  /** relay → bridge: this tab is a session's — the first time; after that, a new name */
  [BridgeMessage.ACTIVATE](data: Activation): void;
  /** relay → bridge: run a call */
  [BridgeMessage.CALL](data: { name: BridgeCall; arg?: unknown }): unknown;
}

export const bridgeMessenger = defineCustomEventMessaging<BridgeProtocolMap>({ namespace: 'avi-math-glic@1' });

/** `p`, or `fallback` once `ms` have passed — a messenger waits for an answer forever,
 *  and every wait here has a deadline (a picture, a call). Rejections become the
 *  fallback too: a party that is not there is the same as one that does not answer. */
export function within<T, F>(ms: number, p: Promise<T>, fallback: F): Promise<T | F> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      }
    );
  });
}
