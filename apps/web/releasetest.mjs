/** Does a deploy actually reach an open tab, and does it wait for the pen?
 *
 *   node releasetest.mjs <url> <debug-port>
 *
 * Run it against the LIVE site, right after a deploy: the mechanism IS the Firestore
 * document the deploy writes, and there is no local stand-in for that. The test stamps a
 * fake build id of its own and puts the real one back at the end, so the site is left
 * exactly as it was found.
 *
 * Three things are checked, and the third is the one that matters on a tablet:
 *   1. a tab on the current build sits still — the first snapshot always arrives, and
 *      reloading on it would mean reloading on every open;
 *   2. a tab on an older build says so and reloads by itself;
 *   3. it does NOT reload while the pen is on the glass.
 */
import { execFileSync } from 'node:child_process';

const [, , url, port] = process.argv;
const PROJECT = 'avi-math-study';
const ACCOUNT = 'you@example.com';

// gcloud on Windows is a .cmd shim, and node refuses to spawnSync a .cmd directly
// (EINVAL) — it has to go through the shell.
const token = () =>
  execFileSync(`gcloud auth print-access-token --account=${ACCOUNT}`, {
    shell: true
  })
    .toString()
    .trim();

const DOC = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/meta/release`;

async function readBuild() {
  const r = await fetch(DOC, { headers: { Authorization: 'Bearer ' + token() } });
  const j = await r.json();
  return j.fields?.build?.stringValue ?? '';
}

async function stamp(build) {
  const r = await fetch(`${DOC}?updateMask.fieldPaths=build`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + token(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { build: { stringValue: build } } })
  });
  if (!r.ok) throw new Error('stamp failed: ' + r.status + ' ' + (await r.text()).slice(0, 200));
}

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (m, p = {}) =>
  new Promise((r, j) => {
    const i = ++id;
    pending.set(i, r);
    setTimeout(() => j(new Error('CDP timeout: ' + m)), 20000);
    ws.send(JSON.stringify({ id: i, method: m, params: p }));
  });
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result ?? m.error);
    pending.delete(m.id);
  }
};
await new Promise((r) => (ws.onopen = r));
await send('Page.enable');
await send('Runtime.enable');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true });
  return r?.exceptionDetails ? 'EXC ' + r.exceptionDetails.text : r.result?.value;
};

let bad = 0;
const check = (name, ok, detail = '') => {
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(48)} ${detail}`);
};

const live = await readBuild();
console.log('      live build:', live);

await send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 820, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url });
await wait(9000);

/** A value that only survives as long as the document does. */
const mark = () => ev('window.__alive = 1');
const alive = () => ev('window.__alive === 1');
const toast = () => ev('document.querySelector(".toast")?.textContent?.trim() ?? ""');

await mark();
await wait(6000);
check('a tab on the current build sits still', await alive(), 'no reload after 6s');

try {
  // ---- 3: the pen holds the page ------------------------------------------
  // Press and hold, so onpen(true) has fired and never fired false.
  const rect = JSON.parse(await ev('JSON.stringify(document.querySelector("canvas").getBoundingClientRect())'));
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
    button: 'left',
    buttons: 1,
    clickCount: 1
  });
  await stamp('pretend-' + Date.now().toString(36));
  await wait(7000);
  check('the pen on the glass holds the page', await alive(), 'still here after 7s with the pen down');
  check('but the tab has been told', (await toast()).includes('גרסה חדשה'), JSON.stringify(await toast()));

  // ---- 2: pen up, and it goes ---------------------------------------------
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
    button: 'left',
    buttons: 0,
    clickCount: 1
  });
  await wait(9000);
  check('pen up, and the tab reloads itself', !(await alive()), 'the marker is gone');
} finally {
  await stamp(live);
  console.log('      restored build:', await readBuild());
}

console.log(bad ? `\n${bad} FAILED` : '\nall checks passed');
ws.close();
process.exit(bad ? 1 : 0);
