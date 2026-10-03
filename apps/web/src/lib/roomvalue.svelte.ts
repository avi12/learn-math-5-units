/* ---- a slider setting that belongs to the room ----------------------------------
   One value for the room, not one per device:

   - the grid size: shape corners snap to the squares on the device holding the pen, and
     the mirror draws its own squares under the same ink. If the two disagreed, a line
     snapped on the tablet would sit between lines on the desktop.
   - the ink thickness (Avi, 03.10.2026: "עובי הדיו גם צריך להישמר עם החדר"): the room is
     the notebook, and the pen you were writing with is part of where you left it.

   Same shape as the exercise choice (lib/pick.svelte.ts): localStorage is what shows
   before Firestore answers and the whole answer offline; the room overrides it as soon as
   it speaks. The room hears about a change when the slider is released (`commit`). */
import type { DocumentReference } from 'firebase/firestore';
import { clampToRange, type Range } from './ink';
import { readPreference, writePreference } from './preferences';
import { onSnapshot, prefRef, save, type PrefSlot } from './room';

export class RoomValue {
  /** Set by its slider, which cannot leave the range; what is read back is clamped. */
  value = $state(0);
  private ref: DocumentReference;

  /** Must run inside a component, because it owns effects. */
  constructor(roomId: string, slot: PrefSlot, range: Range) {
    const storeKey = `avi-math-${slot}`;
    this.ref = prefRef(roomId, slot);
    this.value = clampToRange(range, Number(readPreference(storeKey) ?? range.initial));

    $effect(() => writePreference(storeKey, String(this.value)));

    $effect(() =>
      onSnapshot(this.ref, (snap) => {
        const v = snap.data()?.value;
        if (typeof v === 'number') {
          this.value = clampToRange(range, v);
          return;
        }
        // A room that has never been told: the first device in seeds it with what it
        // has, so the other one is not left on the default.
        if (!snap.metadata.fromCache) {
          this.commit();
        }
      })
    );
  }

  /** Hand the value to the room. Called when the slider is LET GO, not on every step:
   *  the squares follow the finger locally, and a database write per step was work the
   *  tablet did between frames while the hand was still moving. */
  commit(): void {
    void save(this.ref, { value: this.value });
  }
}
