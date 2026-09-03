/** Firebase wiring and the room the two devices share.
 *
 * Security note, deliberately: there is no sign-in. Firebase Auth's admin API needs
 * a billing account, and this is a personal scratch pad on the free plan. The room id
 * is 128 bits of crypto randomness, the rules deny reading or listing anything above
 * /rooms/$room, and the id never leaves the two devices. To harden it later, enable
 * Anonymous sign-in in the Firebase console and add `"auth != null &&"` to the rules. */

import { initializeApp } from 'firebase/app';
import {
  getDatabase,
  ref,
  push,
  set,
  remove,
  onValue,
  onChildAdded,
  onChildRemoved,
  onDisconnect,
  serverTimestamp,
  type DatabaseReference
} from 'firebase/database';
import type { Stroke } from './ink';

const app = initializeApp({
  apiKey: 'YOUR_FIREBASE_API_KEY',
  authDomain: 'avi-math-study.firebaseapp.com',
  databaseURL: 'https://avi-math-study-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'avi-math-study',
  storageBucket: 'avi-math-study.firebasestorage.app',
  messagingSenderId: 'YOUR_SENDER_ID',
  appId: '1:YOUR_SENDER_ID:web:47494a4e349e1da6945449'
});

const db = getDatabase(app);
const KEY = 'avi-math-room';

function fresh(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

/** URL wins, then localStorage, then a new one. The URL is always left carrying it,
 *  so any link you copy from the address bar brings the other device to this room. */
export function roomId(): string {
  const url = new URL(location.href);
  let id = url.searchParams.get('room') || localStorage.getItem(KEY) || fresh();
  if (!/^[0-9a-f]{32}$/.test(id)) id = fresh();
  localStorage.setItem(KEY, id);
  if (url.searchParams.get('room') !== id) {
    url.searchParams.set('room', id);
    history.replaceState(null, '', url);
  }
  return id;
}

export function newRoom(): string {
  const url = new URL(location.href);
  const id = fresh();
  localStorage.setItem(KEY, id);
  url.searchParams.set('room', id);
  location.href = url.toString();
  return id;
}

export interface Room {
  strokes: DatabaseReference;
  live: DatabaseReference;
  presence: DatabaseReference;
}

export function room(id: string): Room {
  return {
    strokes: ref(db, `rooms/${id}/strokes`),
    live: ref(db, `rooms/${id}/live`),
    presence: ref(db, `rooms/${id}/presence`)
  };
}

export function commit(r: Room, s: Stroke): string {
  const child = push(r.strokes);
  void set(child, s);
  return child.key!;
}

export function publishLive(r: Room, s: Stroke | null): void {
  void set(r.live, s);
}

export function undoRef(id: string, key: string): DatabaseReference {
  return ref(db, `rooms/${id}/strokes/${key}`);
}

export function clearAll(id: string): void {
  void remove(ref(db, `rooms/${id}/strokes`));
  void remove(ref(db, `rooms/${id}/live`));
}

/** Announce this device and drop the flag when the tab closes, so the board can say
 *  whether the tablet is actually connected. */
export function announce(r: Room, role: string): void {
  const me = push(r.presence);
  void set(me, { role, at: serverTimestamp() });
  void onDisconnect(me).remove();
}

export { ref, set, remove, onValue, onChildAdded, onChildRemoved, db };
