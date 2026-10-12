import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// V11 candidate against V10Ultra, one game per color on an empty board.
// The engines run in a real browser Worker, so this script brings up the same
// static server (4173) and isolated Chrome DevTools endpoint (9223) that the
// other gomoku experiment tools expect, then drives two matches and summarizes.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const origin = process.env.GOMOKU_ORIGIN || 'http://127.0.0.1:4173';
const cdp = process.env.GOMOKU_CDP || 'http://127.0.0.1:9223';
const headless = process.env.GOMOKU_CHROME_HEADLESS !== '0';
const directory = 'docs/gomoku-v11-candidate-validation';
const matches = [['v11candidate', 'v10ultra'], ['v10ultra', 'v11candidate']];

const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8',
  '.json':'application/json; charset=utf-8', '.css':'text/css; charset=utf-8', '.wasm':'application/wasm',
  '.data':'application/octet-stream', '.onnx':'application/octet-stream', '.png':'image/png', '.map':'application/json; charset=utf-8' };

async function reachable(url) {
  try { return (await fetch(url, { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; }
}
async function waitFor(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { if (await reachable(url)) return true; await new Promise(r => setTimeout(r, 300)); }
  return false;
}
function startStaticServer(port) {
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, origin).pathname);
    const target = path.join(root, pathname === '/' ? 'index.html' : pathname);
    if (!target.startsWith(root)) { response.writeHead(403).end('forbidden'); return; }
    fs.readFile(target, (error, body) => {
      if (error) { response.writeHead(404).end('not found'); return; }
      response.writeHead(200, { 'Content-Type': MIME[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      response.end(body);
    });
  });
  return new Promise((resolve, reject) => { server.on('error', reject); server.listen(port, '127.0.0.1', () => resolve(server)); });
}
function locateChrome() {
  const candidates = [process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft/Edge/Application/msedge.exe'),
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean);
  return candidates.find(candidate => fs.existsSync(candidate));
}
function launchChrome(executable) {
  const profile = fs.mkdtempSync(path.join(process.env.TEMP || root, 'gomoku-cdp-'));
  const args = [`--remote-debugging-port=${new URL(cdp).port || 9223}`, `--user-data-dir=${profile}`, '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--mute-audio', 'about:blank'];
  if (headless) args.unshift('--headless=new', '--disable-gpu');
  const child = spawn(executable, args, { stdio: 'ignore', detached: false });
  child.on('exit', code => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} });
  return child;
}
function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${args.join(' ')} exited with ${code}`)));
  });
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

let server = null, chrome = null;
try {
  if (await reachable(origin)) {
    console.log(`SERVER reusing ${origin}`);
  } else {
    server = await startStaticServer(Number(new URL(origin).port || 4173));
    console.log(`SERVER started ${origin}`);
  }
  if (await reachable(cdp + '/json/version')) {
    console.log(`CHROME reusing ${cdp}`);
  } else {
    const executable = locateChrome();
    if (!executable) throw new Error('No Chrome or Edge executable found; set CHROME_PATH');
    chrome = launchChrome(executable);
    if (!await waitFor(cdp + '/json/version', 30000)) throw new Error(`Chrome DevTools did not open on ${cdp}`);
    console.log(`CHROME started ${executable}${headless ? ' (headless)' : ''}`);
  }
  for (const [black, white] of matches) {
    const output = `${directory}/${black}-black-${white}.json`;
    console.log(`START ${black}/${white}`);
    await run(process.execPath, ['tools/run-gomoku-experiment-browser.mjs', black, white, output, origin]);
  }
  await run(process.execPath, ['tools/summarize-gomoku-v11-vs-v10ultra.mjs']);
  console.log('ALL V11 CANDIDATE VS V10ULTRA MATCHES COMPLETE');
} finally {
  if (chrome && !chrome.killed) { spawn('taskkill', ['/pid', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' }); await sleep(500); }
  if (server) await new Promise(resolve => server.close(resolve));
}
