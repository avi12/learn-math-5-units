/** How any part of the page talks to the person: a toast, or a question (Ask.svelte).
 *
 *  One home, so a component that needs to say something imports `say` instead of being
 *  handed it as a prop through every layer above it. The page mounts exactly one <Ask>
 *  and one toast — a modal is modal, so there is never a second. */

const TOAST_MS = 2400;

export const toast = $state({ text: '' });
let toastTimer: ReturnType<typeof setTimeout> | undefined;

/** A sticky toast is one the page is not going to outlive, so it must not fade. */
export function say(text: string, sticky = false): void {
  clearTimeout(toastTimer);
  toast.text = text;
  if (sticky) {
    return;
  }

  toastTimer = setTimeout(() => (toast.text = ''), TOAST_MS);
}

/** What Ask.svelte exports. */
interface Asker {
  confirm(message: string): Promise<boolean>;
  prompt(message: string, initial?: string): Promise<string | null>;
}

let asker: Asker | undefined;

/** Called by the page once its <Ask> exists. */
export function provideAsk(a: Asker | undefined): void {
  asker = a;
}

/** The page's own confirm. See lib/Ask.svelte for why it is not the browser's — the short
 *  version is that inside the Android wrapper the browser's own answer "no" instantly
 *  and by itself. False when no dialog is mounted, which is the safe answer. */
export function confirm(message: string): Promise<boolean> {
  return asker?.confirm(message) ?? Promise.resolve(false);
}

export function prompt(message: string, initial = ''): Promise<string | null> {
  return asker?.prompt(message, initial) ?? Promise.resolve(null);
}
