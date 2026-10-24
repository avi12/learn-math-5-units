/** Waiting, in the shapes every script here waits in: for a party that may not be there
 *  (a closed tab, a page that never answers), and for a page that is still drawing. */

/** `promise`, or `fallback` once `ms` have passed — a messenger waits for an answer forever,
 *  and every wait here has a deadline (a picture, a call). Rejections become the
 *  fallback too: a party that is not there is the same as one that does not answer. */
export function within<T, F>({
  ms,
  promise,
  fallback
}: {
  ms: number;
  promise: Promise<T>;
  fallback: F;
}): Promise<T | F> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      }
    );
  });
}

/** An answer, or null when the party that should give it is not there. */
export function orNull<T>(answer: Promise<T>): Promise<T | null> {
  return answer.catch(() => null);
}

/** A message nothing waits on: sent, and its failure — nobody listening — dropped. */
export function quietly(sent: Promise<unknown>): Promise<void> {
  return sent.then(
    () => {},
    () => {}
  );
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
