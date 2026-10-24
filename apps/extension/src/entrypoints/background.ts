import { quietly } from '../utils/async';
import { installLive } from '../utils/live';
import { ExtensionMessage, extensionMessenger, type PendingCheck } from '../utils/protocol';

/** The one row in `chrome.storage.local`. */
const PENDING = 'pending';

/** Where a check goes. */
const NEW_CHAT = 'https://claude.ai/new';

/** How long a parked payload stays valid. A stale one is worse than none: it would be
 *  pasted into whatever Claude tab opens next, days later. */
const PENDING_TTL_MS = 5 * 60 * 1000;

/** Park the payload, open Claude, and let the tab come and collect it.
 *
 * A service worker in MV3 is killed whenever it feels like it, so the payload goes to
 * `chrome.storage.local` and not to a variable. The board is a PNG data URL of a couple
 * of hundred kilobytes, which is comfortably inside the quota, and it is deleted the
 * moment it has been used — nothing that was written on the board should outlive the
 * check it was sent for.
 */
export default defineBackground(() => {
  // Gemini Live, the second examiner: its own listeners, its own file.
  installLive();

  /** When the last tab was opened, so the same click cannot open two.
   *
   *  A guard, not a diagnosed fix. Nothing in this extension opens a window except the
   *  one `chrome.tabs.create` below — but two copies of it loaded at once (an unpacked
   *  leftover beside the built one is the easy way to get there) would each hear the
   *  page's message and each open a tab, and the symptom would be a stray window
   *  that looks like it came from somewhere else entirely.
   *
   *  Lives in module scope, so it survives for as long as the worker does and no longer.
   *  That is the right lifetime: two deliveries of one click arrive milliseconds apart,
   *  and a real second check is always a new gesture seconds later. */
  let lastOpen = 0;
  const DEDUPE_MS = 1500;

  extensionMessenger.onMessage(ExtensionMessage.CHECK, ({ data }) => {
    const now = Date.now();
    if (now - lastOpen < DEDUPE_MS) {
      return;
    }

    lastOpen = now;
    // Stamped, and refused on the other side once it is older than PENDING_TTL_MS.
    // Open Claude either way. If the write failed — quota, most likely, since the board
    // is a data URL — the tab still opens and the Claude script takes its no-payload
    // path, which is a visibly empty chat. Swallowing the failure here would leave the
    // click looking like it did nothing at all.
    const parked: PendingCheck = { ...data, at: Date.now() };
    void quietly(chrome.storage.local.set({ [PENDING]: parked })).then(() => chrome.tabs.create({ url: NEW_CHAT }));
  });

  // The Claude tab asking what it was opened for.
  extensionMessenger.onMessage(ExtensionMessage.TAKE, async () => {
    const row = await chrome.storage.local.get(PENDING);
    const pending = row[PENDING] as PendingCheck | undefined;
    if (!pending) {
      return null;
    }

    void chrome.storage.local.remove(PENDING);
    return Date.now() - pending.at < PENDING_TTL_MS ? pending : null;
  });
});
