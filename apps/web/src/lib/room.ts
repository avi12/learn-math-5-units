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
import { readPreference, writePreference } from './preferences';

const app = initializeApp({
  apiKey: 'YOUR_FIREBASE_API_KEY',
  authDomain: 'avi-math-study.firebaseapp.com',
  projectId: 'avi-math-study',
  storageBucket: 'avi-math-study.firebasestorage.app',
  messagingSenderId: 'YOUR_SENDER_ID',
  appId: '1:YOUR_SENDER_ID:web:47494a4e349e1da6945449'
});

/** The pad lives in the project's DEFAULT database, and a detour on 19.09.2026 is worth
 *  a sentence so it is not taken twice.
 *
 *  The default database is a FREE TIER database (`freeTier: true` on the database
 *  resource), and on the Spark plan that free tier is a hard daily cap, not a rate limit:
 *  20,000 writes and 50,000 reads a day, then 429 until midnight Pacific. A database
 *  created after billing is enabled is `freeTier: false` and the two "free daily" quotas
 *  are scoped by name to the default and to free-tier databases, so neither applies — so
 *  moving the pad to a named database looks like the way out of a spent quota.
 *
 *  IT IS NOT, because the thing that blocks a named database is the same thing. Measured:
 *  a write to a fresh `mathpad` database came back 403 "This API method requires billing
 *  to be enabled... if you enabled billing recently, wait a few minutes to propagate",
 *  which is the 429 wearing a different number. Both doors open on the same latch, and
 *  the default database is the one that has every board ever written in it. */
const db = getFirestore(app);
const KEY = 'avi-math-room';

function fresh(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

/** The address bar, pointed at room `id`. */
function urlFor(id: string): URL {
  const url = new URL(location.href);
  url.searchParams.set('room', id);
  return url;
}

/** Make `id` this device's room and load it. */
function goToRoom(id: string): void {
  writePreference(KEY, id);
  location.href = urlFor(id).toString();
}

/** URL wins, then localStorage, then a new one. The URL is always left carrying it, so
 *  any link copied from the address bar brings the other device into this room. */
export function roomId(): string {
  const asked = new URL(location.href).searchParams.get('room');
  const found = asked || readPreference(KEY) || '';
  const id = /^[0-9a-f]{32}$/.test(found) ? found : fresh();
  writePreference(KEY, id);
  if (asked !== id) {
    history.replaceState(null, '', urlFor(id));
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
  if (!m) {
    return false;
  }

  goToRoom(m[0].toLowerCase());
  return true;
}

export function newRoom(): void {
  goToRoom(fresh());
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
/* ---- did the server take it? ----------------------------------------------
 *
 * Every write below is fire-and-forget on purpose: the ink is on the glass the moment
 * the pen lifts, and Firestore answers the listener from its local cache straight
 * away, so nothing on screen ever waits for the network.
 *
 * What that costs is what Avi hit on 19.09.2026. The daily Firestore write quota ran
 * out, every write came back `resource-exhausted`, and the pad looked completely
 * healthy — ink on the glass, no banner, no console error the person holding it would
 * see — while nothing at all reached the server. The desktop mirror stayed empty and
 * the tablet had no way to say why.
 *
 * The listener's own error callback does NOT cover this, and that is the part worth
 * remembering: `resource-exhausted` is RETRYABLE to the SDK. It backs off, keeps the
 * listener alive on cache, and never calls the error callback — so `fault` in
 * Surface.svelte stayed empty throughout. Measured against the live site while the
 * quota was out: Firestore logged the error twice, the banner did not show once.
 *
 * The write's own promise does see it. `setDoc` resolves when the SERVER has
 * acknowledged the document, not when the cache has it, so a promise still pending
 * after STALL_MS means the ink is on this device only. Counting the promises costs
 * nothing while the network works, and needs no `includeMetadataChanges` on the
 * listener — that would have doubled the snapshot rate per stroke and thrown away the
 * dry-ink cache on every server ack, which is the whole of the erase work undone.
 *
 * The clock is the OLDEST WRITE STILL WAITING, and it took a false pass to get there.
 * The first version asked "how long since the server acknowledged anything", which is a
 * different question and the wrong one: deletes have their own daily quota, so with the
 * write quota spent a delete still comes back 200 while not one stroke lands. Measured —
 * the banner cleared itself 1537ms into a run where every single write was being
 * refused, and the test recorded that as a pass. An acknowledgement of something else is
 * not an acknowledgement of this.
 *
 * Oldest-still-waiting has no such blind spot, and the case it might look wrong for is
 * not real: writing fast enough that the count never falls back to zero is ordinary
 * handwriting, and on a working network no single write is ever eight seconds old. The
 * map is in insertion order, so the oldest pending write is its first value — O(1), no
 * scan, however many strokes pile up while the board is cut off. */
const STALL_MS = 8000;

let seqWrite = 0;
/** Write id -> when it was handed to Firestore. Insertion order is time order. */
const inflight = new Map<number, number>();
let stalled = false;
let timer: ReturnType<typeof setInterval> | null = null;
const watchers = new Set<(v: boolean) => void>();

function announce(v: boolean): void {
  if (v === stalled) {
    return;
  }

  stalled = v;
  for (const w of watchers) {
    w(v);
  }
}

function tick(): void {
  const oldest = inflight.values().next();
  if (oldest.done) {
    announce(false);
    if (timer !== null) {
      clearInterval(timer);
    }
    timer = null;
    return;
  }
  announce(Date.now() - oldest.value >= STALL_MS);
}

/** Watch one write on its way to the server, and hand the promise back unchanged. */
function track<T>(p: Promise<T>): Promise<T> {
  const k = ++seqWrite;
  inflight.set(k, Date.now());
  // A rejection settles it too: the server answered, it just said no. Both branches are
  // attached here so a refused write can never surface as an unhandled rejection.
  function settle(): void {
    inflight.delete(k);
    if (inflight.size === 0) {
      announce(false);
    }
  }
  void p.then(settle, settle);
  if (timer === null) {
    timer = setInterval(tick, 1000);
  }
  return p;
}

/** How many writes the server has not acknowledged yet.
 *
 *  Not the same question as the banner, and the difference matters: the banner waits
 *  STALL_MS before it accuses anything, because a write in flight for two seconds is a
 *  normal write. This is zero-or-not, asked the moment it matters — before the page is
 *  allowed to reload itself.
 *
 *  Firestore is on the DEFAULT memory cache here, so the queue of pending writes lives
 *  in this tab and nowhere else. A reload does not postpone them, it deletes them. That
 *  is why a deploy must not take a page that still has ink in the queue. */
export function unsentWrites(): number {
  return inflight.size;
}

/** True while the server has taken nothing for STALL_MS and writes are still waiting.
 *  Called once on subscribe, so a listener that arrives late still learns the state. */
export function onWriteStall(cb: (v: boolean) => void): () => void {
  watchers.add(cb);
  cb(stalled);
  return () => {
    watchers.delete(cb);
  };
}

/** The only two ways anything in the room is written, so `track` has one home and a new
 *  write path cannot quietly forget to be watched. `setDoc` and `deleteDoc` are
 *  deliberately not re-exported any more — an import of those would bypass all of this. */
export function save(ref: DocumentReference, data: object): Promise<void> {
  return track(setDoc(ref, data));
}

export function remove(ref: DocumentReference): Promise<void> {
  return track(deleteDoc(ref));
}

let seq = Date.now();

/** Commit a finished stroke, and say under which id — so the caller can hold the wet
 *  stroke on screen until the dry one has actually arrived.
 *
 *  `addDoc` would only hand the id back in a promise, and a promise resolves a frame or
 *  more later. Firestore mints ids on the client, so `doc(collection)` gives one
 *  immediately and `setDoc` writes to it: same document, id known now. That is what makes
 *  a flicker-free handoff possible — see `pending` in Surface.svelte. */
export function commit(r: Room, s: Stroke): { key: string; stroke: Stroke } {
  const ref = doc(r.strokes);
  // The STORED document, `n` included, is what goes back to the caller. Handing back the
  // bare stroke instead cost a real bug: redo wrote the document again without `n`, and
  // the listener reads `query(strokes, orderBy('n'))` — a document with no `n` is not in
  // that ordering at all, so redo silently restored nothing.
  const stored: Stroke = { ...s, n: ++seq };
  void save(ref, stored);
  return { key: ref.id, stroke: stored };
}

export function publishLive(r: Room, s: Stroke | null): void {
  void (s ? save(r.live, s) : remove(r.live).catch(() => {}));
}

/** Which exercise the room is on.
 *
 *  The canvas was the only thing that crossed between the two devices, and that turned
 *  out to be half a room: the tablet is what you write on and the desktop is what you
 *  read from, so picking the exercise on one of them left the other naming a different
 *  question. It is the same value on both by definition — there is one person and one
 *  exercise — so it belongs in the room and not in two localStorages.
 *
 *  It matters more than a convenience. The picker is what "שקלוד יבדוק" sends: block,
 *  exercise and section. A desktop still on 07·3·1 while the tablet writes 09·3·2 asks
 *  Claude to mark the wrong question against the wrong criteria, and it does that
 *  silently — a marking scheme for the wrong exercise is worse than none, which is the
 *  reason build/exercises.py exists in the workbook repo at all. */
export function pickRef(id: string): DocumentReference {
  return doc(db, 'rooms', id, 'pick', 'current');
}

/** The room's slider settings — see lib/roomvalue.svelte.ts. A closed set, and
 *  firestore.rules allows exactly these slots. */
export type PrefSlot = 'grid' | 'size';

export function prefRef(id: string, slot: PrefSlot): DocumentReference {
  return doc(db, 'rooms', id, 'prefs', slot);
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
    for (const d of snap.docs.slice(i, i + 400)) {
      batch.delete(d.ref);
    }
    await track(batch.commit());
  }
  await remove(r.live).catch(() => {});
}

export { onSnapshot, orderBy, query };
