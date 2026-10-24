/** One-shot text from Gemini over REST, for writing a note down.
 *
 *  The Live session is for talking; a text turn inside it made it fall silent. So when
 *  Gemini says it will write something down, the note is written by a separate text model
 *  in a plain request, and the voice carries on untouched. The key goes in a header rather
 *  than the URL, so it stays out of logs and the browser's history of requests. */
import { GENERATE_ENDPOINT, NOTE_MODEL } from './defaults';
import {
  contentText,
  errorResponseSchema,
  generateRequestSchema,
  generateResponseSchema,
  readAs
} from './schemas';

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function generateText({ apiKey, prompt }: { apiKey: string; prompt: string }): Promise<string> {
  const request = generateRequestSchema.parse({ contents: [{ role: 'user', parts: [{ text: prompt }] }] });
  const response = await fetch(`${GENERATE_ENDPOINT}/${NOTE_MODEL}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    body: JSON.stringify(request)
  });
  const body = await readJson(response);
  if (!response.ok) {
    const detail = readAs({ schema: errorResponseSchema, value: body })?.error.message || response.statusText;
    throw new Error(`Gemini (${NOTE_MODEL}) answered ${response.status}${detail ? `: ${detail}` : ''}`);
  }

  const [first] = readAs({ schema: generateResponseSchema, value: body })?.candidates ?? [];
  return contentText(first?.content);
}
