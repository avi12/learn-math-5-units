/** One-shot text from Gemini over REST, for writing a note down.
 *
 *  The Live session is for talking; a text turn inside it made it fall silent. So when
 *  Gemini says it will write something down, the note is written by a separate text model
 *  in a plain request, and the voice carries on untouched. The key goes in a header rather
 *  than the URL, so it stays out of logs and the browser's history of requests. */
import { GENERATE_ENDPOINT, NOTE_MODEL } from './defaults';

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The text of the first candidate, its parts joined; empty when there is none. */
function candidateText(body: unknown) {
  if (!isObject(body) || !Array.isArray(body.candidates)) {
    return '';
  }

  const [first] = body.candidates as unknown[];
  const content = isObject(first) ? first.content : undefined;
  const parts = isObject(content) ? content.parts : undefined;
  if (!Array.isArray(parts)) {
    return '';
  }

  return parts
    .map((part: unknown) => (isObject(part) && typeof part.text === 'string' ? part.text : ''))
    .join('');
}

/** The API's own wording of what went wrong, when the body carries one. */
function errorText(body: unknown) {
  const error = isObject(body) ? body.error : undefined;
  return isObject(error) && typeof error.message === 'string' ? error.message : '';
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function generateText({ apiKey, prompt }: { apiKey: string; prompt: string }): Promise<string> {
  const response = await fetch(`${GENERATE_ENDPOINT}/${NOTE_MODEL}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }]
    })
  });
  const body = await readJson(response);
  if (!response.ok) {
    const detail = errorText(body) || response.statusText;
    throw new Error(`Gemini (${NOTE_MODEL}) answered ${response.status}${detail ? `: ${detail}` : ''}`);
  }

  return candidateText(body);
}
