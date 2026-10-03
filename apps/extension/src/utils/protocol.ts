/** The extension's own wiring: background worker <-> Claude tab, and the parked payload.
 *
 * The pad <-> extension half of the contract (`CHECK_MESSAGE`, `CheckPayload`, the presence
 * flag) is shared with the pad and lives in `shared/protocol.ts`. */
import type { CheckPayload } from '@learn-math/shared/protocol';

/** Claude tab → background: what was I opened for? */
export const TAKE = 'avi-math-take';

/** The one row in `chrome.storage.local`. */
export const PENDING = 'pending';

/** Where a check goes. */
export const NEW_CHAT = 'https://claude.ai/new';

/** How long a parked payload stays valid. A stale one is worse than none: it would be
 *  pasted into whatever Claude tab opens next, days later. */
export const PENDING_TTL_MS = 5 * 60 * 1000;

/** The same, once the background has stamped it. */
export type PendingCheck = CheckPayload & { at: number };
