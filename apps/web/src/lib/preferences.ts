/** Per-device settings that survive a reload: the question fold, grid snapping, the
 *  picked exercise. One home for how they are stored, so a flag's stored form lives in
 *  exactly one place and a blocked storage (private window, cleared site data) costs the
 *  setting, never the page. */

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
