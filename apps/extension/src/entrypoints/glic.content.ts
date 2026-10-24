import {
  BridgeMessage,
  bridgeMessenger,
  BridgeCall,
  BridgeUp,
  within,
  type BridgeReport,
  Direction,
  GlicState,
  BridgeFailure,
  GLIC_URL,
  type TextReply
} from '../utils/protocol';

/** Inside the Gemini page: be the browser host the Gemini client expects.
 *
 * `gemini.google.com/glic` is the real, signed-in Gemini web client that Gemini in Chrome
 * runs in its panel. It runs the whole Live loop by itself — the mic with Chromium's echo
 * cancelling, the Live session, Gemini's own voice — and it asks its HOST for everything
 * else, including the pictures Live looks at: `getContextFromTab(…, {viewportScreenshot:
 * true})`, once for every shared tab it is told is in focus. Chrome is
 * normally that host, over a `chrome://glic` handshake a page cannot forge; so this
 * defines the client's boot hook itself and replays the client's own bootstrap listener
 * with a synthetic event, and from then on it is the host. Every picture it hands over
 * is drawn by the pad (apps/web/src/lib/frame.ts) and fetched through the relay.
 *
 * Ported from gemini-live-windows (src/GeminiLive/Glic/glic_bridge.js), where the same
 * host runs in a hidden WebView2 and has been proven end to end: boot, Live, pixels,
 * text turns in the same conversation. What changed in the port is the channel (DOM
 * events to the relay instead of WebView2 messages) and what was left out: the mic
 * picker, the camera, the Google-apps flow and the caption scrape.
 *
 * It runs on every /glic page, so until the relay says this tab was opened for a session
 * it only installs what is invisible: the listener capture and the transcript tap, both
 * of which pass everything through untouched. Gemini in Chrome's own panel is never this
 * page — it is a guest view no extension reaches.
 *
 * Everything matched on the page — button labels, phrases, flag ids — is Google's and
 * will change one day. Each is named once, below. */

/** Fragments of the client's button aria-labels. */
const Button = {
  CONFIRM_OK: 'OK',
  COPY: 'Copy',
  END: 'End',
  GO_BACK: 'Go back',
  GO_LIVE: 'Go Live',
  GOOD_RESPONSE: 'Good response',
  NO_THANKS: 'No thanks',
  PAUSE_LIVE: 'Pause live mode',
  REGENERATE: 'Regenerate',
  SEND: 'Send',
  SEND_MESSAGE: 'Send message',
  SKIP: 'Skip',
  START_LIVE: 'Start live mode',
  STOP_RESPONSE: 'Stop response',
  SUBMIT: 'Submit',
  TEXT_MODE: 'Switch to text mode',
  TRY_AGAIN: 'Try again',
  TURN_ON_CAPTIONS: 'Turn on live captions'
} as const;

/** Either one shows while Live is paused; clicking it resumes. */
const RESUME_BUTTONS = [Button.START_LIVE, Button.GO_LIVE];
const SUBMIT_BUTTONS = [Button.SUBMIT, Button.SEND_MESSAGE, Button.SEND];
/** The client shows these under an answer only once it has finished. */
const REPLY_DONE = [Button.COPY, Button.GOOD_RESPONSE, Button.REGENERATE];

const Phrase = {
  MIC_CONSENT: 'Live will use your microphone',
  UNAVAILABLE: "isn't available right now",
  WENT_WRONG: 'Something went wrong'
} as const;
const SIGN_IN = /\bSign in\b/;

const Failure = {
  PAGE_DID_NOT_START: 'דף ג׳מיני לא עלה',
  LIVE_DID_NOT_START: 'ג׳מיני לייב לא התחיל (התחברות או מגבלת שימוש)',
} as const;

/** Host API values, from Chromium's glic_api_generated.ts. */
const PanelStateKind = { ATTACHED: 2 } as const;
const Platform = { LINUX: 3 } as const;
const FormFactor = { DESKTOP: 1 } as const;
const HostCapability = { MULTI_INSTANCE: 3, PDF_ZERO_STATE: 7, INVOKE: 8 } as const;

const PANEL_STATE = { kind: PanelStateKind.ATTACHED, windowId: 'pad' };
/** The client sends Live one picture per shared-tab id it is told is in focus, so a fixed
 *  id gave Gemini one look at the board per turn. A new id this often has it pull a fresh
 *  picture each time, as Gemini Live does on a phone (interview-prep, 22.10.2026). */
const SHARE_MS = 1000;
const BOOT_POLL_MS = 100;
const MAX_BOOT_TRIES = 150;
const UNAVAILABLE_POLL_MS = 500;
const START_POLL_MS = 300;
const MAX_START_TRIES = 100;
const MONITOR_POLL_MS = 300;
const FRAME_TIMEOUT_MS = 3000;
/** Gemini pauses Live by itself (idle timeouts, a turn it treats as finished). Only the
 *  person ends a session here, so it is unpaused, backing off if it will not come back. */
const RESUME_GAP_MS = 2000;
const MAX_RESUME_TRIES = 5;
/** Live gone this long — no pause button, no resume button, or an error on the page — is
 *  Live broken. Its own "Try again" gets one chance first; it often brings back a page
 *  that looks live and never answers, which is why the worker then reloads it all. */
const BROKEN_MS = 15_000;
const TRY_AGAIN_GAP_MS = 5000;
const TEXT_READY_MS = 6000;
const REPLY_MS = 30000;
const SETTLE_MS = 1400;

/** Live's four timeouts, rewritten before Live first reads them: 30 s in "listening"
 *  with no speech, the same while sharing, 7 s of a silent mic, a one-hour cap. Someone
 *  writing in silence for ten minutes is exactly this session, so each becomes a day.
 *  Found by their numeric keys, which survive releases while the minified names do not. */
const DAY_S = 24 * 60 * 60;
const LIVE_TIMEOUT_FLAGS: Record<string, number> = {
  '45681081': DAY_S,
  '45681082': DAY_S,
  '45687231': DAY_S * 1000,
  '45677155': DAY_S * 1000
};

/** The Live channel, whose long-poll GETs are the downlink — see gemini-live-windows,
 *  docs/live-transcript-wire.md, for the framing read below. */
const LIVE_CHANNEL_PATH = '/v1/processSession';

/** The page's own text endpoint, for a question asked beside Live (see `ask`). */
const STREAM_GENERATE = '/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate';
/** The three tokens a StreamGenerate request is signed with, by their keys in the page's
 *  `WIZ_global_data` — the build label, the session id, and the anti-forgery token. */
const WizKey = { BL: 'cfb2h', SID: 'FdrFJe', AT: 'SNlM0e' } as const;
const MsgField = { SEQ: 0, SERVER_CONTENT: 1, INPUT_TRANSCRIPTION: 7 } as const;
const ContentField = { GENERATION_COMPLETE: 2, INTERRUPTED: 3, OUTPUT_TRANSCRIPTION: 5 } as const;

type Json = Record<string, unknown>;
type Subscriber = (value: unknown) => void;

export default defineContentScript({
  matches: [`${GLIC_URL}*`],
  runAt: 'document_start',
  world: 'MAIN',

  main() {
    if (window.top !== window) {
      return;
    }

    /* ---- Hebrew reads right to left ------------------------------------------ */

    /* The page's rounds (what was asked, what was answered) are laid out for English. Each
     * block takes the direction of its own first letter — `dir="auto"` in CSS, per
     * paragraph, so a Hebrew line beside a code block or an English line still sits right.
     * An adopted sheet, because at document_start there is no <head> to put a <style> in. */
    const bidi = new CSSStyleSheet();
    bidi.replaceSync(`
      user-query :is(p, li, h1, h2, h3, h4, .query-text-line),
      .presented-response-container :is(p, li, h1, h2, h3, h4, td, th, blockquote),
      message-content :is(p, li, h1, h2, h3, h4, td, th, blockquote) {
        unicode-bidi: plaintext;
        text-align: start;
      }
    `);
    document.adoptedStyleSheets.push(bidi);

    /* The live captions are lines of "You: …" / "Gemini: …" in `captions-scroller`. Their
     * first strong letter is the label's, so `auto` would call every line left to right.
     * The line's direction is therefore read from what comes after the label, and set as
     * the `dir` attribute — the one thing the client's own rendering never rewrites (its
     * text nodes it does, so they are not split). In a right-to-left line the label sits
     * at the right edge, where Hebrew starts. */
    const CAPTION_LABEL = /^\s*(You|Gemini)\s*:\s*/;
    const FIRST_LETTER = /\p{L}/u;
    const HEBREW = /\p{Script=Hebrew}/u;
    const directCaptions = (): void => {
      const lines = new Set<HTMLElement>();
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!CAPTION_LABEL.test(n.nodeValue ?? '') || !n.parentElement?.closest('captions-scroller')) {
          continue;
        }

        // A label in a span of its own: the line is the span's parent.
        const labelAlone = !(n.nodeValue ?? '').replace(CAPTION_LABEL, '').trim();
        const line = labelAlone ? n.parentElement.parentElement : n.parentElement;
        if (line && line.tagName !== 'CAPTIONS-SCROLLER') {
          lines.add(line);
        }
      }

      for (const line of lines) {
        const rest = (line.textContent ?? '').replace(CAPTION_LABEL, '');
        const letter = FIRST_LETTER.exec(rest)?.[0];
        const dir = letter && HEBREW.test(letter) ? 'rtl' : 'ltr';
        if (line.dir !== dir) {
          line.dir = dir;
        }
      }
    };
    document.addEventListener('DOMContentLoaded', () => {
      new MutationObserver(directCaptions).observe(document.body, { childList: true, subtree: true, characterData: true });
    });

    /* ---- the channel to the relay -------------------------------------------- */

    const report = (r: BridgeReport): void => {
      void bridgeMessenger.sendMessage(BridgeMessage.REPORT, r).catch(() => {});
    };

    let active = false;
    let activated = false;
    let booted = false;
    let unavailableReported = false;
    let lastState: GlicState | null = null;
    let focusedTab: Json = {
      tabId: 'pad',
      url: location.origin,
      title: 'לוח מתמטיקה',
      faviconUrl: '',
      documentMimeType: 'text/html',
      isMediaActive: false
    };

    const setState = (s: GlicState): void => {
      if (lastState === s) {
        return;
      }

      lastState = s;
      report({ kind: BridgeUp.STATE, state: s });
    };

    const pageText = (): string => document.body?.innerText ?? '';
    const pageSays = (p: string): boolean => pageText().includes(p);

    const findButton = (...fragments: string[]): HTMLButtonElement | null => {
      const buttons = [...document.querySelectorAll('button')];
      for (const f of fragments) {
        const b = buttons.find((x) => (x.getAttribute('aria-label') ?? '').includes(f));
        if (b) {
          return b;
        }
      }
      return null;
    };

    const clickButton = (...fragments: string[]): boolean => {
      const b = findButton(...fragments);
      b?.click();
      return !!b;
    };

    const isSignedOut = (): boolean =>
      location.hostname === 'accounts.google.com' || (SIGN_IN.test(pageText()) && !findButton(Button.GO_LIVE));

    const reportStartFailure = (fallback: string): void =>
      report({ kind: BridgeUp.ERROR, message: isSignedOut() ? BridgeFailure.SIGNED_OUT : fallback });

    /* ---- pictures, fetched from the pad through the relay ------------------- */

    type WireFrame = { base64: string; mimeType: string; width: number; height: number } | null;
    const decodeFrame = (f: WireFrame) => {
      if (!f?.base64) {
        return null;
      }

      const bytes = Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0));
      return { data: bytes.buffer, mimeType: f.mimeType, widthPixels: f.width, heightPixels: f.height };
    };

    const captureFrame = async (): Promise<ReturnType<typeof decodeFrame>> =>
      active ? decodeFrame(await within(FRAME_TIMEOUT_MS, bridgeMessenger.sendMessage(BridgeMessage.CAPTURE), null)) : null;

    /* ---- the host the client is handed -------------------------------------- */

    const notify = (subscriber: Subscriber, value: unknown): void => {
      try {
        subscriber(value);
      } catch {
        /* a subscriber's error is its own */
      }
    };

    const observable = (value: unknown) => ({
      subscribe(change: Subscriber) {
        notify(change, value);
        return { unsubscribe() {} };
      }
    });

    /** The shared tab, under the id of the latest share (`SHARE_MS`). */
    let shares = 0;
    const currentTab = (): Json => ({ ...focusedTab, tabId: `pad-${shares}` });
    const focusedTabState = () => ({ hasFocus: { tabData: currentTab() } });

    const focusedTabSubscribers = new Set<Subscriber>();
    const focusedTabObservable = () => ({
      subscribe(change: Subscriber) {
        focusedTabSubscribers.add(change);
        notify(change, focusedTabState());
        return { unsubscribe: () => focusedTabSubscribers.delete(change) };
      }
    });

    const announceFocusedTab = (): void => {
      for (const subscriber of focusedTabSubscribers) {
        notify(subscriber, focusedTabState());
      }
    };

    const share = (): void => {
      if (!active) {
        return;
      }

      shares++;
      announceFocusedTab();
    };

    const resolved = (value: unknown) => () => Promise.resolve(value);
    // Captions on: they are what the person sees in the Gemini window.
    const captions = observable(true);

    const host: Json = {
      getChromeVersion: resolved({ major: 130, minor: 0, build: 0, patch: 0 }),
      getPlatform: () => Platform.LINUX,
      getFormFactor: () => FormFactor.DESKTOP,
      getHostCapabilities: () =>
        new Set([HostCapability.MULTI_INSTANCE, HostCapability.PDF_ZERO_STATE, HostCapability.INVOKE]),
      getUserProfileInfo: resolved({
        displayName: 'You',
        email: '',
        givenName: 'You',
        localProfileName: 'You',
        isManaged: false,
        avatarIcon: resolved(undefined)
      }),
      getPanelState: () => observable(PANEL_STATE),
      panelActive: () => observable(true),
      getFocusedTabStateV2: focusedTabObservable,
      getContextFromFocusedTab: () => Promise.resolve({ tabData: currentTab() }),
      captureScreenshot: () => captureFrame(),
      // Live's continuous view: one call per picture, one picture per share.
      async getContextFromTab(_tabId: unknown, options?: { viewportScreenshot?: boolean }) {
        const context: Json = { tabData: currentTab() };
        if (!options?.viewportScreenshot) {
          return context;
        }

        const shot = await captureFrame();
        if (shot) {
          context.viewportScreenshot = shot;
          context.screenshotInfo = { widthPixels: shot.widthPixels, heightPixels: shot.heightPixels };
        }
        return context;
      },
      getTabContextPermissionStateV2: () => observable(true),
      getMicrophonePermissionState: () => observable(true),
      getLocationPermissionState: () => observable(true),
      getTabContextPermissionState: () => observable(true),
      getClosedCaptioningSetting: () => captions,
      getDefaultTabContextPermissionState: () => observable(true),
      canAttachPanel: () => observable(false),
      isBrowserOpen: () => observable(true),
      isManuallyResizing: () => observable(false),
      getOsMicrophonePermissionStatus: resolved(true),
      getOsHotkeyState: () => observable({ hotkey: '' }),
      resizeWindow: resolved(undefined),
      setTabContextPermissionState: resolved(undefined),
      setMicrophonePermissionState: resolved(undefined),
      setLocationPermissionState: resolved(undefined),
      setClosedCaptioningSetting: resolved(undefined),
      attachPanel: resolved(undefined),
      detachPanel: resolved(undefined),
      closePanel() {
        setState(GlicState.IDLE);
        return Promise.resolve();
      }
    };

    /* ---- the bootstrap: capture the client's listener now, replay it later --- */

    const bootstrapHandlers: EventListener[] = [];
    const originalAdd = EventTarget.prototype.addEventListener;
    Object.defineProperty(window, 'addEventListener', {
      configurable: true,
      writable: true,
      value(type: string, listener: EventListenerOrEventListenerObject, options?: AddEventListenerOptions) {
        if (type === 'message' && typeof listener === 'function') {
          bootstrapHandlers.push(listener);
        }
        originalAdd.call(window, type, listener, options);
      }
    });

    const registry = {
      registerWebClient(client: Json & { initialize(h: Json): unknown; notifyPanelWillOpen?(s: unknown): unknown }) {
        return Promise.resolve()
          .then(() => client.initialize(host))
          .then(() => {
            booted = true;
            report({ kind: BridgeUp.BOOTED });
            setTimeout(() => {
              if (client.notifyPanelWillOpen) {
                notify((s) => client.notifyPanelWillOpen?.(s), PANEL_STATE);
              }
            }, 0);
          });
      }
    };

    const bootstrapEvent = (): MessageEvent =>
      new MessageEvent('message', {
        origin: 'chrome://glic',
        source: window,
        data: { type: 'glic-bootstrap', glicApiSource: 'data:text/javascript,//pad' }
      });

    const tryBootstrap = (): void => {
      if (booted || !activated) {
        return;
      }

      for (const handler of bootstrapHandlers) {
        notify(handler as Subscriber, bootstrapEvent());
      }
    };

    /* ---- the transcript, read off the Live wire ----------------------------- */

    let utterances: { direction: Direction; text: string }[] = [];
    let openUser = -1;
    let unfinishedUser = -1;
    let openAssistant = -1;
    let relayed: string[] = [];

    const resetTranscript = (): void => {
      utterances = [];
      openUser = -1;
      unfinishedUser = -1;
      openAssistant = -1;
      relayed = [];
    };

    const relay = (index: number): void => {
      const u = utterances[index];
      if (!u) {
        return;
      }

      const { direction, text } = u;
      const trimmed = text.replace(/\s+/g, ' ').trim();
      if (!active || !trimmed || relayed[index] === trimmed) {
        return;
      }

      relayed[index] = trimmed;
      report({ kind: BridgeUp.TRANSCRIPT, text: trimmed, direction, index });
    };

    const open = (direction: Direction): number => utterances.push({ direction, text: '' }) - 1;

    const firstString = (v: unknown): string | null => {
      if (typeof v === 'string') {
        return v;
      }

      if (!Array.isArray(v)) {
        return null;
      }

      for (const item of v) {
        const found = firstString(item);
        if (found !== null) {
          return found;
        }
      }
      return null;
    };

    /** MSG[7]: the person's whole utterance so far; `[null, [text]]` once final. */
    const onInput = (field: unknown[]): void => {
      const text = firstString(field);
      if (text === null) {
        return;
      }

      const isFinal = field[0] === null;
      const index =
        openUser >= 0 ? openUser : isFinal && unfinishedUser >= 0 ? unfinishedUser : open(Direction.USER);
      const u = utterances[index];
      if (u) {
        u.text = text;
      }
      openUser = isFinal ? -1 : index;
      unfinishedUser = -1;
      relay(index);
    };

    /** MSG[1][5] = [fragment, start, end, first]: a piece of what Gemini is saying. */
    const onOutput = (field: unknown[]): void => {
      const [fragment, , , first] = field;
      if (typeof fragment !== 'string') {
        return;
      }

      if (openAssistant < 0 || first === 1) {
        openAssistant = open(Direction.ASSISTANT);
        unfinishedUser = openUser;
        openUser = -1;
      }
      const u = utterances[openAssistant];
      if (u) {
        u.text += fragment;
      }
      relay(openAssistant);
    };

    const onServerMessage = (msg: unknown): void => {
      if (!Array.isArray(msg) || typeof msg[MsgField.SEQ] !== 'string') {
        return;
      }

      const input = msg[MsgField.INPUT_TRANSCRIPTION];
      if (Array.isArray(input)) {
        onInput(input);
      }

      const content = msg[MsgField.SERVER_CONTENT];
      if (!Array.isArray(content)) {
        return;
      }

      const output = content[ContentField.OUTPUT_TRANSCRIPTION];
      if (Array.isArray(output)) {
        onOutput(output);
      }

      if (content[ContentField.GENERATION_COMPLETE] != null || content[ContentField.INTERRUPTED] != null) {
        if (openAssistant >= 0 && active) {
          report({ kind: BridgeUp.TURN_END, index: openAssistant });
        }
        openAssistant = -1;
      }
    };

    const onChunk = (chunk: string): void => {
      let frames: unknown;
      try {
        frames = JSON.parse(chunk);
      } catch {
        return;
      }

      if (!Array.isArray(frames)) {
        return;
      }

      for (const frame of frames) {
        const payload = Array.isArray(frame) ? frame[1] : null;
        if (!Array.isArray(payload)) {
          continue;
        }

        for (const entry of payload) {
          if (Array.isArray(entry) && entry[0] === null) {
            onServerMessage(entry[1]);
          }
        }
      }
    };

    /** Follows a downlink as it streams: "<length>\n<chunk>" repeated, length in UTF-16
     *  units. Reading responseText takes nothing from the client's own handler. */
    const tap = (xhr: XMLHttpRequest): void => {
      let offset = 0;
      const read = (): void => {
        let text: string;
        try {
          text = xhr.responseText;
        } catch {
          return;
        }

        for (;;) {
          const nl = text.indexOf('\n', offset);
          if (nl < 0) {
            return;
          }

          const length = Number(text.slice(offset, nl));
          const end = nl + 1 + length;
          if (!Number.isInteger(length) || text.length < end) {
            return;
          }

          const chunk = text.slice(nl + 1, end);
          offset = end;
          try {
            onChunk(chunk);
          } catch {
            /* a misread frame costs a line of transcript, never the client's work */
          }
        }
      };
      xhr.addEventListener('progress', read);
      xhr.addEventListener('readystatechange', read);
    };

    try {
      const xhrOpen = XMLHttpRequest.prototype.open;
      const xhrSend = XMLHttpRequest.prototype.send;
      const downlinks = new WeakSet<XMLHttpRequest>();
      XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
        if (String(method).toUpperCase() === 'GET' && String(url).includes(LIVE_CHANNEL_PATH)) {
          downlinks.add(this);
        } else {
          downlinks.delete(this);
        }
        return (xhrOpen as (...a: unknown[]) => void).call(this, method, url, ...rest);
      } as typeof XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, ...args: [Document | XMLHttpRequestBodyInit | null | undefined]) {
        if (downlinks.has(this)) {
          tap(this);
        }
        return xhrSend.apply(this, args);
      };
    } catch {
      /* a frozen XHR: no transcript, and no notes, but Live itself still works */
    }

    /* ---- everything that changes how the page behaves: only when activated --- */

    const patchVisibility = (): void => {
      // A window behind another one must not look hidden, or the client pauses Live.
      try {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
        document.addEventListener('visibilitychange', (e) => e.stopImmediatePropagation(), true);
      } catch {
        /* the page froze these; it keeps its own visibility */
      }
    };

    const patchMic = (): void => {
      // Echo cancelling is the client's own; this adds gain control and voice isolation,
      // so the person can talk over Gemini on desktop speakers. Video is never opened:
      // the pictures come from the pad, and a camera request would only raise a prompt.
      try {
        const media = navigator.mediaDevices;
        const getUserMedia = media.getUserMedia.bind(media);
        media.getUserMedia = async (constraints?: MediaStreamConstraints) => {
          if (!constraints) {
            return getUserMedia(constraints);
          }

          const { video, ...rest } = constraints;
          if (video && !rest.audio) {
            throw new DOMException('the camera is not shared', 'NotAllowedError');
          }

          if (!rest.audio) {
            return getUserMedia(rest);
          }

          const asked = rest.audio === true ? {} : rest.audio;
          return getUserMedia({
            ...rest,
            audio: { ...asked, echoCancellation: true, noiseSuppression: true, autoGainControl: true, voiceIsolation: true } as MediaTrackConstraints
          });
        };
      } catch {
        /* frozen mediaDevices: the client captures with its own settings */
      }
    };

    let timeoutsPatched = false;
    const patchLiveTimeouts = (): boolean => {
      if (timeoutsPatched) {
        return true;
      }

      const ns = (window as unknown as { default_BardChatUi?: Record<string, unknown> }).default_BardChatUi;
      if (!ns) {
        return false;
      }

      let found = 0;
      for (const flag of Object.values(ns)) {
        const f = flag as { key?: string; defaultValue?: unknown; ctor?: () => unknown } | null;
        const value = f && typeof f === 'object' && f.key ? LIVE_TIMEOUT_FLAGS[f.key] : undefined;
        if (value === undefined || !f) {
          continue;
        }

        f.defaultValue = value;
        f.ctor = () => value;
        found++;
      }
      timeoutsPatched = found === Object.keys(LIVE_TIMEOUT_FLAGS).length;
      return timeoutsPatched;
    };

    /* ---- Live: start, keep alive, stop -------------------------------------- */

    let lastResume = 0;
    let resumeTries = 0;
    /** when Live was last seen running, and whether it has been reported broken since */
    let lastLive = 0;
    let lastTryAgain = 0;
    let brokeReported = false;
    let consentAccepted = false;
    let monitorTimer: ReturnType<typeof setInterval> | undefined;
    let shareTimer: ReturnType<typeof setInterval> | undefined;
    let startTimer: ReturnType<typeof setInterval> | undefined;

    const resume = (): void => {
      const now = Date.now();
      if (now - lastResume < RESUME_GAP_MS * (resumeTries + 1)) {
        return;
      }

      if (++resumeTries > MAX_RESUME_TRIES) {
        broke();
        return;
      }

      lastResume = now;
      clickButton(...RESUME_BUTTONS);
    };

    /** Once per breakage: the worker takes it from here (a reload, a new session). */
    const broke = (): void => {
      if (brokeReported) {
        return;
      }

      brokeReported = true;
      report({ kind: BridgeUp.ERROR, message: BridgeFailure.LIVE_BROKE });
    };

    /** The error screen's button carries its words as text, not always as a label. */
    const tryAgainButton = (): HTMLButtonElement | undefined =>
      [...document.querySelectorAll('button')].find((b) =>
        `${b.getAttribute('aria-label') ?? ''} ${b.textContent ?? ''}`.includes(Button.TRY_AGAIN)
      );

    const monitorTick = (): void => {
      if (!active) {
        return;
      }

      const now = Date.now();
      const wrong = pageSays(Phrase.WENT_WRONG);
      if (findButton(Button.PAUSE_LIVE) && !wrong) {
        lastLive = now;
        resumeTries = 0;
        brokeReported = false;
        setState(GlicState.LISTENING);
        return;
      }

      if (!wrong && findButton(...RESUME_BUTTONS)) {
        setState(GlicState.RESUMING);
        resume();
        return;
      }

      // Neither running nor paused: an error, or a screen nothing here knows.
      setState(GlicState.RESUMING);
      const retry = tryAgainButton();
      if (retry && now - lastTryAgain > TRY_AGAIN_GAP_MS) {
        lastTryAgain = now;
        retry.click();
      }

      if (now - lastLive > BROKEN_MS) {
        broke();
      }
    };

    // First-run surfaces: the mic consent, and the volume card. Pressing the pad's Live
    // button is the decision to start, as Win+C is in gemini-live-windows.
    const advanceToLive = (): void => {
      const ok = findButton(Button.CONFIRM_OK);
      if (ok && findButton(Button.NO_THANKS) && pageSays(Phrase.MIC_CONSENT)) {
        ok.click();
        consentAccepted = true;
        return;
      }

      const skip = findButton(Button.SKIP);
      if (skip && findButton(Button.GO_BACK) && findButton(Button.TURN_ON_CAPTIONS)) {
        skip.click();
        return;
      }

      if (clickButton(Button.START_LIVE) || consentAccepted) {
        return;
      }

      clickButton(Button.GO_LIVE);
    };

    const start = (): boolean => {
      active = true;
      resetTranscript();
      lastState = null;
      consentAccepted = false;
      resumeTries = 0;
      clearInterval(startTimer);
      let tries = 0;
      startTimer = setInterval(() => {
        if (!active || unavailableReported) {
          clearInterval(startTimer);
          return;
        }

        tryBootstrap();
        // Live must not start before its timeouts are rewritten, or it reads the defaults.
        if (!patchLiveTimeouts() && tries < MAX_START_TRIES / 2) {
          tries++;
          return;
        }

        if (findButton(Button.PAUSE_LIVE)) {
          clearInterval(startTimer);
          lastLive = Date.now();
          brokeReported = false;
          report({ kind: BridgeUp.READY });
          setState(GlicState.LISTENING);
          monitorTimer ??= setInterval(monitorTick, MONITOR_POLL_MS);
          shareTimer ??= setInterval(share, SHARE_MS);
          return;
        }

        advanceToLive();
        if (++tries <= MAX_START_TRIES) {
          return;
        }

        clearInterval(startTimer);
        reportStartFailure(Failure.LIVE_DID_NOT_START);
      }, START_POLL_MS);
      return true;
    };

    const stop = (): boolean => {
      active = false;
      clearInterval(startTimer);
      clickButton(Button.TEXT_MODE, Button.PAUSE_LIVE, Button.END);
      setState(GlicState.IDLE);
      return true;
    };

    /* ---- text turns in the same conversation -------------------------------- */

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    const waitFor = async <T>(predicate: () => T | null | undefined, ms: number): Promise<T | null> => {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        const v = predicate();
        if (v) {
          return v;
        }
        await sleep(150);
      }
      return null;
    };

    const editor = (): HTMLElement | null => document.querySelector<HTMLElement>('[contenteditable="true"]');

    /** The newest answer's container — the whole of it, cards included. */
    const lastReply = (): HTMLElement | null => {
      const all = document.querySelectorAll<HTMLElement>('.presented-response-container');
      const last = all[all.length - 1];
      if (last) {
        return last;
      }

      const nodes = document.querySelectorAll<HTMLElement>(
        'message-content, .model-response-text, .markdown, [data-response-index]'
      );
      return nodes[nodes.length - 1] ?? null;
    };

    const replyOf = (): TextReply => {
      const el = lastReply();
      const text = (el?.innerText ?? '').replace(/\s+/g, ' ').replace(/^Gemini said\s*/i, '').trim();
      const blocks = el ? [...el.querySelectorAll('pre code, code-block code, pre')] : [];
      const code = (blocks.at(-1)?.textContent ?? '').trim();
      return { text, code };
    };

    /** Out of Live, into an empty, focused text box. The worker types into it next, with
     *  trusted key events — the client's Submit stays disabled for anything else. */
    const beginText = async (): Promise<boolean> => {
      active = false;
      clearInterval(startTimer);
      clearInterval(monitorTimer);
      monitorTimer = undefined;
      clearInterval(shareTimer);
      shareTimer = undefined;
      clickButton(Button.TEXT_MODE);
      const box = await waitFor(editor, TEXT_READY_MS);
      if (!box) {
        return false;
      }

      box.focus();
      document.execCommand('selectAll');
      document.execCommand('delete');
      return true;
    };

    /** Send what was typed and wait for the answer to stop growing. */
    const submitAndRead = async (): Promise<TextReply> => {
      const before = lastReply();
      clickButton(...SUBMIT_BUTTONS);
      let seen = '';
      let stableSince = 0;
      const deadline = Date.now() + REPLY_MS;
      while (Date.now() < deadline) {
        const el = lastReply();
        const now = el && el !== before ? (el.innerText ?? '') : '';
        if (now && now === seen && findButton(...REPLY_DONE)) {
          stableSince ||= Date.now();
          if (Date.now() - stableSince > SETTLE_MS) {
            break;
          }
        } else {
          stableSince = 0;
          seen = now;
        }
        await sleep(200);
      }
      // Out of time with the answer still running: stop it, or Live cannot come back.
      if (clickButton(Button.STOP_RESPONSE)) {
        await sleep(SETTLE_MS);
      }
      return replyOf();
    };

    /* ---- a question beside Live, in a conversation of its own ---------------
       The page's own signed-in text endpoint, asked directly — the request Gemini's web
       app makes for a first turn, which agentic-gaming-assistant sends in parallel to a
       Live call (src-tauri/src/voice/gemini.rs, `fetch_web_text`). From this page it is
       same-origin, so the cookies and the Origin are the page's own; the three tokens
       are in the page's bootstrap object, or in /app's when this build lacks them.
       It never touches the Live conversation: pausing Live for a text turn left it
       listening and silent on the real page (Avi, 14.10.2026). */

    /** One string value out of a page's `WIZ_global_data`, decoded as the JSON it is. */
    const wizValue = (html: string, key: string): string => {
      const m = new RegExp(`"${key}":"((?:\\\\.|[^"\\\\])*)"`).exec(html);
      if (!m) {
        return '';
      }

      try {
        return JSON.parse(`"${m[1]}"`) as string;
      } catch {
        return '';
      }
    };

    const tokens = async (): Promise<{ bl: string; sid: string; at: string }> => {
      const wiz = (window as unknown as { WIZ_global_data?: Record<string, unknown> }).WIZ_global_data ?? {};
      const own = { bl: String(wiz[WizKey.BL] ?? ''), sid: String(wiz[WizKey.SID] ?? ''), at: String(wiz[WizKey.AT] ?? '') };
      if (own.at && own.bl) {
        return own;
      }

      const html = await (await fetch('/app', { credentials: 'include' })).text();
      return { bl: wizValue(html, WizKey.BL), sid: wizValue(html, WizKey.SID), at: wizValue(html, WizKey.AT) };
    };

    /** The answer's text from a StreamGenerate body: `)]}'`, then byte counts and JSON
     *  lines; each `wrb.fr` row wraps the response as a JSON string, and the model's text
     *  is cumulative at [4][0][1][0], so the last one seen is the whole answer. */
    const answerOf = (body: string): string => {
      let text = '';
      for (const line of body.split('\n')) {
        let frame: unknown;
        try {
          frame = JSON.parse(line);
        } catch {
          continue;
        }

        if (!Array.isArray(frame)) {
          continue;
        }

        for (const row of frame) {
          if (!Array.isArray(row) || typeof row[2] !== 'string') {
            continue;
          }

          try {
            const t = (JSON.parse(row[2]) as unknown[][][][])?.[4]?.[0]?.[1]?.[0];
            if (typeof t === 'string') {
              text = t;
            }
          } catch {
            /* a row that is not a response */
          }
        }
      }
      return text;
    };

    const ask = async (prompt: unknown): Promise<string> => {
      if (typeof prompt !== 'string' || !prompt) {
        return '';
      }

      const { bl, sid, at } = await tokens();
      if (!at) {
        return '';
      }

      const query = new URLSearchParams({
        bl,
        'f.sid': sid,
        hl: 'en',
        _reqid: String(100_000 + (Date.now() % 900_000)),
        rt: 'c'
      });
      const fReq = JSON.stringify([null, JSON.stringify([[prompt, 0, null, null, null, null, 0]])]);
      const res = await fetch(`${STREAM_GENERATE}?${query}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'X-Same-Domain': '1' },
        body: new URLSearchParams({ 'f.req': fReq, at })
      });
      return res.ok ? answerOf(await res.text()) : '';
    };

    const calls: Record<BridgeCall, (arg?: unknown) => unknown> = {
      [BridgeCall.START]: start,
      [BridgeCall.STOP]: stop,
      [BridgeCall.BEGIN_TEXT]: beginText,
      [BridgeCall.SUBMIT]: submitAndRead,
      [BridgeCall.ASK]: ask
    };

    /* ---- the relay's side ---------------------------------------------------- */

    /** The first activation takes the page over; a later one only renames the shared tab
     *  (a new exercise), and the client hears the new name at once. */
    const activate = (title: string, url: string): void => {
      focusedTab = { ...focusedTab, title, url };
      announceFocusedTab();
      if (activated) {
        return;
      }

      activated = true;
      patchVisibility();
      patchMic();
      (window as unknown as { internalAutoGlicBoot?: () => unknown }).internalAutoGlicBoot = () => registry;

      let tries = 0;
      const bootTimer = setInterval(() => {
        tryBootstrap();
        if (!booted && ++tries <= MAX_BOOT_TRIES) {
          return;
        }

        clearInterval(bootTimer);
        if (!booted) {
          reportStartFailure(Failure.PAGE_DID_NOT_START);
        }
      }, BOOT_POLL_MS);

      // A stale Google session still loads the client and even adopts the host, then says
      // "Gemini isn't available right now". That is a sign-in to ask for, not a bug.
      const unavailable = setInterval(() => {
        if (!pageSays(Phrase.UNAVAILABLE)) {
          return;
        }

        clearInterval(unavailable);
        unavailableReported = true;
        report({ kind: BridgeUp.ERROR, message: BridgeFailure.UNAVAILABLE });
      }, UNAVAILABLE_POLL_MS);
    };

    bridgeMessenger.onMessage(BridgeMessage.ACTIVATE, ({ data }) => activate(data.title, data.url || location.origin));
    bridgeMessenger.onMessage(BridgeMessage.CALL, async ({ data }) => {
      const run = calls[data.name];
      return run ? await Promise.resolve(run(data.arg)).catch(() => null) : null;
    });

    // the relay may have come up first, and know already whether this tab is a session's
    void bridgeMessenger
      .sendMessage(BridgeMessage.PRESENT)
      .then((a) => a && activate(a.title, a.url || location.origin))
      .catch(() => {});
  }
});
