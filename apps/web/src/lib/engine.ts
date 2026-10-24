/** Which engine runs the Gemini Live tutor, and everything the page says about each — one
 *  home, so the choice, its warning and the key field cannot word the same thing twice.
 *
 *   - SUBSCRIPTION: the pad's Chrome extension drives the Gemini web client in a window of
 *     its own (apps/extension/src/utils/live.ts), on the person's Gemini subscription.
 *   - API_KEY: this page opens the official Gemini Live API itself, on the person's own
 *     key (lib/tutor-session.ts). No extension needed — the page already draws the frames.
 *
 *  The same pair as interview-prep's apps/gemini-live/src/lib/engine.ts.
 *
 *  Nothing here imports the API-key code: this file is in the main chunk, and the Live
 *  socket, the mic and the speaker load only when an API-key session starts. */
import type { LiveStart, LiveTarget } from '@learn-math/shared/protocol';
import { extensionPresent } from './check';
import { StorageKey, forgetPreference, readPreference, writePreference } from './preferences';

export const Engine = {
  SUBSCRIPTION: 'subscription',
  API_KEY: 'apiKey'
} as const;
export type Engine = (typeof Engine)[keyof typeof Engine];

/** What the page asks of whichever engine runs the session (live.svelte.ts holds one per
 *  engine). Fire and forget: what happens comes back as a status. */
export interface LiveRunner {
  start(start: LiveStart): void;
  retarget(target: LiveTarget): void;
  stop(): void;
}

export const ENGINE_LABEL: Record<Engine, string> = {
  [Engine.SUBSCRIPTION]: 'המנוי שלך לג׳מיני',
  [Engine.API_KEY]: 'מפתח API משלך'
};

/** The warning under the subscription option, in two parts so the page can weigh the
 *  consequence on its own. */
export const SUBSCRIPTION_RISK =
  'התוסף רוכב על המנוי שלך לג׳מיני דרך אפליקציית הרשת של גוגל עצמה, וגוגל לא מציעה אותה לשימוש כזה.';
export const SUBSCRIPTION_CONSEQUENCE = 'גוגל עלולה להשעות או לחסום חשבון שמשתמש בזה.';

export const ENGINE_DETAIL: Record<Engine, string> = {
  [Engine.SUBSCRIPTION]: `${SUBSCRIPTION_RISK} ${SUBSCRIPTION_CONSEQUENCE}`,
  [Engine.API_KEY]: 'ה־API הרשמי והציבורי של Gemini Live, בחיוב על המפתח שלך. גם השכבה החינמית עובדת, במגבלות נמוכות יותר.'
};

/** Where a key is made. */
export const API_KEY_CREATE_URL = 'https://aistudio.google.com/apikey';

/** What the subscription needs and this device may lack. */
export const NEEDS_EXTENSION = 'דרך המנוי צריך את התוסף של הלוח בכרום, והוא לא מותקן כאן';

const ENGINES: ReadonlySet<string> = new Set(Object.values(Engine));

function isEngine(value: string | null): value is Engine {
  return value !== null && ENGINES.has(value);
}

/** The engine this device runs. The one it chose, while it can run it; otherwise the
 *  subscription when the extension is there to ride it, and the key when it is not. */
export function readEngine(): Engine {
  const stored = readPreference(StorageKey.ENGINE);
  const hasExtension = extensionPresent();
  if (isEngine(stored) && (stored !== Engine.SUBSCRIPTION || hasExtension)) {
    return stored;
  }

  return hasExtension ? Engine.SUBSCRIPTION : Engine.API_KEY;
}

export function writeEngine(engine: Engine): void {
  writePreference({ key: StorageKey.ENGINE, value: engine });
}

/* The key. It lives in this device's localStorage and nowhere else: not in the room,
   not over the link to the tablet, not in a log or a toast. */

export function readApiKey(): string {
  return readPreference(StorageKey.GEMINI_KEY)?.trim() ?? '';
}

export function hasApiKey(): boolean {
  return readApiKey() !== '';
}

export function writeApiKey(key: string): void {
  writePreference({ key: StorageKey.GEMINI_KEY, value: key.trim() });
}

export function forgetApiKey(): void {
  forgetPreference(StorageKey.GEMINI_KEY);
}
