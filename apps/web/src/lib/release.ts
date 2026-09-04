/** Notice a deploy and reload, over the socket that is already open.
 *
 * There is no server here to run a WebSocket of its own — the site is static files on
 * Firebase Hosting — but the pad already holds a live Firestore connection, and that
 * connection *is* a WebSocket. So the deploy writes the build it just put live into one
 * document, `meta/release`, and every open tab hears about it on the same channel that
 * carries the strokes. No polling, no second connection, nothing new to host.
 *
 * The interesting part is not the detection, it is the restraint:
 *
 *   - a reload in the middle of a stroke throws that stroke away, so it waits for the
 *     pen to come off the glass and for a moment of quiet after it;
 *   - the first snapshot always arrives and always carries a build id, so only a
 *     DIFFERENT one counts — otherwise every tab would reload the moment it opened;
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

export interface ReleaseWatch {
  /** True while the page must not go: the pen is down, a stroke is unsent. */
  busy: () => boolean;
  /** A new build is live and the page is about to reload. */
  oncoming: (build: string) => void;
  /** Two reloads did not land on the new build. Stop, and let the user decide. */
  onstuck: () => void;
}

export function watchRelease(w: ReleaseWatch): () => void {
  // In dev every `vite dev` mints its own build id while the document still names the
  // last deploy, so the tab would reload on the spot, for ever.
  if (!import.meta.env.PROD) return () => {};

  let timer: ReturnType<typeof setTimeout> | undefined;
  let announced = '';

  const attempt = (build: string) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (w.busy()) return attempt(build); // still writing — ask again in a moment
      noteTry(build);
      location.reload();
    }, QUIET_MS);
  };

  const off = onSnapshot(
    release,
    (snap) => {
      const build = snap.exists() ? (snap.data() as { build?: string }).build : undefined;
      if (!build || build === __BUILD__ || build === announced) return;
      announced = build;
      if (tries(build) >= 2) return w.onstuck();
      w.oncoming(build);
      attempt(build);
    },
    () => {
      /* the release document is a convenience; a listener that dies must not take the
         pad down with it, and the strokes listener already reports connection trouble */
    }
  );

  return () => {
    clearTimeout(timer);
    off();
  };
}
