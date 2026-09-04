/** Park the payload, open Claude, and let the tab come and collect it.
 *
 * A service worker in MV3 is killed whenever it feels like it, so the payload goes to
 * `chrome.storage.local` and not to a variable. The board is a PNG data URL of a couple
 * of hundred kilobytes, which is comfortably inside the quota, and it is deleted the
 * moment it has been used — nothing that was written on the board should outlive the
 * check it was sent for.
 */
const CHECK_MESSAGE = 'avi-math-check@1';
const TAKE = 'avi-math-take';
const PENDING = 'pending';
const NEW_CHAT = 'https://claude.ai/new';

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.type === CHECK_MESSAGE) {
    // A stale payload is worse than none: it would be pasted into whatever Claude tab
    // opens next, days later. Stamped, and refused on the other side if it is old.
    // Open Claude either way. If the write failed — quota, most likely, since the board
    // is a data URL — the tab still opens and claude.js takes its no-payload path, which
    // is a visibly empty chat. Swallowing the failure here would leave the click looking
    // like it did nothing at all.
    chrome.storage.local
      .set({ [PENDING]: { ...msg, at: Date.now() } })
      .catch(() => {})
      .then(() => chrome.tabs.create({ url: NEW_CHAT }));
    return false;
  }

  // The Claude tab asking what it was opened for.
  if (msg?.type === TAKE) {
    chrome.storage.local.get(PENDING).then(({ pending }) => {
      const fresh = pending && Date.now() - pending.at < 5 * 60 * 1000;
      reply(fresh ? pending : null);
      if (pending) chrome.storage.local.remove(PENDING);
    });
    return true; // the reply is async
  }
  return false;
});
