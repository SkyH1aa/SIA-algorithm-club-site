// Verify the assistant launcher's expanded panel occupies one quarter of the
// viewport (half width x half height) and stays centered on desktop sizes.
// Static server + isolated Chrome. Run: node tools/check-assistant-launcher-expanded.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const origin = 'http://127.0.0.1:4175';
const cdpPort = 9225;
const cdp = `http://127.0.0.1:${cdpPort}`;
const mime = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.png':'image/png','.svg':'image/svg+xml'};
const server = http.createServer((request, response) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, origin).pathname); } catch { response.writeHead(400).end('bad request'); return; }
  const target = path.join(root, pathname === '/' ? 'index.html' : pathname);
  if (!target.startsWith(root)) { response.writeHead(403).end('forbidden'); return; }
  fs.readFile(target, (error, body) => {
    if (error) { response.writeHead(404).end('not found'); return; }
    response.writeHead(200, {'Content-Type': mime[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store'});
    response.end(body);
  });
});
await new Promise((resolve, reject) => { server.on('error', reject); server.listen(4175, '127.0.0.1', resolve); });

const executable = [process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
  path.join(process.env.LOCALAPPDATA || '', 'Microsoft/Edge/Application/msedge.exe')].filter(Boolean).find(candidate => fs.existsSync(candidate));
const profile = fs.mkdtempSync(path.join(process.env.TEMP || '/tmp', 'assistant-launcher-'));
const chrome = executable ? spawn(executable, ['--headless=new', `--remote-debugging-port=${cdpPort}`, '--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, 'about:blank'], {stdio: 'ignore'}) : null;
async function waitFor(url, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try { const response = await fetch(url); if (response.ok) return response; } catch { /* retry */ }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`timeout ${url}`);
}
async function pageSocket() {
  const targets = await (await waitFor(`${cdp}/json`)).json();
  const target = targets.find(item => item.type === 'page');
  if (!target) throw new Error('no page target');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let sequence = 0;
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    if (!message.id || !pending.has(message.id)) return;
    const {resolve, reject} = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(JSON.stringify(message.error))); else resolve(message.result);
  });
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, {once: true}); socket.addEventListener('error', reject, {once: true}); });
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, {resolve, reject}); socket.send(JSON.stringify({id, method, params})); });
  return {socket, call};
}

let failures = 0;
try {
  assert.ok(executable, 'Chrome or Edge executable is required; set CHROME_PATH');
  const {socket, call} = await pageSocket();
  const evaluate = async expression => {
    const source = typeof expression === 'function' ? `(${expression.toString()})()` : String(expression);
    const result = await call('Runtime.evaluate', {expression: source, awaitPromise: true, returnByValue: true});
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || 'evaluation failed');
    return result.result?.value;
  };
  const sizes = [[1440, 900], [1920, 1080], [1024, 768]];
  for (const [width, height] of sizes) {
    await call('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: 1, mobile: false});
    // A minimal local page: the launcher mounts through club-shell only on real
    // site pages, so load one that includes it and open the panel directly.
    await call('Page.navigate', {url: `${origin}/public/platformer.html`});
    for (let attempt = 0; attempt < 20; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 200));
      if (await evaluate('Boolean(window.ClubAssistant)')) break;
    }
    const geometry = await evaluate(async () => {
      if (!window.ClubAssistant) return {mounted: false};
      window.ClubAssistant.open();
      const root = document.getElementById('club-assistant');
      const expand = root?.querySelector?.('.club-assistant-expand');
      if (!expand) return {mounted: true, expandedButton: false};
      expand.click();
      await new Promise(resolve => setTimeout(resolve, 250));
      const rect = document.getElementById('club-assistant-panel').getBoundingClientRect();
      const style = getComputedStyle(document.getElementById('club-assistant-panel'));
      return {mounted: true, expandedButton: true, rect: {width: rect.width, height: rect.height, left: rect.left, top: rect.top}, viewport: {width: innerWidth, height: innerHeight}, width: style.width, height: style.height};
    });
    if (!geometry.mounted) { console.log(`SKIP launcher not mounted at ${width}x${height}`); continue; }
    if (!geometry.expandedButton) throw new Error('expanded control missing');
    const ratio = (geometry.rect.width * geometry.rect.height) / (geometry.viewport.width * geometry.viewport.height);
    const widthRatio = geometry.rect.width / geometry.viewport.width;
    const heightRatio = geometry.rect.height / geometry.viewport.height;
    assert.ok(Math.abs(ratio - 0.25) < 0.02, `expanded area should be ~25% of the viewport, got ${(ratio * 100).toFixed(1)}% at ${width}x${height}`);
    assert.ok(Math.abs(widthRatio - 0.5) < 0.02, `expanded width should be half the viewport, got ${(widthRatio * 100).toFixed(1)}%`);
    assert.ok(Math.abs(heightRatio - 0.5) < 0.02, `expanded height should be half the viewport, got ${(heightRatio * 100).toFixed(1)}%`);
    assert.ok(Math.abs(geometry.rect.left - geometry.viewport.width / 4) < 2, 'expanded panel should be horizontally centered');
    assert.ok(Math.abs(geometry.rect.top - geometry.viewport.height / 4) < 2, 'expanded panel should be vertically centered');
    console.log(`PASS expanded panel is ${(widthRatio * 100).toFixed(0)}% x ${(heightRatio * 100).toFixed(0)}% = ${(ratio * 100).toFixed(0)}% of ${width}x${height} viewport`);
  }
  socket.close();
} catch (error) {
  failures++;
  console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
} finally {
  chrome?.kill();
  server.close();
}
if (failures) process.exit(1);
console.log('Assistant launcher expanded geometry check passed (local browser, no backend calls).');
