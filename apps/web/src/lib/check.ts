/** "I finished — check me": the board and the right marking criteria, handed to Claude.
 *
 * The criteria are not written here. They live in the workbook's `build/content.py`, one
 * `grader` per topic, and `build/graders.py` exports them into `graders.json` next to
 * this file. That matters more than it looks: the workbook teaches a standard and this
 * button marks against one, and two hand-maintained copies of that standard would drift
 * apart quietly, in the direction of whichever one was edited last.
 *
 * Delivery is a Chrome extension rather than an API call, which is what
 * Avi asked for and is also the better shape here — no API key on a public static site,
 * no per-check cost, and the answer lands in a real Claude conversation he can carry on.
 * The page never talks to the extension directly; it posts a message to its own window,
 * the extension's content script hears it, and if no extension is installed the same
 * payload goes to the clipboard instead. The extension itself lives in the workbook repo,
 * at `learn-math-5-units/extension/`, because what it carries is the marking criteria and
 * those are written there; this file is only the page's half of the contract. A page that assumed the extension would be
 * there would be a button that silently does nothing on any other machine.
 */
import graders from './graders.json';
import { blobToBase64, copyImageAndText, pngBlob } from './deliver';

/** A lesson that explains how to solve one exercise.
 *
 *  Avi: "בעבור כל שאלה תוסיף קישורים לסרטונים רלוונטיים שמסבירים איך לפתור", and then
 *  "אבל רק בדסקטופ". Which video belongs to which exercise is decided in the workbook
 *  repo (`build/exvids.py`) and arrives here inside `graders.json`, for the same reason
 *  the marking criteria do: one home, and a page that only displays. `title` and
 *  `author` are YouTube's own words — nothing here is written by hand. */
export interface VideoLink {
  id: string;
  url: string;
  title: string;
  author: string;
  /** length in seconds, so a lesson can say how long it is before it is opened */
  sec: number;
  /** the playlist it was found in — provenance, not shown */
  playlist: string;
}

/** One exercise, exactly as the page shows it.
 *  `tier` is the rung (1 warm-up, 2 middle, 3 bagrut level), `n` its number inside that
 *  rung, and `sections` the lettered parts — empty for the ones that have none. `text`
 *  fences every formula in `$…$`. Only the workbook's own exercises: the ones written from
 *  each real exam question were removed on 17.09.2026 (see build/graders.py). */
export interface Exercise {
  tier: string;
  n: number;
  label: string;
  /** what the row in the list says */
  short: string;
  text: string;
  /** `text` as the page shows it, maths already MathML — added at build time by the
   *  `exercise-html` plugin in vite.config.ts, so it is not in graders.json itself */
  html: string;
  sections: string[];
  /** how to solve it — shown on the desktop only */
  videos: VideoLink[];
}

/** A chapter: one of the workbook's ten blocks, with its criteria as a whole prompt — which
 *  is also what marks "not from the workbook". */
export interface Topic {
  id: string;
  title: string;
  prompt: string;
  exercises: Exercise[];
}

interface Graders {
  blocks: Topic[];
  rungs: Rung[];
  exerciseSlot: string;
  exerciseFormat: Record<'line' | 'section' | 'sectionAll' | 'quote' | 'other', string>;
}
const G = graders as unknown as Graders;

export const TOPICS: Topic[] = G.blocks;

/** The rungs, in order, as the workbook prints them. `rebuild.py` owns the names. */
export interface Rung {
  tier: string;
  name: string;
}
export const RUNG_LIST: Rung[] = G.rungs;

/** How an exercise is addressed in a <select>, in localStorage and in the room. */
export function exKey(e: Exercise): string {
  return `${e.tier}.${e.n}`;
}

/** Naming which exercise, and which section of it.
 *
 *  The topic alone was never enough. A topic holds nine exercises, the rung-3 ones have
 *  lettered sections, and "check my work on fractions" left Claude to work out from the
 *  handwriting which question it was even looking at — while the prompt sends it off to
 *  find an official marking scheme. Fetching one for the wrong question is worse than
 *  fetching none.
 *
 *  The wording is not written here. `build/graders.py` in the workbook exports both the
 *  slot and the phrases, for the same reason it exports the criteria: this page chooses
 *  WHICH exercise, the workbook says HOW it is described. */
const FMT = G.exerciseFormat;

function promptFor(
  topic: Topic,
  exercise: Exercise | null,
  section: string | null
): string {
  return topic.prompt.replace(G.exerciseSlot, describe(exercise, section));
}

/** The words that fill the prompt's exercise slot. */
function describe(exercise: Exercise | null, section: string | null): string {
  if (!exercise) {
    return FMT.other;
  }

  const line = FMT.line.replace('{label}', exercise.label).replace('{section}', sectionPhrase(exercise, section));
  return `${line}\n${FMT.quote.replace('{text}', exercise.text)}`;
}

function sectionPhrase(exercise: Exercise, section: string | null): string {
  if (!exercise.sections.length) {
    return '';
  }

  if (!section) {
    return FMT.sectionAll;
  }

  return FMT.section.replace('{letter}', section);
}

/** The short human label that rides along with the payload — it is what the extension's
 *  banner says, so it has to read as the thing Avi just finished. */
function checkLabel(
  topic: Topic,
  exercise: Exercise | null,
  section: string | null
): string {
  if (!exercise) {
    return topic.title;
  }

  const sec = exercise.sections.length && section ? `, סעיף ${section}` : '';
  return `${topic.title} · ${exercise.label}${sec}`;
}

/** The message the extension listens for. Named, versioned, and matched on both ends. */
const CHECK_MESSAGE = 'avi-math-check@1';

interface CheckPayload {
  type: typeof CHECK_MESSAGE;
  /** the board as a PNG data URL */
  image: string;
  /** the full prompt, criteria included */
  prompt: string;
  topic: string;
}

/** Is the extension listening? It answers a ping by setting this flag on the document.
 *  Asked rather than assumed, because the fallback has to be chosen before the click
 *  does anything the user can see. */
function extensionPresent(): boolean {
  return document.documentElement.dataset.aviMathCheck === 'ready';
}

function requestCheck(payload: CheckPayload): void {
  window.postMessage(payload, location.origin);
}

/** Hand the board and the exercise's criteria to Claude. Returns what to tell the person.
 *
 *  With the extension, a new conversation opens with both already in it. Without it,
 *  everything still goes out, it just needs one paste — which is exactly the flow that
 *  existed before the button, so nothing is lost. */
export async function sendForCheck(
  board: HTMLCanvasElement,
  topic: Topic,
  exercise: Exercise | null,
  section: string | null
): Promise<string> {
  const blob = await pngBlob(board);
  if (!blob) {
    return 'הייצוא נכשל';
  }

  const prompt = promptFor(topic, exercise, section);
  if (extensionPresent()) {
    const image = `data:image/png;base64,${await blobToBase64(blob)}`;
    requestCheck({ type: CHECK_MESSAGE, image, prompt, topic: checkLabel(topic, exercise, section) });
    return 'נשלח לקלוד — נפתחת שיחה חדשה';
  }

  if ((await copyImageAndText(blob, prompt)) === 'both') {
    return 'אין תוסף — התמונה והפרומפט הועתקו, הדבק בקלוד';
  }

  return 'אין תוסף — הפרומפט הועתק. העתק את התמונה בנפרד';
}
