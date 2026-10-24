/** The Live API's wire format: the JSON the pad sends, and the server's JSON turned into
 *  a flat list of events. session.ts only ever sees `ServerEvent`s, so the shape of the
 *  server's nesting lives here and nowhere else.
 *
 *  The shapes themselves are zod schemas (schemas.ts): the builders here return their
 *  types, the setup is parsed before it goes out, and every server message is parsed on
 *  the way in — one that does not match is skipped, not thrown. */
import { base64ToBytes } from './base64';
import { MIC_MIME_TYPE } from './defaults';
import {
  jsonOf,
  readAs,
  type RealtimeInput,
  serverMessageSchema,
  type ServerContent,
  type SetupMessage,
  setupMessageSchema
} from './schemas';

const RESPONSE_MODALITY_AUDIO = 'AUDIO';
const MEDIA_RESOLUTION = 'MEDIA_RESOLUTION_MEDIUM';

export interface SetupOptions {
  model: string;
  voice: string;
  systemInstruction: string;
  resumeHandle: string | null;
}

/** The first message on every socket. Both transcriptions are on: the pad reads what the
 *  learner said and what Gemini said as text (the note cue is spotted there). The handle
 *  of the previous socket, when there is one, carries the conversation over a reconnect. */
export function buildSetupMessage({ model, voice, systemInstruction, resumeHandle }: SetupOptions): SetupMessage {
  return setupMessageSchema.parse({
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
  });
}

export function audioMessage(base64: string): RealtimeInput {
  return {
    realtimeInput: {
      audio: {
        mimeType: MIC_MIME_TYPE,
        data: base64
      }
    }
  };
}

export function videoMessage({ base64, mimeType }: {
  base64: string;
  mimeType: string;
}): RealtimeInput {
  return {
    realtimeInput: {
      video: {
        mimeType,
        data: base64
      }
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

function audioEvents(content: ServerContent): ServerEvent[] {
  return (content.modelTurn?.parts ?? []).flatMap((part) =>
    part.inlineData?.data ? [{ kind: ServerEventKind.AUDIO, bytes: base64ToBytes(part.inlineData.data) }] : []
  );
}

function contentEvents(content: ServerContent) {
  const events: ServerEvent[] = [];
  if (content.interrupted) {
    events.push({ kind: ServerEventKind.INTERRUPTED });
  }

  events.push(...audioEvents(content));

  const heard = content.inputTranscription?.text;
  if (heard) {
    events.push({
      kind: ServerEventKind.USER_TEXT,
      text: heard
    });
  }

  const said = content.outputTranscription?.text;
  if (said) {
    events.push({
      kind: ServerEventKind.MODEL_TEXT,
      text: said
    });
  }

  if (content.turnComplete) {
    events.push({ kind: ServerEventKind.TURN_COMPLETE });
  }

  return events;
}

export function parseServerMessage(text: string) {
  const message = readAs({ schema: serverMessageSchema, value: jsonOf(text) });
  if (!message) {
    return [];
  }

  const events: ServerEvent[] = [];
  if (message.setupComplete) {
    events.push({ kind: ServerEventKind.SETUP_COMPLETE });
  }

  if (message.serverContent) {
    events.push(...contentEvents(message.serverContent));
  }

  /** Only a resumable handle is worth keeping: one issued mid-turn cannot resume. */
  const resumption = message.sessionResumptionUpdate;
  if (resumption?.resumable && resumption.newHandle) {
    events.push({
      kind: ServerEventKind.RESUME_HANDLE,
      handle: resumption.newHandle
    });
  }

  if (message.goAway) {
    events.push({ kind: ServerEventKind.GO_AWAY });
  }

  return events;
}
