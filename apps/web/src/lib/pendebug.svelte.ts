/** `?pendebug` in the URL prints what the pen actually reported on its last touches.
 *
 *  There is no way to try an S Pen from a desktop, and "the button does nothing" is not a
 *  report anyone can act on; this turns it into a few lines that say exactly what the
 *  device sends. Off, it costs nothing: every method returns at once. */
import { params } from './device';
import { spenWrapper, type PenReport } from './spen';

const ON = params.has('pendebug');
const LINES = 4;

export class PenDebug {
  /** The last few lines, newest first; empty when off. */
  lines = $state<string[]>(ON ? ['pendebug · גע בלוח'] : []);

  note(tag: string, e: PointerEvent | MouseEvent): void {
    if (!ON) {
      return;
    }

    const p = e as PointerEvent;
    this.push(`${tag} ${p.pointerType ?? '-'} button=${e.button} buttons=${e.buttons}`);
  }

  /** What the native wrapper reported — its raw integers, which is the whole point. */
  wrapper(down: boolean, r: PenReport): void {
    if (!ON) {
      return;
    }

    const tool = r.toolType ?? '-';
    this.push(`wrapper ${spenWrapper() || '-'} buttonState=${r.buttonState ?? '-'} tool=${tool} → ${down ? 'erase' : 'pen'}`);
  }

  /** Listen on the document, in the capture phase: an event the app never sees is the most
   *  useful thing the probe can report, and "nothing appeared" is then a real answer
   *  rather than an ambiguity. Returns the teardown. */
  listen(): () => void {
    if (!ON) {
      return () => {};
    }

    const raw = (e: Event) => this.note('raw', e as PointerEvent);
    const menu = (e: Event) => this.note('ctxmenu', e as MouseEvent);
    document.addEventListener('pointerdown', raw, true);
    document.addEventListener('contextmenu', menu, true);
    return () => {
      document.removeEventListener('pointerdown', raw, true);
      document.removeEventListener('contextmenu', menu, true);
    };
  }

  private push(line: string): void {
    this.lines = [line, ...this.lines.filter((x) => x !== line)].slice(0, LINES);
  }
}
