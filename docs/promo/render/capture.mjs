// 按元素 id 逐张截取推文配图（CDP clip 截图）。
// 用法：node docs/promo/render/capture.mjs <url> <outDir> [id,id,...]
import fs from 'node:fs';
import path from 'node:path';

const [url, outDir, only] = process.argv.slice(2);
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
await call('Emulation.setDeviceMetricsOverride', { width: 1200, height: 1200, deviceScaleFactor: 2, mobile: false });
await call('Page.navigate', { url });
await new Promise(r => setTimeout(r, 2500));
await call('Runtime.evaluate', { expression: 'document.fonts.ready.then(()=>true)', awaitPromise: true, returnByValue: true });
await new Promise(r => setTimeout(r, 600));

const ids = only ? only.split(',') : (await call('Runtime.evaluate', {
  expression: `Array.from(document.querySelectorAll('.fig')).map(el => el.id)`,
  returnByValue: true
})).result.value;

fs.mkdirSync(outDir, { recursive: true });
for (const id of ids) {
  const box = await call('Runtime.evaluate', {
    expression: `(() => { const el = document.getElementById(${JSON.stringify(id)}); const r = el.getBoundingClientRect(); return {x:r.x + window.scrollX, y:r.y + window.scrollY, width:r.width, height:r.height}; })()`,
    returnByValue: true
  });
  const { x, y, width, height } = box.result.value;
  await new Promise(r => setTimeout(r, 250));
  const shot = await call('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { x, y, width, height, scale: 1 }
  });
  const file = path.join(outDir, `${id.replace('fig-', '')}.png`);
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  console.log(`saved ${file}  ${width}x${height}`);
}
socket.close();
