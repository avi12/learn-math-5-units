/** The Live API's wire format: the JSON the pad sends, and the server's JSON turned into
 *  a flat list of events. session.ts only ever sees `ServerEvent`s, so the shape of the
 *  server's nesting lives here and nowhere else.
 *
 *  The server's messages are untrusted JSON, read with small type guards rather than a
 *  schema library — the pad has no runtime validator, and these few fields do not
 *  justify one. Anything that does not match is skipped, not thrown. */
import { base64ToBytes } from './base64';
import { MIC_MIME_TYPE } from './defaults';

const RESPONSE_MODALITY_AUDIO = 'AUDIO';
const MEDIA_RESOLUTION = 'MEDIA_RESOLUTION_MEDIUM';
const USER_ROLE = 'user';

export interface SetupOptions {
  model: string;
  voice: string;
  systemInstruction: string;
  resumeHandle: string | null;
}

/** The first message on every socket. Both transcriptions are on: the pad reads what the
 *  learner said and what Gemini said as text (the note cue is spotted there). The handle
 *  of the previous socket, when there is one, carries the conversation over a reconnect. */
export function buildSetupMessage({ model, voice, systemInstruction, resumeHandle }: SetupOptions) {
  return {
    setup: {
      model: `models/${model}`,
      generationConfig: {
        responseModalities: [RESPONSE_MODALITY_AUDIO],
        mediaResolution: MEDIA_RESOLUTION,
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: voice
            }
          }
        }
      },
      systemInstruction: {
        parts: [{ text: systemInstruction }]
      },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      contextWindowCompression: {
        slidingWindow: {}
      },
      sessionResumption: resumeHandle ? { handle: resumeHandle } : {}
    }
  };
}

export function audioMessage(base64: string) {
  return {
    realtimeInput: {
      audio: {
        mimeType: MIC_MIME_TYPE,
        data: base64
      }
    }
  };
}

/** Sent when the mic is muted, so the server stops waiting for the end of a sentence. */
export function audioEndMessage() {
  return {
    realtimeInput: {
      audioStreamEnd: true
    }
  };
}

export function videoMessage({ base64, mimeType }: {
  base64: string;
  mimeType: string;
}) {
  return {
    realtimeInput: {
      video: {
        mimeType,
        data: base64
      }
    }
  };
}

/** Text that Gemini should know but not answer: `turnComplete: false` adds it to the
 *  conversation without ending the learner's turn. */
export function contextMessage(text: string) {
  return {
    clientContent: {
      turns: [{
        role: USER_ROLE,
        parts: [{ text }]
      }],
      turnComplete: false
    }
  };
}

export const ServerEventKind = {
  SETUP_COMPLETE: 'setupComplete',
  AUDIO: 'audio',
  INTERRUPTED: 'interrupted',
  USER_TEXT: 'userText',
  MODEL_TEXT: 'modelText',
  TURN_COMPLETE: 'turnComplete',
  RESUME_HANDLE: 'resumeHandle',
  GO_AWAY: 'goAway'
} as const;
export type ServerEventKind = (typeof ServerEventKind)[keyof typeof ServerEventKind];

export type ServerEvent =
  | { kind: typeof ServerEventKind.SETUP_COMPLETE }
  | { kind: typeof ServerEventKind.INTERRUPTED }
  | { kind: typeof ServerEventKind.TURN_COMPLETE }
  | { kind: typeof ServerEventKind.GO_AWAY }
  | {
    kind: typeof ServerEventKind.AUDIO;
    bytes: Uint8Array;
  }
  | {
    kind: typeof ServerEventKind.USER_TEXT | typeof ServerEventKind.MODEL_TEXT;
    text: string;
  }
  | {
    kind: typeof ServerEventKind.RESUME_HANDLE;
    handle: string;
  };

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The field when it is an object, otherwise nothing — absent and malformed alike. */
function objectField({ from, key }: { from: Json; key: string }) {
  const value = from[key];
  return isObject(value) ? value : undefined;
}

function stringField({ from, key }: { from: Json | undefined; key: string }) {
  const value = from?.[key];
  return typeof value === 'string' ? value : undefined;
}

function isTrue({ from, key }: { from: Json; key: string }) {
  return from[key] === true;
}

function audioEvents(content: Json) {
  const parts = objectField({ from: content, key: 'modelTurn' })?.parts;
  if (!Array.isArray(parts)) {
    return [];
  }

  const events: ServerEvent[] = [];
  for (const part of parts) {
    if (!isObject(part)) {
      continue;
    }

    const data = stringField({ from: objectField({ from: part, key: 'inlineData' }), key: 'data' });
    if (data) {
      events.push({
        kind: ServerEventKind.AUDIO,
        bytes: base64ToBytes(data)
      });
    }
  }
  return events;
}

function transcription({ content, key }: { content: Json; key: string }) {
  return stringField({ from: objectField({ from: content, key }), key: 'text' });
}

function contentEvents(content: Json) {
  const events: ServerEvent[] = [];
  if (isTrue({ from: content, key: 'interrupted' })) {
    events.push({ kind: ServerEventKind.INTERRUPTED });
  }

  events.push(...audioEvents(content));

  const heard = transcription({ content, key: 'inputTranscription' });
  if (heard) {
    events.push({
      kind: ServerEventKind.USER_TEXT,
      text: heard
    });
  }

  const said = transcription({ content, key: 'outputTranscription' });
  if (said) {
    events.push({
      kind: ServerEventKind.MODEL_TEXT,
      text: said
    });
  }

  if (isTrue({ from: content, key: 'turnComplete' })) {
    events.push({ kind: ServerEventKind.TURN_COMPLETE });
  }

  return events;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function parseServerMessage(text: string) {
  const message = parseJson(text);
  if (!isObject(message)) {
    return [];
  }

  const events: ServerEvent[] = [];
  if (objectField({ from: message, key: 'setupComplete' })) {
    events.push({ kind: ServerEventKind.SETUP_COMPLETE });
  }

  const content = objectField({ from: message, key: 'serverContent' });
  if (content) {
    events.push(...contentEvents(content));
  }

  /** Only a resumable handle is worth keeping: one issued mid-turn cannot resume. */
  const resumption = objectField({ from: message, key: 'sessionResumptionUpdate' });
  const handle = stringField({ from: resumption, key: 'newHandle' });
  if (resumption && isTrue({ from: resumption, key: 'resumable' }) && handle) {
    events.push({
      kind: ServerEventKind.RESUME_HANDLE,
      handle
    });
  }

  if (objectField({ from: message, key: 'goAway' })) {
    events.push({ kind: ServerEventKind.GO_AWAY });
  }

  return events;
}
