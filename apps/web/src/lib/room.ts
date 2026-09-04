/** Firestore wiring and the room the two devices share.
 *
 * Firestore bills per document write, so the sync granularity is a completed STROKE,
 * not a pointer move. For handwriting that is already close to live: a digit takes a
 * few hundred milliseconds, so the desktop updates character by character. Only a
 * stroke that runs long (a sweeping curve, a big circle) publishes in-progress frames,
 * and those are throttled — see LIVE_AFTER_MS / LIVE_EVERY_MS in Surface.svelte.
 *
 * Security, deliberately: there is no sign-in. Firebase Auth's admin API needs a
 * billing account and this is a personal pad on the free plan. The room id is 128 bits
 * of crypto randomness, the rules refuse anything whose room segment is not 32 chars,
 * and /rooms itself has no rule, so it cannot be listed. To harden later, enable
 * Anonymous sign-in in the console and add `request.auth != null` to firestore.rules. */

import { initializeApp } from 'firebase/app';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  writeBatch,
  type CollectionReference,
  type DocumentReference
} from 'firebase/firestore';
import type { Stroke } from './ink';

const app = initializeApp({
  apiKey: 'YOUR_FIREBASE_API_KEY',
  authDomain: 'avi-math-study.firebaseapp.com',
  projectId: 'avi-math-study',
  storageBucket: 'avi-math-study.firebasestorage.app',
  messagingSenderId: 'YOUR_SENDER_ID',
  appId: '1:YOUR_SENDER_ID:web:47494a4e349e1da6945449'
});

const db = getFirestore(app);
const KEY = 'avi-math-room';

function fresh(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

/** URL wins, then localStorage, then a new one. The URL is always left carrying it, so
 *  any link copied from the address bar brings the other device into this room. */
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

/** Join an existing room from whatever the other device offered: the whole address bar,
 *  a shared link, or the bare id. Anything containing 32 hex characters counts, because
 *  what actually gets pasted is never predictable — and on a tablet, retyping 32
 *  characters correctly is not a thing anyone does twice.
 *
 *  This exists because a device can otherwise be stranded. The QR and the room card live
 *  on the desktop mirror; a tablet that opened a room of its own — a fresh browser, a
 *  cleared site, the WebView wrapper with its own storage — had no way back into the
 *  room the desktop was watching. Returns false if there was no id in the text. */
export function joinRoom(text: string): boolean {
  const m = text.match(/[0-9a-f]{32}/i);
  if (!m) return false;
  const id = m[0].toLowerCase();
  localStorage.setItem(KEY, id);
  const url = new URL(location.href);
  url.searchParams.set('room', id);
  location.href = url.toString();
  return true;
}

export function newRoom(): void {
  const url = new URL(location.href);
  const id = fresh();
  localStorage.setItem(KEY, id);
  url.searchParams.set('room', id);
  location.href = url.toString();
}

export interface Room {
  id: string;
  strokes: CollectionReference;
  live: DocumentReference;
}

export function room(id: string): Room {
  return {
    id,
    strokes: collection(db, 'rooms', id, 'strokes'),
    live: doc(db, 'rooms', id, 'live', 'current')
  };
}

/** Strokes are ordered by a client clock. One person drawing on one device at a time
 *  makes a server timestamp unnecessary, and a server timestamp would arrive null on
 *  the writing device and briefly reorder the board. */
let seq = Date.now();

export function commit(r: Room, s: Stroke): void {
  void addDoc(r.strokes, { ...s, n: ++seq });
}

export function publishLive(r: Room, s: Stroke | null): void {
  void (s ? setDoc(r.live, s) : deleteDoc(r.live).catch(() => {}));
}

export function latexRef(id: string): DocumentReference {
  return doc(db, 'rooms', id, 'latex', 'current');
}

export function strokeRef(id: string, key: string): DocumentReference {
  return doc(room(id).strokes, key);
}

/** The one document outside /rooms: the build the last deploy put live. It is public and
 *  read-only from the browser — the deploy writes it through the Firestore REST API as a
 *  project member, which goes through IAM rather than through firestore.rules. Keeping it
 *  here means every Firestore reference in the app still has exactly one home. */
export const release: DocumentReference = doc(db, 'meta', 'release');

/** Firestore has no recursive delete from the client, so a clear is a batch. */
export async function clearAll(id: string): Promise<void> {
  const r = room(id);
  const snap = await getDocs(r.strokes);
  for (let i = 0; i < snap.docs.length; i += 400) {
    const batch = writeBatch(db);
    for (const d of snap.docs.slice(i, i + 400)) batch.delete(d.ref);
    await batch.commit();
  }
  await deleteDoc(r.live).catch(() => {});
}

export { deleteDoc, onSnapshot, orderBy, query, setDoc };
