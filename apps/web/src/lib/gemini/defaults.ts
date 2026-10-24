/** The fixed facts of the public Gemini API that the pad talks to: where, which models,
 *  and the audio formats each side of the Live socket expects. One home, so the mic, the
 *  speaker and the setup message cannot disagree about a sample rate. */
export const LIVE_ENDPOINT =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
export const LIVE_MODEL = 'gemini-3.8-live';
export const LIVE_VOICE = 'Kore';

/** The REST endpoint for one-shot text (generate.ts) — the notes are written by a plain
 *  text model, not inside the Live session, which falls silent after a text turn. */
export const GENERATE_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
export const NOTE_MODEL = 'gemini-3.6-flash';

/** Live hears 16 kHz and speaks 24 kHz, both 16-bit little-endian mono PCM. */
export const MIC_SAMPLE_RATE = 16_000;
export const SPEAKER_SAMPLE_RATE = 24_000;
export const MIC_MIME_TYPE = `audio/pcm;rate=${MIC_SAMPLE_RATE}`;
export const FRAME_MIME_TYPE = 'image/jpeg';

/** The AudioWorklet processor's registered name, shared by the worklet that registers it
 *  and the node that asks for it. */
export const MIC_PROCESSOR_NAME = 'learn-math-mic';
