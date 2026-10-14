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
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const i = ++id;
      pending.set(i, res);
      setTimeout(() => rej(new Error('CDP timeout: ' + method)), 20000);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  const ev = async (x) => {
    const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
    return r?.exceptionDetails ? 'EXC: ' + r.exceptionDetails.text : r?.result?.value;
  };
  return { ws, send, ev, on: (h) => handlers.push(h) };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const targets = async () => (await fetch(`${base}/json/list`)).json();
let bad = 0;
const check = (name, ok, detail = '') => {
  if (!ok) {bad++;}
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(58)} ${detail}`.trimEnd());
};

/** Poll until `get` returns something truthy, or give up. */
async function until(get, ms = 30000, every = 300) {
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
await browser.send('Fetch.enable', { patterns: [{ urlPattern: `${GEMINI}*` }] });
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
  void browser.send('Fetch.fulfillRequest', {
    requestId,
    responseCode: 200,
    responseHeaders: [{ name: 'content-type', value: live || text ? 'text/plain; charset=utf-8' : 'text/html; charset=utf-8' }],
    body
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
await pad.send('Page.enable');
await pad.send('Runtime.enable');
await pad.send('Page.navigate', { url: `${padUrl}/?role=board&room=${room}` });
await wait(8000);
check('the pad is stamped by the extension', (await pad.ev(`document.documentElement.dataset.${PRESENCE_FLAG}`)) === PRESENCE_READY);

const press = (label) =>
  pad.ev(`(() => { const b = [...document.querySelectorAll('.qfoot button')].find((b) => b.textContent.includes(${JSON.stringify(label)}));
    if (!b) return 'no button'; b.click(); return 'clicked'; })()`);
const pressed = Date.now();
check('the Gemini Live button is there and was pressed', (await press('ג׳מיני לייב')) === 'clicked');

// ---- the Gemini window ----
const glicTarget = await until(async () => (await targets()).find((t) => t.url.startsWith(`${GEMINI}glic`)));
check('the worker opened a Gemini window', !!glicTarget, glicTarget?.url ?? 'none');
if (!glicTarget) {
  process.exit(1);
}

const glic = await connect(glicTarget.webSocketDebuggerUrl);
await glic.send('Runtime.enable');
const log = () => glic.ev(`JSON.stringify(window.__log ?? [])`).then((s) => (s?.startsWith('[') ? JSON.parse(s) : []));
check('the client adopted our host', !!(await until(async () => (await log()).includes('init'))));

const prompts = await until(async () => {
  const p = await glic.ev(`JSON.stringify(window.__prompts ?? [])`);
  const a = p?.startsWith('[') ? JSON.parse(p) : [];
  return a.length ? a : null;
}, 60000);
check('the brief was typed with trusted keys and sent', !!prompts?.[0]?.includes('בוחן בגרות'),
  prompts ? `${prompts[0].length} chars` : 'nothing submitted');
check('…with the exercise in it', !!prompts?.[0]?.includes('התרגיל:'));
check('…on one line, so Enter could not send it early', !!prompts && !prompts[0].includes('\n'));

check('then Live', !!(await until(async () => (await log()).includes('mode:live'))),
  `${((Date.now() - pressed) / 1000).toFixed(1)}s from the button, brief included`);
const flags = await glic.ev(`Object.values(window.default_BardChatUi).filter((f) => f.defaultValue === 86400 || f.defaultValue === 86400000).length`);
check("Live's four timeouts were rewritten first", flags === 4, `${flags} of 4`);

const frames = await until(async () => {
  const f = await glic.ev(`JSON.stringify(window.__frames)`);
  const a = f?.startsWith('[') ? JSON.parse(f) : [];
  return a.filter(Boolean).length >= 2 ? a : null;
}, 20000);
const shot = frames?.find(Boolean);
check('Gemini is handed a picture a second, drawn by the pad', !!shot && shot[0] === 1600 && shot[1] === 900 && shot[2] > 20000,
  shot ? `${shot[0]}x${shot[1]} ${shot[3]}, ${Math.round(shot[2] / 1024)} KB` : 'none');
const tab = JSON.parse((await glic.ev(`JSON.stringify(window.__tab ?? null)`)) || 'null');
check('the shared tab is named for the exercise', !!tab?.title && tab.url === new URL(padUrl).origin, tab?.title ?? '');

const status = await until(async () => {
  const s = await pad.ev(`document.querySelector('.qfoot .lstate')?.textContent ?? ''`);
  return s.includes('מקשיב') ? s : null;
});
check('the pad says Gemini is listening', !!status, status ?? '');

/** Was the stand-in ever put back into text mode after Live began? */
const paused = async () => {
  const l = await log();
  return l.slice(l.indexOf('mode:live')).includes('mode:text');
};

// ---- a new exercise mid-session: the shared tab renamed, Live left alone ----
const titleBefore = tab?.title ?? '';
await pad.ev(`(() => { const b = [...document.querySelectorAll('.steps button')].find((b) => b.textContent.includes('הבא'));
  b?.click(); return !!b; })()`);
const renamed = await until(async () => {
  const t = JSON.parse((await glic.ev(`JSON.stringify(window.__tab ?? null)`)) || 'null');
  return t?.title && t.title !== titleBefore ? t.title : null;
}, 15000);
check('a new exercise renames the shared tab', !!renamed?.includes('תרגיל 2'), renamed ?? 'unchanged');
await wait(5000);
const typed = JSON.parse((await glic.ev(`JSON.stringify(window.__prompts ?? [])`)) || '[]');
check('…and is not typed in as another brief', typed.length === 1, `${typed.length} text turns`);
check('…so Live was never paused for it', !(await paused()));

// ---- the cue, and the note ----
await glic.ev(`window.__say('formula'), 1`);
const note = await until(async () => {
  const t = await pad.ev(`document.querySelector('.notes .note h3')?.textContent ?? ''`);
  return t || null;
}, 45000);
const req = asked.at(-1);
const fReq = req?.get('f.req') ?? '';
check('the cue in Gemini\'s words asks for a note beside Live', req?.get('at') === 'AT_STAND_IN',
  req ? 'signed with the page\'s own token' : 'nothing asked');
check('…quoting both sides, Gemini\'s whole sentence included',
  fReq.includes(EXCHANGES.formula.heard) && fReq.includes(EXCHANGES.formula.said));
check('…for the exercise now on the board', fReq.includes('תרגיל 2'));
check('its answer lands on the pad as a note, markdown stripped', note === 'נוסחת השורשים', note ?? 'none');
check('typeset', (await pad.ev(`document.querySelectorAll('.notes .note math').length`)) >= 1);
check('and Live was never paused for it', !(await paused()));
const after = await until(async () => {
  const s = await pad.ev(`document.querySelector('.qfoot .lstate')?.textContent ?? ''`);
  return s.includes('מקשיב') ? s : null;
}, 8000);
check('the pad says Gemini is listening again', !!after, after ?? '');

// ---- the cue said in passing, over a line of noise: no note ----
const notesBefore = await pad.ev(`document.querySelectorAll('.notes .note').length`);
const askedBefore = asked.length;
await glic.ev(`window.__say('noise'), 1`);
await until(async () => asked.length > askedBefore, 20000);
await wait(3000);
check('a cue said in passing still asks', asked.length > askedBefore);
check('…but "nothing to write" puts nothing on the board',
  (await pad.ev(`document.querySelectorAll('.notes .note').length`)) === notesBefore,
  `${notesBefore} note(s) before and after`);
const calm = await pad.ev(`document.querySelector('.qfoot .lstate')?.textContent ?? ''`);
check('…and is not reported as a failure', calm.includes('מקשיב'), calm);

// ---- Live breaks mid-session: "Something went wrong", and "Try again" does not help ----
const lstate = () => pad.ev(`document.querySelector('.qfoot .lstate')?.textContent ?? ''`);
// every status the pad shows from here, however briefly — the stand-in reloads in an instant
await pad.ev(`(() => {
  window.__states = [];
  const el = document.querySelector('.qfoot .lstate');
  new MutationObserver(() => window.__states.push(el.textContent)).observe(el, { childList: true, characterData: true, subtree: true });
  return 1; })()`);
await glic.ev(`window.__break(), 1`);
check('Live broken: its own "Try again" is tried first',
  !!(await until(async () => (await log()).includes('try-again'), 12000)));
const reconnecting = await until(async () => {
  const seen = JSON.parse(await pad.ev(`JSON.stringify(window.__states)`));
  return seen.find((t) => t.includes('מתחבר מחדש')) ?? null;
}, 30000);
check('…and when that does not bring it back, the pad says it is reconnecting', !!reconnecting, reconnecting ?? '');
const rebriefed = await until(async () => {
  const l = await log();
  const p = await glic.ev(`JSON.stringify(window.__prompts ?? [])`);
  const a = p?.startsWith('[') ? JSON.parse(p) : [];
  return !l.includes('try-again') && l.includes('mode:live') && a.length === 1 ? a : null;
}, 60000);
check('the Gemini window is reloaded, briefed as a new conversation, and back in Live',
  !!rebriefed?.[0]?.includes('בוחן בגרות'));
const relistening = await until(async () => ((await lstate()).includes('מקשיב') ? lstate() : null), 15000);
check('the pad says Gemini is listening again', !!relistening, relistening ?? '');
const reframes = await until(async () => {
  const f = await glic.ev(`JSON.stringify(window.__frames)`);
  return f?.startsWith('[') && JSON.parse(f).filter(Boolean).length ? f : null;
}, 15000);
check('and Gemini sees the board again', !!reframes);

// ---- the end ----
check('the end button is offered', (await press('סיום השיעור')) === 'clicked');
const gone = await until(async () => !(await targets()).some((t) => t.url.startsWith(GEMINI)), 10000);
check('…and closes the Gemini window', !!gone);
const ended = await until(async () => {
  const s = await pad.ev(`[...document.querySelectorAll('.qfoot button')].map((b) => b.textContent).join('|')`);
  return s.includes('ג׳מיני לייב') ? s : null;
}, 5000);
check('the pad is back to a start button', !!ended);

console.log(`\n(${served} requests to gemini.google.com answered here)`);
console.log(bad ? `${bad} FAILED` : 'the Live chain holds end to end');
process.exit(bad ? 1 : 0);
