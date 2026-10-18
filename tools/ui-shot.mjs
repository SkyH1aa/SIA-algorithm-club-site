// 用 Chrome DevTools Protocol 做页面截图与交互断言。
// 用法：node tools/ui-shot.mjs <url> <out.png> [--theme=dark|light] [--width=1440] [--height=900] [--eval="js"]
//       [--wait=800] [--full]
// 需要先启动 Chrome：chrome --headless=new --remote-debugging-port=9333
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const url = args[0];
const out = args[1];
if (!url || !out) {
  console.error('usage: node tools/ui-shot.mjs <url> <out.png> [--theme=dark] [--width=1440] [--height=900] [--eval="js"] [--wait=800] [--full]');
  process.exit(1);
}
const opt = (name, fallback) => {
  const hit = args.find(arg => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const theme = opt('theme', '');
const width = Number(opt('width', 1440));
const height = Number(opt('height', 900));
const wait = Number(opt('wait', 900));
const evalScript = opt('eval', '') || (opt('eval-file', '') ? fs.readFileSync(opt('eval-file', ''), 'utf8') : '');
const injectFile = opt('inject', '');
const full = args.includes('--full');
const port = process.env.CDP_PORT || 9333;

const targets = await fetch(`http://127.0.0.1:${port}/json`).then(response => response.json());
const target = targets.find(item => item.type === 'page');
if (!target) throw new Error('no page target');
const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
let sequence = 0;
socket.addEventListener('message', event => {
  const message = JSON.parse(String(event.data));
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(JSON.stringify(message.error)));
  else resolve(message.result);
});
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

await call('Page.enable');
await call('Runtime.enable');
await call('Network.enable');
await call('Network.setCacheDisabled', { cacheDisabled: true });
await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
await call('Page.navigate', { url: 'about:blank' });
await sleep(120);
if (theme) {
  await call('Page.navigate', { url });
  await sleep(300);
  const origin = new URL(url).origin;
  await call('Runtime.evaluate', {
    expression: `localStorage.setItem('algorithm-club-theme-mode', ${JSON.stringify(theme)});`,
    returnByValue: true
  });
}
if (injectFile) {
  const source = fs.readFileSync(injectFile, 'utf8');
  await call('Page.addScriptToEvaluateOnNewDocument', { source });
}
await call('Page.navigate', { url });
await sleep(wait);
if (evalScript) {
  const result = await call('Runtime.evaluate', { expression: evalScript, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || 'eval failed');
  if (result.result?.value !== undefined) console.log(JSON.stringify(result.result.value, null, 2));
  await sleep(400);
}
const shot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full, fromSurface: true });
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
console.log(`saved ${out}`);
socket.close();
