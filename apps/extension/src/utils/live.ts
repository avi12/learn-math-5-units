/** The worker's half of Gemini Live: one session, from the pad's button to the window's
 *  close.
 *
 * Avi: "כפתור שיתחיל את ג'מיני לייב ... תמיד לשים על המסך את הקונטקסט של השאלה ...
 * שכל הקנבס יראה כדי שיוכל לעקוב אחרי התרגיל בזמן אמת" — and the role: "ג'מיני צריך
 * להתנהג כמו מורה פרטי, לעזור לי תוך כדי".
 *
 *   1. START opens the Gemini web client in a small window of its own. The bridge in it
 *      (glic.content.ts) becomes the client's host, and says BOOTED.
 *   2. The brief goes in as a text turn: the bridge empties the text box, this types the
 *      brief into it with trusted key events (the client keeps Submit disabled for
 *      anything else — gemini-live-windows measured that), the bridge submits and waits.
 *      The brief is the tutor's role, the exercise and its criteria, all worded in the
 *      workbook (build/rebuild.py `live_prompt_text`). Gemini takes no system prompt; a
 *      first turn in the same conversation is what Live then keeps in context.
 *   3. Then Live. From here the bridge shows Gemini a new shared tab every second, Gemini
 *      pulls a picture for each, and each one is fetched from the pad tab, which draws it
 *      (apps/web/src/lib/frame.ts) — close up around the pen while it is on the board.
 *   4. That first brief is the ONLY text turn. The first version paused Live for more of
 *      them — a changed exercise, a note — and on the real page Live came back
 *      listening and never answered again (Avi, 14.10.2026). So a changed exercise
 *      (RETARGET) only renames the shared tab; the picture already shows the question.
 *   5. When Gemini says the cue it was taught for "write that down", and has finished the
 *      sentence, the request goes to Gemini's text endpoint BESIDE Live (BridgeCall.ASK)
 *      with both sides of the exchange in it, and the answer goes to the pad as a note.
 *      Live goes on talking the whole time.
 *
 * MV3 kills this worker whenever it likes, so the session lives in `storage.session` and
 * every handler starts by reading it. Pictures every second keep it awake during Live. */
import { orNull, quietly } from './async';
import { askForNote, createCueWatch, type NoteExchange } from '@learn-math/shared/notes';
import {
  LiveState,
  NOTE_FAILED,
  type LiveStart,
  type LiveStatus,
  type LiveTarget,
  type NoteRequest
} from '@learn-math/shared/protocol';
import {
  BridgeCall,
  BridgeFailure,
  BridgeReport,
  Direction,
  ExtensionMessage,
  extensionMessenger,
  GLIC_URL,
  GlicState,
  type TranscriptLine
} from './protocol';

interface Session {
  pad: number;
  glicTab: number;
  glicWindow: number;
  title: string;
  url: string;
  /** a brief still to be typed in — the first, or a changed exercise's */
  brief: string;
  /** the session's brief, kept: a window reloaded after Live broke is a new conversation,
   *  and its first turn is this again */
  briefing: string;
  /** when the window was last reloaded after Live broke, within `RESTART_WINDOW_MS` */
  restarts: number[];
  /** how a note is asked for; null for a session started without one */
  notes: NoteRequest | null;
  booted: boolean;
  state: LiveState;
  detail: string;
}

const KEY = 'live';
/** Live breaking now and then is Gemini's; breaking over and over is something a reload
 *  will not fix, and reloading in a loop would only hide it. */
const MAX_RESTARTS = 3;
const RESTART_WINDOW_MS = 10 * 60_000;
/** The Gemini window: narrow, like the panel the client was built for. */
const WINDOW = { width: 440, height: 760 };

async function load(): Promise<Session | null> {
  const row = await chrome.storage.session.get(KEY);
  return (row[KEY] as Session | undefined) ?? null;
}

async function store(s: Session | null): Promise<void> {
  await (s ? chrome.storage.session.set({ [KEY]: s }) : chrome.storage.session.remove(KEY));
}

/** The session, if `tab` is the one it keeps under `role`: its pad, or its Gemini tab. */
async function sessionOf({ tab, role }: { tab?: chrome.tabs.Tab; role: 'pad' | 'glicTab' }): Promise<Session | null> {
  const s = await load();
  return s && tab?.id !== undefined && s[role] === tab.id ? s : null;
}

/** Tell the pad tab, and remember it for a pad that reloads. */
async function tell({ session, state, detail = '' }: LiveStatus & { session: Session }): Promise<void> {
  session.state = state;
  session.detail = detail;
  await store(session);
  await quietly(extensionMessenger.sendMessage(ExtensionMessage.LIVE_STATUS, { state, detail }, session.pad));
}

/** Type `text` into the focused box of `tabId`, one trusted key at a time. Newlines are
 *  spaces: Enter in that box sends. Attaching shows Chrome's "debugging this browser"
 *  bar for the few seconds it takes; it goes away on detach. */
async function type({ tabId, text }: { tabId: number; text: string }): Promise<void> {
  const target = { tabId };
  await chrome.debugger.attach(target, '1.3');
  try {
    for (const ch of text.replace(/\s+/g, ' ').trim()) {
      await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
        type: 'keyDown',
        text: ch,
        unmodifiedText: ch,
        key: ch
      });
      await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
    }
  } finally {
    await quietly(chrome.debugger.detach(target));
  }
}

/** One text turn in the session's conversation, Live paused around it. Only one at a
 *  time: a second waits for the first, so a brief and a note never type into each other. */
let turn: Promise<unknown> = Promise.resolve();

function textTurn({ prompt, during }: { prompt: string; during: LiveState }) {
  const run = turn.then(async () => {
    const s = await load();
    if (!s) {
      return null;
    }

    await tell({ session: s, state: during });
    try {
      if (!(await orNull(extensionMessenger.sendMessage(BridgeCall.BEGIN_TEXT, undefined, s.glicTab)))) {
        throw new Error('לא נמצאה תיבת הטקסט של ג׳מיני');
      }

      await type({ tabId: s.glicTab, text: prompt });
      return await orNull(extensionMessenger.sendMessage(BridgeCall.SUBMIT, undefined, s.glicTab));
    } catch (e) {
      await tell({ session: s, state: LiveState.FAILED, detail: e instanceof Error ? e.message : String(e) });
      return null;
    } finally {
      await orNull(extensionMessenger.sendMessage(BridgeCall.START, undefined, s.glicTab));
    }
  });
  turn = run.catch(() => {});
  return run;
}

async function brief(): Promise<void> {
  const s = await load();
  if (!s?.brief || !s.booted) {
    return;
  }

  const text = s.brief;
  s.brief = '';
  await store(s);
  await textTurn({ prompt: text, during: LiveState.BRIEFING });
}

async function writeNote(exchange: NoteExchange): Promise<void> {
  const s = await load();
  const n = s?.notes;
  if (!s || !n) {
    return;
  }

  await tell({ session: s, state: LiveState.WRITING });
  const { note, isNone } = await askForNote({
    request: n,
    exchange,
    ask: (prompt) => extensionMessenger.sendMessage(BridgeCall.ASK, prompt, s.glicTab)
  });
  const now = await load();
  if (!now) {
    return;
  }

  if (note) {
    await quietly(extensionMessenger.sendMessage(ExtensionMessage.LIVE_NOTE, note, now.pad));
  }

  // Live never stopped, so it is still what it was before the note.
  if (now.state !== LiveState.WRITING) {
    return;
  }

  const failed = !note && !isNone;
  await tell({
    session: now,
    state: failed ? LiveState.FAILED : LiveState.LIVE,
    detail: failed ? NOTE_FAILED : ''
  });
}

/* ---- what the transcript is listened for ----------------------------------- */

/** One watch for the one session: it waits for the sentence that said the cue to end
 *  (shared/notes.ts), and then the note goes. */
const watch = createCueWatch({ release: (said) => void writeNote(said) });

function heard({ session, direction, text, index }: TranscriptLine & { session: Session }): void {
  if (direction === Direction.USER) {
    watch.user(text);
    return;
  }

  watch.model({ text, index, cue: session.notes?.cue });
}

/* ---- the session's edges --------------------------------------------------- */

async function open({ pad, start }: { pad: chrome.tabs.Tab; start: LiveStart }): Promise<void> {
  const running = await load();
  if (running && (await orNull(chrome.windows.get(running.glicWindow)))) {
    await chrome.windows.update(running.glicWindow, { focused: true });
    return;
  }

  // Beside the pad's own window, at its left edge — the board side in a Hebrew page.
  const at = pad.windowId === undefined ? null : await orNull(chrome.windows.get(pad.windowId));
  const win = await chrome.windows.create({
    url: GLIC_URL,
    type: 'popup',
    ...WINDOW,
    ...(at?.left !== undefined && at.top !== undefined ? { left: at.left + 16, top: at.top + 80 } : {}),
    focused: true
  });
  const tab = win?.tabs?.[0]?.id;
  if (!win?.id || tab === undefined || pad.id === undefined) {
    return;
  }

  const s: Session = {
    pad: pad.id,
    glicTab: tab,
    glicWindow: win.id,
    title: start.title,
    url: pad.url ? new URL(pad.url).origin : '',
    brief: start.prompt,
    briefing: start.prompt,
    restarts: [],
    notes: start.notes ?? null,
    booted: false,
    state: LiveState.OPENING,
    detail: ''
  };
  await tell({ session: s, state: LiveState.OPENING });
}

/** Live broke and did not come back: reload the Gemini window. The bridge and the relay
 *  load again with it, the relay finds the tab is still this session's, the client boots,
 *  and BOOTED briefs the new conversation and goes Live — the same road as the first
 *  start. Not a text turn inside a running session (the rule `textTurn` keeps): the old
 *  session is gone, and this is the first turn of the new one. */
async function restart(s: Session): Promise<void> {
  const now = Date.now();
  s.restarts = (s.restarts ?? []).filter((t) => now - t < RESTART_WINDOW_MS);
  if (s.restarts.length >= MAX_RESTARTS) {
    await tell({ session: s, state: LiveState.FAILED, detail: 'ג׳מיני נופל שוב ושוב — סגור את החלון שלו והתחל שיעור חדש' });
    return;
  }

  s.restarts.push(now);
  s.booted = false;
  s.brief = s.briefing;
  watch.reset();
  await tell({ session: s, state: LiveState.RECONNECTING });
  await quietly(chrome.tabs.reload(s.glicTab));
}

async function end(state: LiveState = LiveState.ENDED): Promise<void> {
  const s = await load();
  if (!s) {
    return;
  }

  await store(null);
  watch.reset();
  await quietly(extensionMessenger.sendMessage(ExtensionMessage.LIVE_STATUS, { state }, s.pad));
}

async function stop(): Promise<void> {
  const s = await load();
  if (!s) {
    return;
  }

  await orNull(extensionMessenger.sendMessage(BridgeCall.STOP, undefined, s.glicTab));
  await end();
  await quietly(chrome.windows.remove(s.glicWindow));
}

/** The exercise changed under the session: a new name for the shared tab, and a new note
 *  request. Live is left alone (step 4 above). */
async function retarget({ pad, target }: { pad: number; target: LiveTarget }): Promise<void> {
  const s = await load();
  if (!s || s.pad !== pad) {
    return;
  }

  s.title = target.title;
  s.notes = target.notes ?? s.notes;
  await store(s);
  const retitle = { title: s.title, url: s.url };
  await quietly(extensionMessenger.sendMessage(ExtensionMessage.GLIC_RETITLE, retitle, s.glicTab));
}

/* ---- what the bridge reports ------------------------------------------------ */

async function booted(s: Session): Promise<void> {
  s.booted = true;
  await store(s);
  // Not awaited: the brief is a text turn of half a minute, and the bridge does not
  // wait on an answer to this report.
  void (s.brief ? brief() : orNull(extensionMessenger.sendMessage(BridgeCall.START, undefined, s.glicTab)));
}

async function stateChanged({ session: s, state }: { session: Session; state: GlicState }): Promise<void> {
  // The brief's text turn and a note in progress have their own state.
  if (s.state === LiveState.BRIEFING || s.state === LiveState.WRITING) {
    return;
  }
  if (state === GlicState.LISTENING) {
    await tell({ session: s, state: LiveState.LIVE });
    return;
  }
  if (state === GlicState.RESUMING) {
    await tell({ session: s, state: LiveState.PAUSED });
  }
}

async function failed({ session: s, message }: { session: Session; message: string }): Promise<void> {
  if (message === BridgeFailure.LIVE_BROKE) {
    await restart(s);
    return;
  }
  if (message === BridgeFailure.SIGNED_OUT || message === BridgeFailure.UNAVAILABLE) {
    await quietly(chrome.windows.update(s.glicWindow, { focused: true }));
    await tell({ session: s, state: LiveState.FAILED, detail: 'צריך להתחבר לגוגל בחלון של ג׳מיני, ואז ללחוץ שוב' });
    return;
  }

  await tell({ session: s, state: LiveState.FAILED, detail: message });
}

export function installLive(): void {
  // From the pad.
  extensionMessenger.onMessage(ExtensionMessage.LIVE_START, ({ data, sender: { tab } }) => {
    if (!tab?.id) {
      return;
    }

    void open({ pad: tab, start: data });
  });
  extensionMessenger.onMessage(ExtensionMessage.LIVE_RETARGET, ({ data, sender: { tab } }) => {
    if (!tab?.id) {
      return;
    }

    void retarget({ pad: tab.id, target: data });
  });
  extensionMessenger.onMessage(ExtensionMessage.LIVE_STOP, ({ sender: { tab } }) => {
    if (!tab?.id) {
      return;
    }

    void stop();
  });

  extensionMessenger.onMessage(ExtensionMessage.PAD_HELLO, async ({ sender: { tab } }) => {
    const s = await sessionOf({ tab, role: 'pad' });
    return s ? { state: s.state, detail: s.detail } : null;
  });

  // From the Gemini tab.
  extensionMessenger.onMessage(ExtensionMessage.GLIC_HELLO, async ({ sender: { tab } }) => {
    const s = await load();
    return { mine: tab?.id !== undefined && s?.glicTab === tab.id, title: s?.title ?? '', url: s?.url ?? '' };
  });

  extensionMessenger.onMessage(ExtensionMessage.GLIC_CAPTURE, async ({ sender: { tab } }) => {
    const s = await sessionOf({ tab, role: 'glicTab' });
    return s ? orNull(extensionMessenger.sendMessage(ExtensionMessage.FRAME, undefined, s.pad)) : null;
  });

  /** A report's handler, run only when the Gemini tab that sent it is the session's. */
  const fromGlic =
    <T>(handle: (report: { session: Session; data: T }) => unknown) =>
    async ({ data, sender: { tab } }: { data: T; sender: { tab?: chrome.tabs.Tab } }) => {
      const session = await sessionOf({ tab, role: 'glicTab' });
      if (!session) {
        return;
      }

      await handle({ session, data });
    };
  extensionMessenger.onMessage(BridgeReport.BOOTED, fromGlic(({ session }) => booted(session)));
  extensionMessenger.onMessage(BridgeReport.READY, fromGlic(({ session }) => tell({ session, state: LiveState.LIVE })));
  extensionMessenger.onMessage(BridgeReport.STATE, fromGlic(({ session, data: state }) => stateChanged({ session, state })));
  extensionMessenger.onMessage(BridgeReport.ERROR, fromGlic(({ session, data: message }) => failed({ session, message })));
  extensionMessenger.onMessage(BridgeReport.TRANSCRIPT, fromGlic(({ session, data: line }) => heard({ session, ...line })));
  extensionMessenger.onMessage(BridgeReport.TURN_END, fromGlic(({ data: index }) => watch.turnEnded(index)));

  // Closing the Gemini window is ending the session; so is closing the pad.
  chrome.windows.onRemoved.addListener((id) => {
    void load().then((s) => (s?.glicWindow === id ? end() : undefined));
  });
  chrome.tabs.onRemoved.addListener((id) => {
    void load().then((s) => (s?.pad === id ? stop() : undefined));
  });
}
