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
 *   3. Then Live. From here Gemini pulls a picture about once a second, and each one is
 *      fetched from the pad tab, which draws it (apps/web/src/lib/frame.ts).
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
import {
  LiveAction,
  LiveState,
  type LiveNote,
  type LiveRequest,
  type NoteRequest
} from '@learn-math/shared/protocol';
import {
  BridgeCall,
  BridgeFailure,
  BridgeUp,
  Direction,
  ExtensionMessage,
  extensionMessenger,
  GLIC_URL,
  GlicState,
  type BridgeReport,
  type TextReply
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
/** The longest a note waits for Gemini to finish the sentence that said the cue. */
const NOTE_WAIT_MS = 15_000;

async function load(): Promise<Session | null> {
  const row = await chrome.storage.session.get(KEY);
  return (row[KEY] as Session | undefined) ?? null;
}

async function store(s: Session | null): Promise<void> {
  await (s ? chrome.storage.session.set({ [KEY]: s }) : chrome.storage.session.remove(KEY));
}

/** Tell the pad tab, and remember it for a pad that reloads. */
async function tell(s: Session, state: LiveState, detail = ''): Promise<void> {
  s.state = state;
  s.detail = detail;
  await store(s);
  await extensionMessenger.sendMessage(ExtensionMessage.LIVE_STATUS, { state, detail }, s.pad).catch(() => {});
}

function call<T>(s: Session, name: BridgeCall, arg?: unknown): Promise<T | null> {
  return extensionMessenger.sendMessage(ExtensionMessage.GLIC_CALL, { name, arg }, s.glicTab).catch(() => null) as Promise<T | null>;
}

/** Type `text` into the focused box of `tabId`, one trusted key at a time. Newlines are
 *  spaces: Enter in that box sends. Attaching shows Chrome's "debugging this browser"
 *  bar for the few seconds it takes; it goes away on detach. */
async function type(tabId: number, text: string): Promise<void> {
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
    await chrome.debugger.detach(target).catch(() => {});
  }
}

/** One text turn in the session's conversation, Live paused around it. Only one at a
 *  time: a second waits for the first, so a brief and a note never type into each other. */
let turn: Promise<unknown> = Promise.resolve();

function textTurn(prompt: string, during: LiveState): Promise<TextReply | null> {
  const run = turn.then(async () => {
    const s = await load();
    if (!s) {
      return null;
    }

    await tell(s, during);
    try {
      if (!(await call<boolean>(s, BridgeCall.BEGIN_TEXT))) {
        throw new Error('לא נמצאה תיבת הטקסט של ג׳מיני');
      }

      await type(s.glicTab, prompt);
      return await call<TextReply>(s, BridgeCall.SUBMIT);
    } catch (e) {
      await tell(s, LiveState.FAILED, e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      await call(s, BridgeCall.START);
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
  await textTurn(text, LiveState.BRIEFING);
}

/** A note out of the answer's markdown: inside a code fence if Gemini used one, the
 *  first line its title, and the markdown's own marks (bold, headings, bullets) dropped —
 *  the pad renders `$…$` and plain lines, nothing else. */
function noteOf(answer: string): LiveNote | null {
  const fenced = /```[a-z]*\n?([\s\S]*?)```/i.exec(answer)?.[1] ?? answer;
  const lines = fenced
    .split('\n')
    .map((l) => l.replace(/^\s*(?:#+|[-*•]|\d+\.)\s+/, '').replace(/\*\*|__/g, '').trim())
    .filter(Boolean);
  if (!lines.length) {
    return null;
  }

  const [title = '', ...rest] = lines;
  return {
    id: crypto.randomUUID(),
    title: rest.length ? title : 'מג׳מיני',
    body: rest.length ? rest.join('\n') : title
  };
}

async function writeNote(heardText: string, saidText: string): Promise<void> {
  const s = await load();
  const n = s?.notes;
  if (!s || !n) {
    return;
  }

  await tell(s, LiveState.WRITING);
  const prompt = n.template.replace(n.heard, heardText).replace(n.said, saidText);
  const answer = (await call<string>(s, BridgeCall.ASK, prompt))?.trim() ?? '';
  // "nothing to write" is an answer, and the right one for a cue said in passing
  const none = answer.replace(/["'.״]/g, '').trim() === n.none;
  const note = answer && !none ? noteOf(answer) : null;
  const now = await load();
  if (!now) {
    return;
  }

  if (note) {
    await extensionMessenger.sendMessage(ExtensionMessage.LIVE_NOTE, note, now.pad).catch(() => {});
  }

  // Live never stopped, so it is still what it was before the note.
  if (now.state === LiveState.WRITING) {
    const failed = !note && !none;
    await tell(now, failed ? LiveState.FAILED : LiveState.LIVE, failed ? 'הפתק לא נכתב — בקש שוב' : '');
  }
}

/* ---- what the transcript is listened for ----------------------------------- */

/** The person's last words, which the note request quotes — as context only: a
 *  transcript of the room can be anything. */
let lastHeard = '';
/** The Gemini utterance that said the cue, and what it has said so far. The note waits
 *  for the sentence to end, because what Gemini says it is writing is what the note is
 *  made from (rebuild.py `live_note_text`). */
let armed = -1;
let saying = '';
/** If the end of the sentence never arrives, the note goes anyway after this long. */
let fallback: ReturnType<typeof setTimeout> | undefined;

function release(): void {
  clearTimeout(fallback);
  if (armed < 0) {
    return;
  }

  const [h, said] = [lastHeard, saying];
  armed = -1;
  saying = '';
  void writeNote(h, said);
}

function heard(s: Session, direction: Direction, text: string, index: number): void {
  if (direction === Direction.USER) {
    lastHeard = text;
    return;
  }

  if (index === armed) {
    saying = text;
    return;
  }

  if (!s.notes?.cue || !new RegExp(s.notes.cue).test(text)) {
    return;
  }

  armed = index;
  saying = text;
  clearTimeout(fallback);
  fallback = setTimeout(release, NOTE_WAIT_MS);
}

function turnEnded(index: number): void {
  if (index === armed) {
    release();
  }
}

/* ---- the session's edges --------------------------------------------------- */

async function open(pad: chrome.tabs.Tab, req: LiveRequest): Promise<void> {
  const running = await load();
  if (running) {
    const alive = await chrome.windows.get(running.glicWindow).catch(() => null);
    if (alive) {
      await chrome.windows.update(running.glicWindow, { focused: true });
      return;
    }
  }

  // Beside the pad's own window, at its left edge — the board side in a Hebrew page.
  const at = pad.windowId === undefined ? null : await chrome.windows.get(pad.windowId).catch(() => null);
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
    title: req.title ?? '',
    url: pad.url ? new URL(pad.url).origin : '',
    brief: req.prompt ?? '',
    briefing: req.prompt ?? '',
    restarts: [],
    notes: req.notes ?? null,
    booted: false,
    state: LiveState.OPENING,
    detail: ''
  };
  await tell(s, LiveState.OPENING);
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
    await tell(s, LiveState.FAILED, 'ג׳מיני נופל שוב ושוב — סגור את החלון שלו והתחל שיעור חדש');
    return;
  }

  s.restarts.push(now);
  s.booted = false;
  s.brief = s.briefing;
  armed = -1;
  saying = '';
  clearTimeout(fallback);
  await tell(s, LiveState.RECONNECTING);
  await chrome.tabs.reload(s.glicTab).catch(() => {});
}

async function end(state: LiveState = LiveState.ENDED): Promise<void> {
  const s = await load();
  if (!s) {
    return;
  }

  await store(null);
  armed = -1;
  saying = '';
  clearTimeout(fallback);
  lastHeard = '';
  await extensionMessenger.sendMessage(ExtensionMessage.LIVE_STATUS, { state }, s.pad).catch(() => {});
}

async function stop(): Promise<void> {
  const s = await load();
  if (!s) {
    return;
  }

  await call(s, BridgeCall.STOP);
  await end();
  await chrome.windows.remove(s.glicWindow).catch(() => {});
}

async function fromBridge(s: Session, m: BridgeReport): Promise<void> {
  switch (m.kind) {
    case BridgeUp.BOOTED:
      s.booted = true;
      await store(s);
      // Not awaited: the brief is a text turn of half a minute, and the bridge does not
      // wait on an answer to this report.
      void (s.brief ? brief() : call(s, BridgeCall.START));
      return;
    case BridgeUp.READY:
      await tell(s, LiveState.LIVE);
      return;
    case BridgeUp.STATE:
      // The brief's text turn and a note in progress have their own state.
      if (s.state === LiveState.BRIEFING || s.state === LiveState.WRITING) {
        return;
      }
      if (m.state === GlicState.LISTENING) {
        await tell(s, LiveState.LIVE);
      } else if (m.state === GlicState.RESUMING) {
        await tell(s, LiveState.PAUSED);
      }
      return;
    case BridgeUp.TRANSCRIPT:
      heard(s, m.direction, m.text, m.index);
      return;
    case BridgeUp.TURN_END:
      turnEnded(m.index);
      return;
    case BridgeUp.ERROR:
      if (m.message === BridgeFailure.LIVE_BROKE) {
        await restart(s);
      } else if (m.message === BridgeFailure.SIGNED_OUT || m.message === BridgeFailure.UNAVAILABLE) {
        await chrome.windows.update(s.glicWindow, { focused: true }).catch(() => {});
        await tell(s, LiveState.FAILED, 'צריך להתחבר לגוגל בחלון של ג׳מיני, ואז ללחוץ שוב');
      } else {
        await tell(s, LiveState.FAILED, m.message || 'ג׳מיני לא עלה');
      }
  }
}

export function installLive(): void {
  /** the session, if `tab` is its Gemini tab */
  const glicSession = async (tab?: chrome.tabs.Tab) => {
    const s = await load();
    return s && tab?.id !== undefined && s.glicTab === tab.id ? s : null;
  };

  // From the pad.
  extensionMessenger.onMessage(ExtensionMessage.LIVE, ({ data: req, sender: { tab } }) => {
    if (!tab?.id) {
      return;
    }

    if (req.action === LiveAction.START) {
      void open(tab, req);
    } else if (req.action === LiveAction.STOP) {
      void stop();
    } else if (req.action === LiveAction.RETARGET) {
      void load().then(async (s) => {
        if (!s || s.pad !== tab.id) {
          return;
        }

        s.title = req.title ?? s.title;
        s.notes = req.notes ?? s.notes;
        await store(s);
        await extensionMessenger.sendMessage(ExtensionMessage.GLIC_RETITLE, { title: s.title, url: s.url }, s.glicTab).catch(() => {});
      });
    }
  });

  extensionMessenger.onMessage(ExtensionMessage.PAD_HELLO, async ({ sender: { tab } }) => {
    const s = await load();
    return s && tab?.id !== undefined && s.pad === tab.id ? { state: s.state, detail: s.detail } : null;
  });

  // From the Gemini tab.
  extensionMessenger.onMessage(ExtensionMessage.GLIC_HELLO, async ({ sender: { tab } }) => {
    const s = await load();
    return { mine: tab?.id !== undefined && s?.glicTab === tab.id, title: s?.title ?? '', url: s?.url ?? '' };
  });

  extensionMessenger.onMessage(ExtensionMessage.GLIC_CAPTURE, async ({ sender: { tab } }) => {
    const s = await glicSession(tab);
    return s ? extensionMessenger.sendMessage(ExtensionMessage.FRAME, undefined, s.pad).catch(() => null) : null;
  });

  extensionMessenger.onMessage(ExtensionMessage.GLIC_REPORT, async ({ data, sender: { tab } }) => {
    const s = await glicSession(tab);
    if (s) {
      await fromBridge(s, data);
    }
  });

  // Closing the Gemini window is ending the session; so is closing the pad.
  chrome.windows.onRemoved.addListener((id) => {
    void load().then((s) => (s?.glicWindow === id ? end() : undefined));
  });
  chrome.tabs.onRemoved.addListener((id) => {
    void load().then((s) => (s?.pad === id ? stop() : undefined));
  });
}
