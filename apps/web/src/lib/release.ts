/** Notice a deploy and reload, on both devices, without anyone pressing anything.
 *
 * WHAT IS LIVE IS `build-id.txt`, FETCHED OVER HTTP. Nothing else is asked. The file is
 * written by the same vite run that bakes `__BUILD__` into the bundle and it is served
 * by the same hosting that serves the bundle, so "what is deployed" and "what am I
 * running" are two readings of one value. Firebase Hosting is the only thing that has to
 * be up for this to work — and if it is down there is no new bundle to go and get.
 *
 * It used to be the other way round: the deploy wrote the build id into a Firestore
 * document and every tab read it off the socket it already held. Clever, free, and it
 * failed twice over on 19.09.2026 when the daily Firestore quota ran out:
 *
 *   - the deploy could not WRITE the document, so no tab learned there was a new build;
 *   - the tabs could not READ it either — but `onSnapshot` does not say so, it serves
 *     the last CACHED copy. That copy named an older deploy, the tab compared it against
 *     itself, decided it was behind, reloaded twice, and put up "refresh manually".
 *
 * A stale cache that reads as fresh is worse than no signal at all, and that is the
 * whole reason the authority moved. Firestore is still listened to, but only as a
 * NUDGE: a change on that document means "go and look", never "here is the build id".
 * So when Firestore is healthy a deploy lands on the tablet in about a second, and when
 * it is not, the poll below gets there anyway.
 *
 * The rest of this file is restraint, and it is the part worth keeping:
 *
 *   - a reload in the middle of a stroke throws that stroke away, so it waits for the
 *     pen to come off the glass and for a moment of quiet after it;
 *   - a tab that reloads and comes back on the old bundle would reload again, and again.
 *     That happens for real: a CDN edge can serve the previous index.html for a while.
 *     So the attempt is counted per build id, and after two the tab gives up and says so
 *     instead of spinning.
 */
import { onSnapshot, release } from './room';

declare const __BUILD__: string;

/** Attempts already made for a given build, kept per tab so a fresh tab starts clean. */
const KEY = 'avi-math-release-tries';

/** How long the board has to be quiet before the page is allowed to go. Long enough that
 *  a pause between two digits does not count as "finished writing". */
const QUIET_MS = 2500;

/** How often to ask hosting what is live. The file is eight bytes and the answer is
 *  usually "the same as you"; this is the floor on how late a deploy can arrive when
 *  Firestore is not there to nudge. */
const POLL_MS = 30000;

/** Where the deployed build id is published. Same origin, same hosting as the bundle. */
const BUILD_URL = '/build-id.txt';

function tries(build: string): number {
  try {
    const [b, n] = (sessionStorage.getItem(KEY) ?? '').split(':');
    return b === build ? Number(n) || 0 : 0;
  } catch {
    return 0; // private mode, storage disabled — treat every attempt as the first
  }
}

function noteTry(build: string) {
  try {
    sessionStorage.setItem(KEY, `${build}:${tries(build) + 1}`);
  } catch {
    /* nothing to do; the worst case is one extra reload */
  }
}

/** The build hosting is serving right now, or null if it could not be asked.
 *
 *  `no-store` is not belt and braces. The file carries a `no-cache` header from
 *  firebase.json, which means "revalidate", and a revalidation the browser decides to
 *  skip — offline, a WebView being frugal, a proxy — hands back the build this tab
 *  already knows, which is the one reading that can never be useful. */
async function liveBuild(): Promise<string | null> {
  try {
    const r = await fetch(`${BUILD_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const id = (await r.text()).trim();
    // A rewrite rule sends unknown paths to index.html, so a missing file comes back as
    // a page rather than a 404. A build id is short and has no markup in it.
    return /^[a-z0-9]{4,32}$/i.test(id) ? id : null;
  } catch {
    return null; // offline, or hosting unreachable — ask again next round
  }
}

export interface ReleaseWatch {
  /** True while the page must not go: the pen is down, a stroke is unsent. */
  busy: () => boolean;
  /** A new build is live and the page is about to reload. */
  oncoming: (build: string) => void;
  /** Two reloads did not land on the new build. Stop, and let the user decide. */
  onstuck: () => void;
}

export function watchRelease(w: ReleaseWatch): () => void {
  // In dev every `vite dev` mints its own build id while hosting still serves the last
  // deploy, so the tab would reload on the spot, for ever.
  if (!import.meta.env.PROD) return () => {};

  let timer: ReturnType<typeof setTimeout> | undefined;
  let announced = '';
  let stopped = false;

  const attempt = (build: string) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (stopped) return;
      if (w.busy()) return attempt(build); // still writing — ask again in a moment
      noteTry(build);
      location.reload();
    }, QUIET_MS);
  };

  let checking = false;
  const check = async () => {
    if (stopped || checking) return;
    checking = true;
    const build = await liveBuild();
    checking = false;
    if (stopped || !build || build === __BUILD__ || build === announced) return;
    announced = build;
    if (tries(build) >= 2) return w.onstuck();
    w.oncoming(build);
    attempt(build);
  };

  const every = setInterval(check, POLL_MS);

  // A tablet that spent the night asleep has an interval that did not run. These two are
  // when a person is actually about to look at the thing, which is exactly when being on
  // last week's bundle matters.
  const onwake = () => {
    if (document.visibilityState === 'visible') void check();
  };
  document.addEventListener('visibilitychange', onwake);
  window.addEventListener('online', onwake);
  window.addEventListener('focus', onwake);

  // The nudge. What the document SAYS is never used — only that it changed at all, which
  // means a deploy has just finished and hosting is worth asking. Its first snapshot
  // arrives immediately on subscribe and is the initial check, which is wanted: a tab
  // opened from a stale cache learns within a second rather than within POLL_MS.
  const off = onSnapshot(
    release,
    () => void check(),
    () => {
      /* the nudge is a convenience; a listener that dies must not take the pad down with
         it, and the poll above is what this actually runs on */
    }
  );

  void check();

  return () => {
    stopped = true;
    clearTimeout(timer);
    clearInterval(every);
    document.removeEventListener('visibilitychange', onwake);
    window.removeEventListener('online', onwake);
    window.removeEventListener('focus', onwake);
    off();
  };
}
