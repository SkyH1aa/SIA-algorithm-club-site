import fs from 'node:fs';
const base = process.argv[2] || 'http://127.0.0.1:4173/tools/test-gomoku-v10ultra-browser.html?single=1&color=1';
const outputPath = process.argv[3];
const targets = await fetch('http://127.0.0.1:9222/json').then(r => r.json());
const target = targets.find(item => item.type === 'page');
if (!target) throw new Error('Chrome page target unavailable');
const socket = new WebSocket(target.webSocketDebuggerUrl);
let sequence = 0;
const pending = new Map();
socket.addEventListener('message', event => {
  const message = JSON.parse(String(event.data));
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(JSON.stringify(message.error)));
    else resolve(message.result);
  }
});
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, {once:true}); socket.addEventListener('error', reject, {once:true}); });
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
await call('Page.enable');
await call('Runtime.enable');
await call('Page.navigate', { url: base });
const started = Date.now();
let output = '';
let title = '';
// V10 may use its full production per-move budget on difficult positions.
// Allow a complete long game to finish before treating the run as incomplete.
while (Date.now() - started < 1200000) {
  const value = await call('Runtime.evaluate', { expression: 'JSON.stringify({title:document.title,text:document.getElementById("out")?.textContent||""})', returnByValue: true });
  const parsed = JSON.parse(value.result.value);
  title = parsed.title;
  output = parsed.text;
  if (title.startsWith('RESULT') || title === 'ERROR') break;
  await new Promise(resolve => setTimeout(resolve, 1000));
}
if (outputPath) fs.writeFileSync(outputPath, output + '\n');
process.stdout.write(JSON.stringify({ title, output }, null, 2) + '\n');
if (title === 'ERROR' || !title.startsWith('RESULT')) process.exitCode = 1;
socket.close();
