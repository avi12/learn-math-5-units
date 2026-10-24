/** Gemini Live, the extension's half, in a real browser with the extension loaded.
 *
 *   PAD_ORIGIN=http://localhost:4173 pnpm run build     (so pad.content.ts matches it)
 *   pnpm --filter @learn-math/web run preview           (the pad, on that origin)
 *   <cft> --headless=new --remote-debugging-port=<port> --user-data-dir=<fresh dir> \
 *         --disable-extensions-except=<abs .output/chrome-mv3> --load-extension=<same> about:blank
 *   node livechain.mjs <pad-url> <debug-port>
 *
 * Chrome for Testing, as chaintest.mjs explains: branded Chrome ignores --load-extension.
 *
 * gemini.google.com is answered by this script, not by Google: every request to it is
 * caught at the browser and given `glic.test.html` — a stand-in that behaves like the
 * real client where the bridge depends on it (read its header) — and the Live downlink
 * the bridge taps, and the text request a note is asked with, are answered in the real
 * framing. So this covers every hop that is OURS:
 *
 *   pad button → content script → worker → a Gemini window → relay → bridge → the
 *   client adopts our host → the brief typed in with TRUSTED keys (the stand-in's Submit
 *   stays disabled otherwise) → Live → a picture a second, drawn by the pad → a new
 *   exercise renames the shared tab WITHOUT pausing Live → the cue in the transcript →
 *   a text request beside Live → a note on the pad → the end button closes it all.
 *
 * "Without pausing Live" is the point of two of those checks. Pausing it for a text
 * turn left the real Live listening and silent (14.10.2026), so after the opening brief
 * the stand-in must never be switched to text mode again.
 *
 * What it cannot cover is Google's page itself: a login, and the thing that will one day
 * change. When that happens the bridge's vocabulary (button labels, flag keys, the wire
 * framing) is named once, at the top of glic.content.ts.
 */
import { readFileSync } from 'node:fs';
import { PRESENCE_FLAG, PRESENCE_READY } from '@learn-math/shared/protocol';

const [, , padUrl, port] = process.argv;
if (!padUrl || !port) {
  console.log('usage: node livechain.mjs <pad-url> <debug-port>');
  process.exit(2);
}

const base = `http://127.0.0.1:${port}`;
/** Everything Google serves here is answered below; the client itself lives under /glic. */
const GEMINI = 'https://gemini.google.com/';
const STUB = readFileSync(new URL('./glic.test.html', import.meta.url), 'utf8');

/** One CDP session. `on` hears events. */
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const handlers = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m.error ? { error: m.error } : m.result);
      pending.delete(m.id);
    } else if (m.method) {
      for (const h of handlers) {h(m);}
    }
  };
  await new Promise((r) => (ws.onopen = r));
  const send = ({ method, params = {} }) =>
    new Promise((res, rej) => {
      const i = ++id;
      pending.set(i, res);
      setTimeout(() => rej(new Error('CDP timeout: ' + method)), 20000);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  const ev = async (x) => {
    const r = await send({ method: 'Runtime.evaluate', params: { expression: x, returnByValue: true, awaitPromise: true } });
    return r?.exceptionDetails ? 'EXC: ' + r.exceptionDetails.text : r?.result?.value;
  };
  return { ws, send, ev, on: (h) => handlers.push(h) };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const targets = async () => (await fetch(`${base}/json/list`)).json();
let bad = 0;
const check = ({ name, ok, detail = '' }) => {
  if (!ok) {bad++;}
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(58)} ${detail}`.trimEnd());
};

/** Poll until `get` returns something truthy, or give up. */
async function until({ get, ms = 30000, every = 300 }) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await get();
    if (v || Date.now() > end) {return v;}
    await wait(every);
  }
}

/** Two exchanges the Live wire carries. `formula` is the one the feature is for. `noise`
 *  is Avi's screenshot of 14.10.2026: a line of German nobody said, transcribed from the
 *  room, and Gemini saying the cue on its own, for a "summary sentence" — the version
 *  that wrote from the transcript alone put both on the board as a note. */
const EXCHANGES = {
  formula: { heard: 'תזכיר לי מה נוסחת השורשים', said: 'בטח, רושם לך על הלוח את נוסחת השורשים.' },
  noise: { heard: 'Was ist? Das war das war ein lustiger Tag, sie da', said: 'רושם לך על הלוח משפט סיכום.' }
};

/** The note Gemini "writes", as the text endpoint frames an answer: `)]}'`, then a byte
 *  count and a JSON line whose `wrb.fr` row wraps the response as a string, the text at
 *  [4][0][1][0]. Markdown, as Gemini really answers — the worker strips it. To the noise,
 *  the answer the request offers for nothing to write. */
function answer(fReq) {
  const text = fReq.includes('Was ist')
    ? 'אין'
    : '**נוסחת השורשים**\n$x_{1,2}=\\frac{-b\\pm\\sqrt{b^{2}-4ac}}{2a}$';
  const row = JSON.stringify([['wrb.fr', null, JSON.stringify([null, null, null, null, [['rc_1', [text]]]])]]);
  return `)]}'\n\n${row.length}\n${row}\n`;
}

/** The Live downlink, framed as `<length>\n<chunk>` with the length in UTF-16 units. The
 *  sentence that says the cue arrives in two fragments, as speech does, and ends with a
 *  generation-complete: the note is to be made from all of it, not its first words. */
function downlink(url) {
  const { heard, said } = EXCHANGES[new URL(url).searchParams.get('say') ?? 'formula'];
  const cut = said.indexOf(' ', said.indexOf('הלוח'));
  const msgs = [
    ['3', null, null, null, null, null, null, [null, [heard]]],
    ['4', [null, null, null, null, null, [said.slice(0, cut), 0, 0, 1]]],
    ['5', [null, null, null, null, null, [said.slice(cut), 0, 0, 0]]],
    ['6', [null, null, []]]
  ];
  return msgs
    .map((m) => JSON.stringify([[1, [[null, m]]]]))
    .map((chunk) => `${chunk.length}\n${chunk}`)
    .join('');
}

// ---- every gemini.google.com request is ours to answer ----
const version = await (await fetch(`${base}/json/version`)).json();
const browser = await connect(version.webSocketDebuggerUrl);
await browser.send({ method: 'Fetch.enable', params: { patterns: [{ urlPattern: `${GEMINI}*` }] } });
let served = 0;
/** the text requests asked beside Live, as their form bodies */
const asked = [];
browser.on((m) => {
  if (m.method !== 'Fetch.requestPaused') {return;}
  const { requestId, request } = m.params;
  const live = request.url.includes('/v1/processSession');
  const text = request.url.includes('/StreamGenerate');
  if (text) {
    asked.push(new URLSearchParams(request.postData ?? ''));
  }
  served++;
  const body = Buffer.from(
    live ? downlink(request.url) : text ? answer(asked.at(-1)?.get('f.req') ?? '') : STUB,
    'utf8'
  ).toString('base64');
  void browser.send({
    method: 'Fetch.fulfillRequest',
    params: {
      requestId,
      responseCode: 200,
      responseHeaders: [{ name: 'content-type', value: live || text ? 'text/plain; charset=utf-8' : 'text/html; charset=utf-8' }],
      body
    }
  });
});

// ---- the pad ----
const room = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
const blank = (await targets()).find((t) => t.type === 'page' && t.url === 'about:blank');
if (!blank) {
  console.log('no about:blank page target — start the browser as the header describes');
  process.exit(1);
}

const pad = await connect(blank.webSocketDebuggerUrl);
await pad.send({ method: 'Page.enable' });
await pad.send({ method: 'Runtime.enable' });
await pad.send({ method: 'Page.navigate', params: { url: `${padUrl}/?role=board&room=${room}` } });
await wait(8000);
check({ name: 'the pad is stamped by the extension', ok: (await pad.ev(`document.documentElement.dataset.${PRESENCE_FLAG}`)) === PRESENCE_READY });

const press = (label) =>
  pad.ev(`(() => { const b = [...document.querySelectorAll('.qfoot button')].find((b) => b.textContent.includes(${JSON.stringify(label)}));
    if (!b) return 'no button'; b.click(); return 'clicked'; })()`);
const pressed = Date.now();
check({ name: 'the Gemini Live button is there and was pressed', ok: (await press('ג׳מיני לייב')) === 'clicked' });

// ---- the Gemini window ----
const glicTarget = await until({ get: async () => (await targets()).find((t) => t.url.startsWith(`${GEMINI}glic`)) });
check({ name: 'the worker opened a Gemini window', ok: !!glicTarget, detail: glicTarget?.url ?? 'none' });
if (!glicTarget) {
  process.exit(1);
}

const glic = await connect(glicTarget.webSocketDebuggerUrl);
await glic.send({ method: 'Runtime.enable' });
const log = () => glic.ev(`JSON.stringify(window.__log ?? [])`).then((s) => (s?.startsWith('[') ? JSON.parse(s) : []));
check({ name: 'the client adopted our host', ok: !!(await until({ get: async () => (await log()).includes('init') })) });

const prompts = await until({
  async get() {
    const p = await glic.ev(`JSON.stringify(window.__prompts ?? [])`);
    const a = p?.startsWith('[') ? JSON.parse(p) : [];
    return a.length ? a : null;
  },
  ms: 60000
});
check({
  name: 'the brief was typed with trusted keys and sent',
  ok: !!prompts?.[0]?.includes('בוחן בגרות'),
  detail: prompts ? `${prompts[0].length} chars` : 'nothing submitted'
});
check({ name: '…with the exercise in it', ok: !!prompts?.[0]?.includes('התרגיל:') });
check({ name: '…on one line, so Enter could not send it early', ok: !!prompts && !prompts[0].includes('\n') });

check({
  name: 'then Live',
  ok: !!(await until({ get: async () => (await log()).includes('mode:live') })),
  detail: `${((Date.now() - pressed) / 1000).toFixed(1)}s from the button, brief included`
});
const flags = await glic.ev(`Object.values(window.default_BardChatUi).filter((f) => f.defaultValue === 86400 || f.defaultValue === 86400000).length`);
check({ name: "Live's four timeouts were rewritten first", ok: flags === 4, detail: `${flags} of 4` });

const frames = await until({
  async get() {
    const f = await glic.ev(`JSON.stringify(window.__frames)`);
    const a = f?.startsWith('[') ? JSON.parse(f) : [];
    return a.filter(Boolean).length >= 2 ? a : null;
  },
  ms: 20000
});
const shot = frames?.find(Boolean);
check({
  name: 'Gemini is handed a picture a second, drawn by the pad',
  ok: !!shot && shot[0] === 1600 && shot[1] === 900 && shot[2] > 20000,
  detail: shot ? `${shot[0]}x${shot[1]} ${shot[3]}, ${Math.round(shot[2] / 1024)} KB` : 'none'
});
// The stand-in pulls a picture only for a shared tab it has not seen, as the real client
// does — so the pictures keep coming only if the bridge keeps announcing new ones.
const shown = async () => glic.ev(`window.__frames.filter(Boolean).length`);
const shownBefore = await shown();
await wait(5000);
const shownSince = (await shown()) - shownBefore;
check({ name: '…and keeps getting one, every second', ok: shownSince >= 4, detail: `${shownSince} in 5 s` });
const tab = JSON.parse((await glic.ev(`JSON.stringify(window.__tab ?? null)`)) || 'null');
check({ name: 'the shared tab is named for the exercise', ok: !!tab?.title && tab.url === new URL(padUrl).origin, detail: tab?.title ?? '' });

const status = await until({
  async get() {
    const s = await pad.ev(`document.querySelector('.qfoot .lstate')?.textContent ?? ''`);
    return s.includes('מקשיב') ? s : null;
  }
});
check({ name: 'the pad says Gemini is listening', ok: !!status, detail: status ?? '' });

/** Was the stand-in ever put back into text mode after Live began? */
const paused = async () => {
  const l = await log();
  return l.slice(l.indexOf('mode:live')).includes('mode:text');
};

// ---- a new exercise mid-session: the shared tab renamed, Live left alone ----
const titleBefore = tab?.title ?? '';
await pad.ev(`(() => { const b = [...document.querySelectorAll('.steps button')].find((b) => b.textContent.includes('הבא'));
  b?.click(); return !!b; })()`);
const renamed = await until({
  async get() {
    const t = JSON.parse((await glic.ev(`JSON.stringify(window.__tab ?? null)`)) || 'null');
    return t?.title && t.title !== titleBefore ? t.title : null;
  },
  ms: 15000
});
check({ name: 'a new exercise renames the shared tab', ok: !!renamed?.includes('תרגיל 2'), detail: renamed ?? 'unchanged' });
await wait(5000);
const typed = JSON.parse((await glic.ev(`JSON.stringify(window.__prompts ?? [])`)) || '[]');
check({ name: '…and is not typed in as another brief', ok: typed.length === 1, detail: `${typed.length} text turns` });
check({ name: '…so Live was never paused for it', ok: !(await paused()) });

// ---- the cue, and the note ----
await glic.ev(`window.__say('formula'), 1`);
const note = await until({
  async get() {
    const t = await pad.ev(`document.querySelector('.notes .note h3')?.textContent ?? ''`);
    return t || null;
  },
  ms: 45000
});
const req = asked.at(-1);
const fReq = req?.get('f.req') ?? '';
check({
  name: 'the cue in Gemini\'s words asks for a note beside Live',
  ok: req?.get('at') === 'AT_STAND_IN',
  detail: req ? 'signed with the page\'s own token' : 'nothing asked'
});
check({
  name: '…quoting both sides, Gemini\'s whole sentence included',
  ok: fReq.includes(EXCHANGES.formula.heard) && fReq.includes(EXCHANGES.formula.said)
});
check({ name: '…for the exercise now on the board', ok: fReq.includes('תרגיל 2') });
check({ name: 'its answer lands on the pad as a note, markdown stripped', ok: note === 'נוסחת השורשים', detail: note ?? 'none' });
check({ name: 'typeset', ok: (await pad.ev(`document.querySelectorAll('.notes .note math').length`)) >= 1 });
check({ name: 'and Live was never paused for it', ok: !(await paused()) });
const after = await until({
  async get() {
    const s = await pad.ev(`document.querySelector('.qfoot .lstate')?.textContent ?? ''`);
    return s.includes('מקשיב') ? s : null;
  },
  ms: 8000
});
check({ name: 'the pad says Gemini is listening again', ok: !!after, detail: after ?? '' });

// ---- the cue said in passing, over a line of noise: no note ----
const notesBefore = await pad.ev(`document.querySelectorAll('.notes .note').length`);
const askedBefore = asked.length;
await glic.ev(`window.__say('noise'), 1`);
await until({ get: async () => asked.length > askedBefore, ms: 20000 });
await wait(3000);
check({ name: 'a cue said in passing still asks', ok: asked.length > askedBefore });
check({
  name: '…but "nothing to write" puts nothing on the board',
  ok: (await pad.ev(`document.querySelectorAll('.notes .note').length`)) === notesBefore,
  detail: `${notesBefore} note(s) before and after`
});
const calm = await pad.ev(`document.querySelector('.qfoot .lstate')?.textContent ?? ''`);
check({ name: '…and is not reported as a failure', ok: calm.includes('מקשיב'), detail: calm });

// ---- Live breaks mid-session: "Something went wrong", and "Try again" does not help ----
const lstate = () => pad.ev(`document.querySelector('.qfoot .lstate')?.textContent ?? ''`);
// every status the pad shows from here, however briefly — the stand-in reloads in an instant
await pad.ev(`(() => {
  window.__states = [];
  const el = document.querySelector('.qfoot .lstate');
  new MutationObserver(() => window.__states.push(el.textContent)).observe(el, { childList: true, characterData: true, subtree: true });
  return 1; })()`);
await glic.ev(`window.__break(), 1`);
check({
  name: 'Live broken: its own "Try again" is tried first',
  ok: !!(await until({ get: async () => (await log()).includes('try-again'), ms: 12000 }))
});
const reconnecting = await until({
  async get() {
    const seen = JSON.parse(await pad.ev(`JSON.stringify(window.__states)`));
    return seen.find((t) => t.includes('מתחבר מחדש')) ?? null;
  },
  ms: 30000
});
check({ name: '…and when that does not bring it back, the pad says it is reconnecting', ok: !!reconnecting, detail: reconnecting ?? '' });
const rebriefed = await until({
  async get() {
    const l = await log();
    const p = await glic.ev(`JSON.stringify(window.__prompts ?? [])`);
    const a = p?.startsWith('[') ? JSON.parse(p) : [];
    return !l.includes('try-again') && l.includes('mode:live') && a.length === 1 ? a : null;
  },
  ms: 60000
});
check({
  name: 'the Gemini window is reloaded, briefed as a new conversation, and back in Live',
  ok: !!rebriefed?.[0]?.includes('בוחן בגרות')
});
const relistening = await until({ get: async () => ((await lstate()).includes('מקשיב') ? lstate() : null), ms: 15000 });
check({ name: 'the pad says Gemini is listening again', ok: !!relistening, detail: relistening ?? '' });
const reframes = await until({
  async get() {
    const f = await glic.ev(`JSON.stringify(window.__frames)`);
    return f?.startsWith('[') && JSON.parse(f).filter(Boolean).length ? f : null;
  },
  ms: 15000
});
check({ name: 'and Gemini sees the board again', ok: !!reframes });

// ---- the end ----
check({ name: 'the end button is offered', ok: (await press('סיום השיעור')) === 'clicked' });
const gone = await until({ get: async () => !(await targets()).some((t) => t.url.startsWith(GEMINI)), ms: 10000 });
check({ name: '…and closes the Gemini window', ok: !!gone });
const ended = await until({
  async get() {
    const s = await pad.ev(`[...document.querySelectorAll('.qfoot button')].map((b) => b.textContent).join('|')`);
    return s.includes('ג׳מיני לייב') ? s : null;
  },
  ms: 5000
});
check({ name: 'the pad is back to a start button', ok: !!ended });

console.log(`\n(${served} requests to gemini.google.com answered here)`);
console.log(bad ? `${bad} FAILED` : 'the Live chain holds end to end');
process.exit(bad ? 1 : 0);
