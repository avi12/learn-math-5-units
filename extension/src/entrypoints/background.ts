import {
  CHECK_MESSAGE,
  NEW_CHAT,
  PENDING,
  PENDING_TTL_MS,
  TAKE,
  type PendingCheck
} from '../utils/protocol';

/** Park the payload, open Claude, and let the tab come and collect it.
 *
 * A service worker in MV3 is killed whenever it feels like it, so the payload goes to
 * `chrome.storage.local` and not to a variable. The board is a PNG data URL of a couple
 * of hundred kilobytes, which is comfortably inside the quota, and it is deleted the
 * moment it has been used — nothing that was written on the board should outlive the
 * check it was sent for.
 */
export default defineBackground(() => {
  /** When the last tab was opened, so the same click cannot open two.
   *
   *  A guard, not a diagnosed fix. Nothing in this extension opens a window except the
   *  one `chrome.tabs.create` below — but two copies of it loaded at once (an unpacked
   *  leftover beside the built one is the easy way to get there) would each hear the
   *  page's `postMessage` and each open a tab, and the symptom would be a stray window
   *  that looks like it came from somewhere else entirely.
   *
   *  Lives in module scope, so it survives for as long as the worker does and no longer.
   *  That is the right lifetime: two deliveries of one click arrive milliseconds apart,
   *  and a real second check is always a new gesture seconds later. */
  let lastOpen = 0;
  const DEDUPE_MS = 1500;

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg?.type === CHECK_MESSAGE) {
      const now = Date.now();
      if (now - lastOpen < DEDUPE_MS) return false;
      lastOpen = now;
      // A stale payload is worse than none: it would be pasted into whatever Claude tab
      // opens next, days later. Stamped, and refused on the other side if it is old.
      // Open Claude either way. If the write failed — quota, most likely, since the board
      // is a data URL — the tab still opens and the Claude script takes its no-payload
      // path, which is a visibly empty chat. Swallowing the failure here would leave the
      // click looking like it did nothing at all.
      void chrome.storage.local
        .set({ [PENDING]: { ...msg, at: Date.now() } })
        .catch(() => {})
        .then(() => chrome.tabs.create({ url: NEW_CHAT }));
      return false;
    }

    // The Claude tab asking what it was opened for.
    if (msg?.type === TAKE) {
      void chrome.storage.local.get(PENDING).then((row) => {
        const pending = row[PENDING] as PendingCheck | undefined;
        const fresh = pending && Date.now() - pending.at < PENDING_TTL_MS;
        reply(fresh ? pending : null);
        if (pending) void chrome.storage.local.remove(PENDING);
      });
      return true; // the reply is async
    }
    return false;
  });
});
