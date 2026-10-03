/** Which strokes might be under a point — so the rubber tests a handful, not the board.
 *
 *  The board is a strip: it runs for ever downwards and is exactly one width across, so
 *  the only axis worth indexing is y. tldraw reaches for an R-tree here (RBush, since
 *  v4.4.0) because its canvas is open in both directions; one axis needs nothing more
 *  than an array of buckets.
 *
 *  On a board of three thousand strokes that is the difference between testing three
 *  thousand and testing seventy — and the number the hand feels stops growing with how
 *  much has been written. Measured in `erasecost.mjs`. */
import { boxOf, type Stroke } from './ink';

/** How tall one band is, in normalised units — about a third of a page.
 *
 *  The size is a trade: wider bands mean fewer buckets and more strokes tested per rub,
 *  narrower bands mean a longer index to build on every snapshot. A third of a page is
 *  a few lines of handwriting, which is the scale a rubber works at. */
const BAND = 0.22;

function bandOf(y: number): number {
  return Math.floor(y / BAND);
}

export class BandIndex {
  private bands = new Map<number, string[]>();
  private builtFor = -1;

  /** Rebuild from the strokes, unless it was already built for this `version`. */
  update(version: number, order: string[], byKey: Map<string, Stroke>): void {
    if (version === this.builtFor) {
      return;
    }

    this.bands.clear();
    for (const k of order) {
      const s = byKey.get(k);
      const b = s && boxOf(s);
      if (!b) {
        continue;
      }

      for (let i = bandOf(b.y0); i <= bandOf(b.y1); i++) {
        this.add(i, k);
      }
    }
    this.builtFor = version;
  }

  /** Every stroke key in the bands that the span y0…y1 touches. A stroke spanning two of
   *  them can come out twice; the caller's own "already erased" check absorbs that. */
  *near(y0: number, y1: number): Generator<string> {
    for (let i = bandOf(y0); i <= bandOf(y1); i++) {
      yield* this.bands.get(i) ?? [];
    }
  }

  private add(band: number, key: string): void {
    const keys = this.bands.get(band);
    if (!keys) {
      this.bands.set(band, [key]);
      return;
    }

    keys.push(key);
  }
}
