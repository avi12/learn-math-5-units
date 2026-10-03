/* ---- undo / redo ----------------------------------------------------------
   A stack of ACTIONS, not of strokes. That distinction is the whole feature: an erase
   is not a stroke, it is N deletions, and Avi's case — the S Pen's barrel button turns
   a stroke into an erase, and it is pressed by accident — needs all N back.

   Each entry says what the hand did and what it did it to. Undoing a draw deletes;
   undoing an erase writes the strokes back under their own ids, so they return to
   their own places in the order rather than to the end. Redo is the same operation
   with the direction flipped, which is why there is one `apply`.

   The stack is local and deliberately so: it is this person's trail of what they just
   took back, not a shared history, and a second device undoing its own work should not
   hand this one something to redo.

   Anything newly drawn empties the redo side. That is the ordinary rule — once you
   have drawn again, "forward" is not where you came from. */
import type { Stroke } from './ink';
import { remove, save, strokeRef } from './room';

/** One completed thing the hand did. A draw carries the stroke it made; an erase carries
 *  every stroke that gesture removed. Surface.svelte emits these. */
export type Action = { kind: 'draw' | 'erase'; items: { key: string; stroke: Stroke }[] };

export class History {
  undoStack = $state<Action[]>([]);
  redoStack = $state<Action[]>([]);

  private readonly roomId: string;

  constructor(roomId: string) {
    this.roomId = roomId;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  record(a: Action): void {
    this.undoStack.push(a);
  }

  /** Drawing again is what makes "forward" meaningless. */
  forgetRedo(): void {
    this.redoStack = [];
  }

  /** The action taken back, or null when there was nothing to take. */
  undo(): Action | null {
    const a = this.undoStack.pop();
    if (!a) {
      return null;
    }

    this.apply(a, false);
    this.redoStack.push(a);
    return a;
  }

  redo(): Action | null {
    const a = this.redoStack.pop();
    if (!a) {
      return null;
    }

    this.apply(a, true);
    this.undoStack.push(a);
    return a;
  }

  /** `forward` = put the world back the way the action left it. A draw leaves its stroke
   *  present, an erase leaves its strokes gone — so the two kinds write on opposite
   *  directions, and that is the only thing that differs between undo and redo. */
  private apply(a: Action, forward: boolean): void {
    const write = (a.kind === 'draw') === forward;
    for (const it of a.items) {
      const ref = strokeRef(this.roomId, it.key);
      void (write ? save(ref, it.stroke) : remove(ref));
    }
  }
}
