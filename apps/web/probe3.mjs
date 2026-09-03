const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const page = list.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map(); const out = [];
const send = (m, p = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') out.push('EXCEPTION: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 400));
  if (m.method === 'Runtime.consoleAPICalled') out.push('console.' + m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description).join(' ').slice(0, 300));
};
await new Promise(r => ws.onopen = r);
await send('Runtime.enable'); await send('Page.enable');
await send('Page.navigate', { url: process.argv[2] });
await new Promise(r => setTimeout(r, 10000));
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true })).result?.value;
console.log('empty:', await ev('document.body.innerText.includes("אין עדיין כלום")'));
console.log('firestore reqs:', await ev('performance.getEntriesByType("resource").map(r=>r.name).filter(n=>/firestore\.googleapis/.test(n)).length'));
out.forEach(l => console.log(l));
ws.close();
