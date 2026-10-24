/** Everything that changes how the Gemini page behaves. The bridge applies these only once
 *  the tab is a session's: an ordinary visit to /glic is left exactly as it was. */

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

export const patchVisibility = (): void => {
  // A window behind another one must not look hidden, or the client pauses Live.
  try {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.addEventListener('visibilitychange', (e) => e.stopImmediatePropagation(), true);
  } catch {
    /* the page froze these; it keeps its own visibility */
  }
};

export const patchMic = (): void => {
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

/** Rewrites Live's timeouts once the page has defined them. Asked again until it says
 *  yes; after that it is done for good. */
export function createTimeoutPatch(): () => boolean {
  let patched = false;
  return () => {
    if (patched) {
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
    patched = found === Object.keys(LIVE_TIMEOUT_FLAGS).length;
    return patched;
  };
}
