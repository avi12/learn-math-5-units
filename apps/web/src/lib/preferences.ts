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
  RELEASE_TRIES: 'avi-math-release-tries'
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

export function writePreference(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // the setting just does not persist; the board works the same
  }
}

/** On unless this device has explicitly turned it off. */
export function readFlag(key: string): boolean {
  return readPreference(key) !== FLAG_OFF;
}

export function writeFlag(key: string, isOn: boolean): void {
  writePreference(key, isOn ? FLAG_ON : FLAG_OFF);
}
