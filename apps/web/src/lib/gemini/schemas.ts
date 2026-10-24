/** The Gemini API's wire, as zod schemas: what the pad sends, and what it accepts back.
 *
 *  Both endpoints speak the same `Content` — a role and its parts — so it is built once
 *  here and reused: the setup's system instruction, a generateContent request and its
 *  candidates, and a Live turn of the model's are all one schema. A part's media is one
 *  `Blob` (a MIME type and base64 data), the same for the mic, the board's frames and
 *  the audio that comes back. Every type here is the schema's own (`z.infer`), so a
 *  message cannot drift from what is checked.
 *
 *  Outgoing messages are typed by these schemas; only the rare ones (a setup, a note's
 *  request) are parsed at run time too — the mic sends fifty chunks a second, and parsing
 *  what this file's own builders just made would buy nothing there. Incoming JSON is
 *  untrusted and always parsed; unknown fields are dropped, not refused. */
import { z } from '../zod';

/* ---- shared pieces ---------------------------------------------------------- */

/** `value` as `schema` reads it, or null when it is not one: the server's JSON is skipped
 *  when malformed, never thrown on. */
export function readAs<T>({ schema, value }: { schema: z.ZodType<T>; value: unknown }): T | null {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** JSON text as a value, or null when it is not JSON. */
export function jsonOf(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const blobSchema = z.object({
  mimeType: z.string(),
  data: z.string()
});

const partSchema = z.object({
  text: z.string().optional(),
  inlineData: blobSchema.optional()
});

const contentSchema = z.object({
  role: z.string().optional(),
  parts: z.array(partSchema).default([])
});
export type Content = z.infer<typeof contentSchema>;

/** The text of a content's parts, joined; empty when it has none. */
export function contentText(content: Content | undefined): string {
  return content?.parts.map((p) => p.text ?? '').join('') ?? '';
}

/* ---- Live: what the pad sends ----------------------------------------------- */

export const setupMessageSchema = z.object({
  setup: z.object({
    model: z.string(),
    generationConfig: z.object({
      responseModalities: z.array(z.literal('AUDIO')),
      mediaResolution: z.string(),
      speechConfig: z.object({
        voiceConfig: z.object({ prebuiltVoiceConfig: z.object({ voiceName: z.string() }) })
      })
    }),
    systemInstruction: contentSchema,
    inputAudioTranscription: z.object({}),
    outputAudioTranscription: z.object({}),
    contextWindowCompression: z.object({ slidingWindow: z.object({}) }),
    sessionResumption: z.object({ handle: z.string().optional() })
  })
});
export type SetupMessage = z.infer<typeof setupMessageSchema>;

export const realtimeInputSchema = z.object({
  realtimeInput: z.union([z.object({ audio: blobSchema }), z.object({ video: blobSchema })])
});
export type RealtimeInput = z.infer<typeof realtimeInputSchema>;

/* ---- Live: what the server sends -------------------------------------------- */

const transcriptionSchema = z.object({ text: z.string().optional() });

export const serverMessageSchema = z.object({
  setupComplete: z.object({}).optional(),
  serverContent: z
    .object({
      modelTurn: contentSchema.optional(),
      interrupted: z.boolean().optional(),
      turnComplete: z.boolean().optional(),
      inputTranscription: transcriptionSchema.optional(),
      outputTranscription: transcriptionSchema.optional()
    })
    .optional(),
  sessionResumptionUpdate: z
    .object({
      newHandle: z.string().optional(),
      resumable: z.boolean().optional()
    })
    .optional(),
  goAway: z.object({}).optional()
});
export type ServerContent = NonNullable<z.infer<typeof serverMessageSchema>['serverContent']>;

/* ---- generateContent -------------------------------------------------------- */

export const generateRequestSchema = z.object({
  contents: z.array(contentSchema).min(1)
});
export type GenerateRequest = z.infer<typeof generateRequestSchema>;

export const generateResponseSchema = z.object({
  candidates: z.array(z.object({ content: contentSchema.optional() })).default([])
});

export const errorResponseSchema = z.object({
  error: z.object({ message: z.string() })
});
