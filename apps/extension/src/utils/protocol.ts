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
  LiveStart,
  LiveStatus,
  LiveTarget
} from '@learn-math/shared/protocol';
import { defineExtensionMessaging } from '@webext-core/messaging';
import { defineCustomEventMessaging } from '@webext-core/messaging/page';

/** A check, as the background parks it: stamped, so the Claude tab can refuse a stale one. */
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

/* The bridge's own messages travel two hops, bridge ↔ relay ↔ worker, under the same
 * name on both: the relay only carries them. So they are named and typed once, here, and
 * both channels' protocol maps take them in. */

/** What the bridge reports, as it happens. */
export const BridgeReport = {
  /** Gemini adopted our host */
  BOOTED: 'bridgeBooted',
  /** Live is on: Gemini is listening */
  READY: 'bridgeReady',
  STATE: 'bridgeState',
  ERROR: 'bridgeError',
  /** a line of what was said */
  TRANSCRIPT: 'bridgeTranscript',
  /** Gemini finished (or was cut off in) what it was saying */
  TURN_END: 'bridgeTurnEnd'
} as const;
export type BridgeReport = (typeof BridgeReport)[keyof typeof BridgeReport];

/** One line of what was said, as the Live wire carries it. `index` is the utterance's
 *  place in the conversation; a line grows, and is sent again, under the same index. */
export interface TranscriptLine {
  direction: Direction;
  text: string;
  index: number;
}

export interface BridgeReportProtocolMap {
  [BridgeReport.BOOTED](): void;
  [BridgeReport.READY](): void;
  [BridgeReport.STATE](state: GlicState): void;
  /** a `BridgeFailure`, or words for the pad */
  [BridgeReport.ERROR](message: string): void;
  [BridgeReport.TRANSCRIPT](line: TranscriptLine): void;
  /** the index of the utterance that ended */
  [BridgeReport.TURN_END](index: number): void;
}

/** What the worker asks the bridge to do. Each answers null when the page did not, in
 *  time (the relay's deadline) or at all. */
export const BridgeCall = {
  /** go Live (or resume it) */
  START: 'bridgeStart',
  STOP: 'bridgeStop',
  /** leave Live for the text box, emptied and focused, ready to be typed into */
  BEGIN_TEXT: 'bridgeBeginText',
  /** send what was typed, wait for the answer, return it */
  SUBMIT: 'bridgeSubmit',
  /** ask Gemini in a conversation of its own, beside Live, and return the answer's text —
   *  the page's own signed-in text endpoint, so Live is never paused for it */
  ASK: 'bridgeAsk'
} as const;
export type BridgeCall = (typeof BridgeCall)[keyof typeof BridgeCall];

export interface BridgeCallProtocolMap {
  [BridgeCall.START](): boolean | null;
  [BridgeCall.STOP](): boolean | null;
  /** whether the text box was found */
  [BridgeCall.BEGIN_TEXT](): boolean | null;
  [BridgeCall.SUBMIT](): TextReply | null;
  [BridgeCall.ASK](prompt: string): string | null;
}

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

/** The failures the bridge reports in `BridgeReport.ERROR` that mean "sign in" or
 *  "broken". Any other ERROR message is already words for the pad. */
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
  LIVE_START: 'liveStart',
  LIVE_RETARGET: 'liveRetarget',
  LIVE_STOP: 'liveStop',
  PAD_HELLO: 'padHello',
  FRAME: 'frame',
  LIVE_STATUS: 'liveStatus',
  LIVE_NOTE: 'liveNote',
  GLIC_HELLO: 'glicHello',
  GLIC_CAPTURE: 'glicCapture',
  GLIC_RETITLE: 'glicRetitle'
} as const;
export type ExtensionMessage = (typeof ExtensionMessage)[keyof typeof ExtensionMessage];

/** Worker ↔ content scripts (the pad's, the Claude tab's, the Gemini relay) — and the
 *  bridge's reports and calls, which the relay carries on to the worker and back. */
export interface ExtensionProtocolMap extends BridgeReportProtocolMap, BridgeCallProtocolMap {
  /** pad → worker: open Claude with this board */
  [ExtensionMessage.CHECK](data: CheckPayload): void;
  /** Claude tab → worker: what was I opened for? */
  [ExtensionMessage.TAKE](): PendingCheck | null;
  /** pad → worker: open a session, or bring the open one to the front */
  [ExtensionMessage.LIVE_START](data: LiveStart): void;
  /** pad → worker: the exercise changed under the running session */
  [ExtensionMessage.LIVE_RETARGET](data: LiveTarget): void;
  /** pad → worker: end the session */
  [ExtensionMessage.LIVE_STOP](): void;
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
  /** worker → relay: the exercise changed; name the shared tab after the new one */
  [ExtensionMessage.GLIC_RETITLE](data: Activation): void;
}

/* Both messengers are marked pure, so a script that never talks on one is built without
 * it: the Claude tab's has no bridge, and the bridge's — in the page's world, with no
 * `chrome.runtime` — no extension channel. */
export const extensionMessenger = /* @__PURE__ */ defineExtensionMessaging<ExtensionProtocolMap>();

/** The messages between the Gemini page's two worlds. */
export const BridgeMessage = {
  PRESENT: 'present',
  CAPTURE: 'capture',
  ACTIVATE: 'activate'
} as const;
export type BridgeMessage = (typeof BridgeMessage)[keyof typeof BridgeMessage];

/** Bridge (the Gemini page's world) ↔ relay (the extension's world), in the one document
 *  the two worlds share: the bridge's reports go up it, its calls come down. */
export interface BridgeProtocolMap extends BridgeReportProtocolMap, BridgeCallProtocolMap {
  /** bridge → relay: installed; is this tab a session's? */
  [BridgeMessage.PRESENT](): Activation | null;
  /** bridge → relay: Gemini wants a picture */
  [BridgeMessage.CAPTURE](): Frame | null;
  /** relay → bridge: this tab is a session's — the first time; after that, a new name */
  [BridgeMessage.ACTIVATE](data: Activation): void;
}

export const bridgeMessenger = /* @__PURE__ */ defineCustomEventMessaging<BridgeProtocolMap>({ namespace: 'avi-math-glic@1' });
