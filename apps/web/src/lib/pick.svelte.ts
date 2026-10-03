/* ---- which exercise, and which section of it --------------------------------
   The topic is chosen rather than guessed: the criteria a bagrut marker uses are
   per-topic, and a check against the wrong list is worse than no check.

   ONE value, not two. Topic and exercise were separate pickers and that was a worse
   shape than it looked: the two could disagree while the app rearranged them, and the
   closed control never showed which block the exercise belonged to. A single value —
   `block:tier.n` — cannot be half-chosen. Every chapter also has a way out for a question
   that is not from the workbook (`block:`), because the criteria are per block, so "not
   from the workbook" still has to say which block to mark against. */
import { untrack } from 'svelte';
import { RUNG_LIST, TOPICS, exKey, type Exercise, type Topic } from './check';
import { readPreference, writePreference } from './preferences';
import { onSnapshot, pickRef, save } from './room';

const PICK_KEY = 'avi-math-pick';
const SEC_KEY = 'avi-math-section';

export function pickOf(blockId: string, ex: string): string {
  return `${blockId}:${ex}`;
}

/** The two halves of a pick: the chapter id and the exercise key ('' = not from the workbook). */
function parts(pick: string): [string, string] {
  const [block = '', ex = ''] = pick.split(':');
  return [block, ex];
}

/** Every exercise in the order the lists show them: chapter, then rung, then row. */
const ORDER: string[] = TOPICS.flatMap((t) =>
  RUNG_LIST.flatMap((r) =>
    t.exercises.filter((e) => e.tier === r.tier).map((e) => pickOf(t.id, exKey(e)))
  )
);

function firstOf(t: Topic): string {
  return ORDER.find((p) => p.startsWith(`${t.id}:`)) ?? pickOf(t.id, '');
}

export class Choice {
  // a device with nothing saved opens on an actual question, not on "not from the workbook"
  pick = $state(readPreference(PICK_KEY) ?? firstOf(TOPICS[0]));
  /** a section letter, or '' for the whole exercise. */
  section = $state(readPreference(SEC_KEY) ?? '');

  topic: Topic = $derived(TOPICS.find((t) => t.id === parts(this.pick)[0]) ?? TOPICS[0]);
  exercise: Exercise | null = $derived(
    this.topic.exercises.find((e) => exKey(e) === parts(this.pick)[1]) ?? null
  );
  letters: string[] = $derived(this.exercise?.sections ?? []);

  /** Where the pick sits in ORDER. "Not from the workbook" is not in it, so it counts as
   *  sitting just after its chapter's last exercise. */
  at: number = $derived.by(() => {
    const i = ORDER.indexOf(this.pick);
    if (i >= 0) {
      return i;
    }

    return ORDER.findLastIndex((p) => p.startsWith(`${this.topic.id}:`)) + 0.5;
  });

  get isFirst(): boolean {
    return this.at <= 0;
  }

  get isLast(): boolean {
    return this.at >= ORDER.length - 1;
  }

  /** Remembered per device and kept honest, from the moment this is created. Must run
   *  inside a component, because it owns effects. */
  constructor(roomId: string) {
    $effect(() => writePreference(PICK_KEY, this.pick));
    $effect(() => writePreference(SEC_KEY, this.section));

    /* A section letter only means something inside the exercise that has it, so moving to
       another exercise drops it: silently keeping 'ד' would send Claude to mark a section
       that is not there. */
    $effect(() => {
      if (this.section && !this.letters.includes(this.section)) {
        this.section = '';
      }
    });

    /* A pick that names an exercise the list no longer has — a room or a device still on
       one of the exam-question exercises removed on 17.09.2026 — moves to its chapter's
       first exercise, rather than passing for "not from the workbook" (whose key is empty)
       and sending Claude to mark a question nobody chose. */
    $effect(() => {
      if (!this.exercise && parts(this.pick)[1] !== '') {
        this.pick = firstOf(this.topic);
      }
    });

    this.syncWithRoom(roomId);
  }

  chooseChapter(id: string): void {
    const t = TOPICS.find((x) => x.id === id);
    if (!t) {
      return;
    }

    this.pick = firstOf(t);
  }

  step(d: 1 | -1): void {
    const i = d > 0 ? Math.floor(this.at) + 1 : Math.ceil(this.at) - 1;
    if (i < 0 || i >= ORDER.length) {
      return;
    }

    this.pick = ORDER[i];
  }

  /* ---- the choice travels with the room, not just the ink -------------------
     The canvas crossed between the devices and the choice did not, which is half a
     room: you pick on the desktop, write on the tablet, and the two now name different
     questions. Worse than untidy — the picker is exactly what "שקלוד יבדוק" sends, so
     a stale device asks Claude to mark the wrong exercise against the wrong criteria,
     without saying so.

     localStorage stays. It is what the picker shows in the moment before Firestore
     answers, and it is the whole answer offline; the room overrides it as soon as it
     speaks.

     `agreed` is the value this device and the room already share, and it is what keeps
     an arriving snapshot from being echoed straight back. It is set BEFORE the state is
     assigned, so the publishing effect sees them equal and does nothing. */
  private syncWithRoom(roomId: string): void {
    let agreed = '';
    /** the room has answered — until it has, this device must not overwrite it */
    let joined = $state(false);

    $effect(() =>
      onSnapshot(pickRef(roomId), (snap) => {
        // An empty room is not a reason to keep quiet — flipping `joined` publishes what
        // this device already had, which is how the first one in seeds the room.
        joined = true;
        if (!snap.exists()) {
          return;
        }

        const d = snap.data() as { pick?: string; section?: string };
        const p = d.pick ?? untrack(() => this.pick);
        const s = d.section ?? '';
        agreed = `${p}\n${s}`;
        this.pick = p;
        this.section = s;
      })
    );

    $effect(() => {
      const now = `${this.pick}\n${this.section}`;
      if (!joined || now === agreed) {
        return;
      }

      agreed = now;
      void save(pickRef(roomId), { pick: this.pick, section: this.section });
    });
  }
}
