import { quietly, within } from '../utils/async';
import { ask } from '../utils/glic/ask';
import { installBidi } from '../utils/glic/bidi';
import { captureBootstrap, createHost, toHostFrame } from '../utils/glic/host';
import {
  Button,
  clickButton,
  findButton,
  isSignedOut,
  pageSays,
  Phrase,
  RESUME_BUTTONS,
  tryAgainButton
} from '../utils/glic/page';
import { createTimeoutPatch, patchMic, patchVisibility } from '../utils/glic/patches';
import { emptyTextBox, submitAndRead } from '../utils/glic/text';
import { createTranscript, tapLiveChannel } from '../utils/glic/transcript';
import {
  type Activation,
  BridgeCall,
  BridgeFailure,
  BridgeMessage,
  bridgeMessenger,
  BridgeReport,
  GLIC_URL,
  GlicState
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
 * This file is the session's control: when Live starts, is kept alive and stops. What it
 * drives lives under utils/glic/ — the host (host.ts), the page's buttons and words
 * (page.ts), the transcript tap (transcript.ts), text turns (text.ts), the question beside
 * Live (ask.ts), the patches an activated page gets (patches.ts) and right-to-left
 * Hebrew (bidi.ts). */

const Failure = {
  PAGE_DID_NOT_START: 'דף ג׳מיני לא עלה',
  LIVE_DID_NOT_START: 'ג׳מיני לייב לא התחיל (התחברות או מגבלת שימוש)',
} as const;

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

export default defineContentScript({
  matches: [`${GLIC_URL}*`],
  runAt: 'document_start',
  world: 'MAIN',

  main() {
    if (window.top !== window) {
      return;
    }

    installBidi();

    /* ---- the channel to the relay -------------------------------------------- */

    /** Up to the relay, and on to the worker. Nothing waits on a report. */
    const report = (sent: Promise<void>): void => void quietly(sent);

    let active = false;
    let activated = false;
    let booted = false;
    let unavailableReported = false;
    let lastState: GlicState | null = null;

    const setState = (s: GlicState): void => {
      if (lastState === s) {
        return;
      }

      lastState = s;
      report(bridgeMessenger.sendMessage(BridgeReport.STATE, s));
    };

    const reportStartFailure = (fallback: string): void =>
      report(bridgeMessenger.sendMessage(BridgeReport.ERROR, isSignedOut() ? BridgeFailure.SIGNED_OUT : fallback));

    /* ---- the host, and the handover ------------------------------------------ */

    // Pictures, fetched from the pad through the relay.
    const captureFrame = async () => {
      if (!active) {
        return null;
      }

      const frame = await within({
        ms: FRAME_TIMEOUT_MS,
        promise: bridgeMessenger.sendMessage(BridgeMessage.CAPTURE),
        fallback: null
      });
      return toHostFrame(frame);
    };

    const { host, retitle, share: shareAnew } = createHost({
      capture: captureFrame,
      closed: () => setState(GlicState.IDLE)
    });
    const share = (): void => {
      if (!active) {
        return;
      }

      shareAnew();
    };

    const bootstrap = captureBootstrap({
      host,
      booted: () => {
        booted = true;
        report(bridgeMessenger.sendMessage(BridgeReport.BOOTED));
      }
    });

    const tryBootstrap = (): void => {
      if (booted || !activated) {
        return;
      }

      bootstrap.replay();
    };

    /* ---- the transcript, read off the Live wire ------------------------------- */

    const transcript = createTranscript({
      active: () => active,
      line: (line) => report(bridgeMessenger.sendMessage(BridgeReport.TRANSCRIPT, line)),
      turnEnded: (index) => report(bridgeMessenger.sendMessage(BridgeReport.TURN_END, index))
    });
    tapLiveChannel(transcript.chunk);

    const patchLiveTimeouts = createTimeoutPatch();

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
      report(bridgeMessenger.sendMessage(BridgeReport.ERROR, BridgeFailure.LIVE_BROKE));
    };

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
      transcript.reset();
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
          report(bridgeMessenger.sendMessage(BridgeReport.READY));
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

    /** Out of Live, into an empty, focused text box. The worker types into it next, with
     *  trusted key events — the client's Submit stays disabled for anything else. */
    const beginText = (): Promise<boolean> => {
      active = false;
      clearInterval(startTimer);
      clearInterval(monitorTimer);
      monitorTimer = undefined;
      clearInterval(shareTimer);
      shareTimer = undefined;
      return emptyTextBox();
    };

    /* ---- the relay's side ---------------------------------------------------- */

    /** The first activation takes the page over; a later one only renames the shared tab
     *  (a new exercise), and the client hears the new name at once. */
    const activate = ({ title, url }: Activation): void => {
      retitle({ title, url: url || location.origin });
      if (activated) {
        return;
      }

      activated = true;
      patchVisibility();
      patchMic();
      bootstrap.hook();

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
        report(bridgeMessenger.sendMessage(BridgeReport.ERROR, BridgeFailure.UNAVAILABLE));
      }, UNAVAILABLE_POLL_MS);
    };

    bridgeMessenger.onMessage(BridgeMessage.ACTIVATE, ({ data }) => activate(data));

    // The worker's calls. One that throws answers null, as one that never answers does.
    const answer = <T>(run: () => T | Promise<T>): Promise<T | null> => Promise.resolve().then(run).catch(() => null);
    bridgeMessenger.onMessage(BridgeCall.START, () => answer(start));
    bridgeMessenger.onMessage(BridgeCall.STOP, () => answer(stop));
    bridgeMessenger.onMessage(BridgeCall.BEGIN_TEXT, () => answer(beginText));
    bridgeMessenger.onMessage(BridgeCall.SUBMIT, () => answer(submitAndRead));
    bridgeMessenger.onMessage(BridgeCall.ASK, ({ data }) => answer(() => ask(data)));

    // the relay may have come up first, and know already whether this tab is a session's
    void quietly(
      bridgeMessenger.sendMessage(BridgeMessage.PRESENT).then((a) => a && activate(a))
    );
  }
});
