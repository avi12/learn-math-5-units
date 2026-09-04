/** "He has stopped writing" — the only moment worth spending a recognition on.
 *
 * Reading the canvas costs seconds of CPU, and while the expression is still half
 * written it costs something worse: a confidently wrong formula, published to the room
 * and dropped into the editor on top of what is already there.
 *
 * So recognition is never triggered by a stroke landing. It is triggered by *silence*,
 * and silence needs two clocks rather than one — which is exactly what the previous
 * version was missing. It restarted a single timer when a committed stroke came back
 * from Firestore, and nothing at all happened while the pen was moving. Two failures
 * followed from that:
 *
 *   - a stroke that took longer than the delay fired a recognition on top of itself,
 *     because the timer armed by the *previous* stroke was still running underneath it;
 *   - every pause between two symbols of one equation fired its own recognition, since
 *     lifting the pen to start an exponent looks identical to finishing the line.
 *
 * Here the pen holds the clock open for as long as it is on the glass, however long
 * that is, and only lifting it starts the countdown.
 */

/** Long enough to cross the gap inside one equation — lifting the pen to start an
 *  exponent, or moving back to close a bracket, is a normal one-to-two second pause.
 *  Short enough that finishing a line and looking up gets an answer without asking.
 *  Single source of truth: the countdown bar in the formula bar animates over this. */
export const SETTLE_MS = 2400;

export class Settle {
  #timer: ReturnType<typeof setTimeout> | undefined;
  /** the pen is on the glass: no countdown may run until it leaves */
  #held = false;
  readonly #run: () => void;
  readonly #onarm: (armed: boolean) => void;
  readonly #ms: number;

  /**
   * @param run     what to do once the drawing has been still long enough
   * @param onarm   told whenever a countdown starts or stops, so the UI can show it
   * @param ms      the silence that counts as "finished"
   */
  constructor(run: () => void, onarm: (armed: boolean) => void = () => {}, ms: number = SETTLE_MS) {
    this.#run = run;
    this.#onarm = onarm;
    this.#ms = ms;
  }

  /** The pen touched the glass, or left it. */
  pen(down: boolean): void {
    this.#held = down;
    if (down) this.cancel();
    else this.#arm();
  }

  /** The drawing changed some other way — a stroke landed, an undo removed one.
   *  Ignored while the pen is down, because the pen itself will start the clock. */
  nudge(): void {
    if (!this.#held) this.#arm();
  }

  /** Stop waiting without running: the bar was closed, or a manual read took over. */
  cancel(): void {
    if (this.#timer === undefined) return;
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#onarm(false);
  }

  #arm(): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      this.#onarm(false);
      this.#run();
    }, this.#ms);
    this.#onarm(true);
  }
}
