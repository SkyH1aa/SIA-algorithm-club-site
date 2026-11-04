// 配图排版自检：溢出、越界、对比度。
import fs from 'node:fs';

const url = process.argv[2];
const port = process.env.CDP_PORT || 9333;
const targets = await fetch(`http://127.0.0.1:${port}/json`).then(r => r.json());
const target = targets.find(t => t.type === 'page');
const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
let seq = 0;
socket.addEventListener('message', e => {
  const m = JSON.parse(String(e.data));
  if (!m.id || !pending.has(m.id)) return;
  const { res, rej } = pending.get(m.id);
  pending.delete(m.id);
  m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
});
await new Promise((res, rej) => { socket.addEventListener('open', res, { once: true }); socket.addEventListener('error', rej, { once: true }); });
const call = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); socket.send(JSON.stringify({ id, method, params })); });

await call('Page.enable');
await call('Runtime.enable');
await call('Emulation.setDeviceMetricsOverride', { width: 1200, height: 1200, deviceScaleFactor: 1, mobile: false });
await call('Page.navigate', { url });
await new Promise(r => setTimeout(r, 2500));
await call('Runtime.evaluate', { expression: 'document.fonts.ready.then(()=>true)', awaitPromise: true, returnByValue: true });

const script = fs.readFileSync(new URL('./audit-inline.js', import.meta.url), 'utf8');
const out = await call('Runtime.evaluate', { expression: script, returnByValue: true, awaitPromise: true });
console.log(JSON.stringify(out.result.value, null, 2));
socket.close();
