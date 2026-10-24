/** The one guard for reading the Gemini API's untrusted JSON (generate.ts, messages.ts):
 *  a plain object, its fields still unknown. */
export type Json = Record<string, unknown>;

export function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
