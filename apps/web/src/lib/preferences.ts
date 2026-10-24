/** Per-device settings that survive a reload: the question fold, grid snapping, the
 *  picked exercise. One home for how they are stored, so a flag's stored form lives in
 *  exactly one place and a blocked storage (private window, cleared site data) costs the
 *  setting, never the page. */

/** Every key this app keeps in web storage, in one list so two features cannot pick the
 *  same name and a test can find what it has to clear. These are wire values: a device
 *  already holds its settings under them, so they never change. All localStorage except
 *  RELEASE_TRIES, which is sessionStorage on purpose (lib/release.ts says why). */
export const StorageKey = {
  ROOM: 'avi-math-room',
  PICK: 'avi-math-pick',
  SECTION: 'avi-math-section',
  GRID: 'avi-math-grid',
  SIZE: 'avi-math-size',
  SNAP: 'avi-math-snap',
  SHOW_QUESTION: 'avi-math-showq',
  SHOW_CONNECT: 'avi-math-connect',
  SHOW_HOWTO: 'avi-math-howto',
  RELEASE_TRIES: 'avi-math-release-tries',
  /** which engine runs Gemini Live (lib/engine.ts) */
  ENGINE: 'avi-math-engine',
  /** the person's Gemini API key. This device's alone: never synced, sent or logged */
  GEMINI_KEY: 'avi-math-gemini-key'
} as const;
export type StorageKey = (typeof StorageKey)[keyof typeof StorageKey];

const FLAG_ON = '1';
const FLAG_OFF = '0';

export function readPreference(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writePreference({ key, value }: { key: string; value: string }): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // the setting just does not persist; the board works the same
  }
}

export function forgetPreference(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // nothing stored, or nothing that can be: either way it is gone
  }
}

/** On unless this device has explicitly turned it off. */
export function readFlag(key: string): boolean {
  return readPreference(key) !== FLAG_OFF;
}

export function writeFlag({ key, isOn }: { key: string; isOn: boolean }): void {
  writePreference({ key, value: isOn ? FLAG_ON : FLAG_OFF });
}
