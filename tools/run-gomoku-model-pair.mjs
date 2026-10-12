import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { won } from './gomoku-match.mjs';

// Double-color match for one pair of arena engines, with the same replay and
// fingerprint verification the other gomoku validations use.
//   node tools/run-gomoku-model-pair.mjs <A> <B> [label]
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [first, second, label = `${first}-vs-${second}`] = process.argv.slice(2);
if (!first || !second) throw new Error('Usage: node tools/run-gomoku-model-pair.mjs <modelA> <modelB> [label]');
const origin = process.env.GOMOKU_ORIGIN || 'http://127.0.0.1:4173';
const cdp = process.env.GOMOKU_CDP || 'http://127.0.0.1:9223';
const headless = process.env.GOMOKU_CHROME_HEADLESS !== '0';
const directory = `docs/gomoku-${label}-validation`;
const matches = [[first, second], [second, first]];

const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8',
  '.json':'application/json; charset=utf-8', '.css':'text/css; charset=utf-8', '.wasm':'application/wasm',
  '.data':'application/octet-stream', '.onnx':'application/octet-stream', '.png':'image/png', '.map':'application/json; charset=utf-8' };

const reachable = async url => { try { return (await fetch(url, { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; } };
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
  return [process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft/Edge/Application/msedge.exe')].filter(Boolean).find(candidate => fs.existsSync(candidate));
}
function launchChrome(executable) {
  const profile = fs.mkdtempSync(path.join(process.env.TEMP || root, 'gomoku-cdp-'));
  const args = [`--remote-debugging-port=${new URL(cdp).port || 9223}`, `--user-data-dir=${profile}`, '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--mute-audio', 'about:blank'];
  if (headless) args.unshift('--headless=new', '--disable-gpu');
  return spawn(executable, args, { stdio: 'ignore' });
}
const run = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit' });
  child.on('error', reject);
  child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${args.join(' ')} exited with ${code}`)));
});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function verify(black, white) {
  const file = `${black}-black-${white}.json`, location = path.join(root, directory, file);
  const report = JSON.parse(fs.readFileSync(location, 'utf8'));
  assert.equal(report.black, black); assert.equal(report.white, white);
  assert.ok(!report.error, `${file}: ${report.error}`);
  assert.ok(report.finishedAt, `${file}: unfinished game`);
  const board = Array.from({ length: 15 }, () => Array(15).fill(0));
  let winning = null;
  for (const [index, move] of report.moves.entries()) {
    assert.equal(winning, null, `${file}: continued after a win`);
    assert.equal(move.move, index + 1); assert.equal(move.player, index % 2 + 1);
    assert.equal(move.model, move.player === 1 ? black : white, `${file}: wrong model on move ${move.move}`);
    assert.equal(board[move.row]?.[move.col], 0, `${file}: illegal move at ${move.row},${move.col}`);
    board[move.row][move.col] = move.player;
    if (won(board, move.row, move.col, move.player)) winning = move.model;
  }
  assert.equal(report.winner, winning, `${file}: winner mismatch`);
  assert.equal(report.result, winning ? 'win' : 'draw');
  if (!winning) assert.equal(report.moves.length, 225, `${file}: premature draw`);
  for (const [source, hash] of Object.entries(report.fingerprints)) {
    assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root, source))).digest('hex'), hash, `${file}: changed resource ${source}`);
  }
  return report;
}
const stats = values => {
  const sorted = values.slice().sort((a, b) => a - b);
  if (!sorted.length) return { moves: 0, totalMs: 0, meanMs: 0, maxMs: 0, medianMs: 0 };
  const total = sorted.reduce((a, b) => a + b, 0);
  return { moves: sorted.length, totalMs: total, meanMs: Math.round(total / sorted.length), maxMs: sorted.at(-1), medianMs: sorted[Math.floor(sorted.length / 2)] };
};

let server = null, chrome = null;
try {
  server = await reachable(origin) ? null : await startStaticServer(Number(new URL(origin).port || 4173));
  console.log(`SERVER ${server ? 'started' : 'reusing'} ${origin}`);
  if (await reachable(cdp + '/json/version')) console.log(`CHROME reusing ${cdp}`);
  else {
    const executable = locateChrome();
    if (!executable) throw new Error('No Chrome or Edge executable found; set CHROME_PATH');
    chrome = launchChrome(executable);
    if (!await waitFor(cdp + '/json/version', 30000)) throw new Error(`Chrome DevTools did not open on ${cdp}`);
    console.log(`CHROME started ${executable}${headless ? ' (headless)' : ''}`);
  }
  for (const [black, white] of matches) {
    console.log(`START ${black}/${white}`);
    await run(process.execPath, ['tools/run-gomoku-experiment-browser.mjs', black, white, `${directory}/${black}-black-${white}.json`, origin]);
  }
} finally {
  if (chrome) { spawn('taskkill', ['/pid', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' }); await sleep(500); }
  if (server) await new Promise(resolve => server.close(resolve));
}

const summary = { generatedAt: new Date().toISOString(), complete: false, pair: [first, second],
  rule: 'freestyle; 15x15; >=5 wins; no opening constraints', matches: [], models: {} };
for (const name of [first, second]) summary.models[name] = { wins: 0, losses: 0, draws: 0, colors: {}, reasons: {}, bookMoves: 0, durations: [] };
for (const [black, white] of matches) {
  const report = verify(black, white);
  const winner = report.winner;
  summary.matches.push({ black, white, winner, moves: report.moves.length, file: `${black}-black-${white}.json` });
  for (const name of [first, second]) {
    const color = black === name ? 'black' : 'white';
    const entry = summary.models[name];
    const result = winner === name ? 'win' : winner ? 'loss' : 'draw';
    entry.colors[color] = result;
    entry[result === 'win' ? 'wins' : result === 'loss' ? 'losses' : 'draws']++;
    for (const move of report.moves.filter(move => move.model === name)) {
      entry.durations.push(move.elapsedMs || 0);
      const reason = move.search?.reason || 'none';
      entry.reasons[reason] = (entry.reasons[reason] || 0) + 1;
      if (reason === 'opening-book') entry.bookMoves++;
    }
  }
}
summary.complete = summary.matches.length === 2;
for (const entry of Object.values(summary.models)) { const timing = stats(entry.durations); delete entry.durations; Object.assign(entry, timing); }
fs.mkdirSync(path.join(root, directory), { recursive: true });
fs.writeFileSync(path.join(root, directory, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');

const seconds = ms => (ms / 1000).toFixed(2);
console.log(`\n=== ${first} vs ${second} (double color, empty board) ===`);
console.log('game  black          white          winner         plies');
for (const [index, match] of summary.matches.entries())
  console.log([`${index + 1}`, match.black.padEnd(14), match.white.padEnd(14), String(match.winner || 'draw').padEnd(14), String(match.moves).padStart(5)].join(' '));
for (const [name, entry] of Object.entries(summary.models))
  console.log(`${name}: ${entry.wins}W/${entry.losses}L/${entry.draws}D  colors ${JSON.stringify(entry.colors)}  ${entry.moves} moves, mean ${seconds(entry.meanMs)}s, max ${seconds(entry.maxMs)}s  book ${entry.bookMoves}  reasons ${JSON.stringify(entry.reasons)}`);
console.log(`complete=${summary.complete}; summary -> ${directory}/summary.json`);
if (!summary.complete) process.exitCode = 2;
