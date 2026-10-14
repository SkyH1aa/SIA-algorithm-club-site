import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { won } from './gomoku-match.mjs';

// Fixed-opening comparison. An empty board cannot separate these engines: the
// first player wins every game, so a double-color match always splits 1:1.
// Here both engines play the SAME opening twice with the colors swapped, which
// is the standard way to cancel the first-move advantage and get a usable
// signal. Openings are placed before either engine searches.
//   node tools/run-gomoku-opening-suite.mjs <A> <B> [label]
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [first, second, label = `${first}-vs-${second}-openings`] = process.argv.slice(2);
if (!first || !second) throw new Error('Usage: node tools/run-gomoku-opening-suite.mjs <modelA> <modelB> [label]');
const origin = process.env.GOMOKU_ORIGIN || 'http://127.0.0.1:4173';
const cdp = process.env.GOMOKU_CDP || 'http://127.0.0.1:9223';
const headless = process.env.GOMOKU_CHROME_HEADLESS !== '0';
const directory = `docs/gomoku-${label}-validation`;
const scratch = path.join(root, 'docs', '_opening-suite');
const only = process.env.GOMOKU_OPENINGS ? new Set(process.env.GOMOKU_OPENINGS.split(',')) : null;

// Short, plausible, non-terminal openings. Each is played out from the start,
// so the same list is legal for both color assignments.
const OPENINGS = [
  { id: 'center', moves: [[7,7]] },
  { id: 'diag-near', moves: [[7,7],[6,8]] },
  { id: 'straight-near', moves: [[7,7],[8,7]] },
  { id: 'diag-far', moves: [[7,7],[8,8]] },
  { id: 'exchange-4', moves: [[7,7],[6,8],[6,6],[8,6]] },
  { id: 'spread-5', moves: [[7,7],[6,6],[8,8],[6,8],[8,6]] },
].filter(opening => !only || only.has(opening.id));

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
const run = (command, args, env) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });
  child.on('error', reject);
  child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${args.join(' ')} exited with ${code}`)));
});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Writes the opening as a normal move list; the arena places it before play.
fs.mkdirSync(scratch, { recursive: true });
const openingUrls = {};
for (const opening of OPENINGS) {
  const file = path.join(scratch, `${opening.id}.json`);
  fs.writeFileSync(file, JSON.stringify({ id: opening.id, moves: opening.moves.map(([row, col], index) => ({ row, col, player: index % 2 + 1 })) }, null, 2) + '\n');
  openingUrls[opening.id] = '/' + path.relative(root, file).split(path.sep).join('/');
}

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
  for (const opening of OPENINGS) {
    for (const [black, white] of [[first, second], [second, first]]) {
      const output = `${directory}/${opening.id}-${black}-black-${white}.json`;
      console.log(`START ${opening.id} ${black}/${white}`);
      await run(process.execPath, ['tools/run-gomoku-experiment-browser.mjs', black, white, output, origin],
        { GOMOKU_MATCH_OPENING: openingUrls[opening.id] });
    }
  }
} finally {
  if (chrome) { spawn('taskkill', ['/pid', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' }); await sleep(500); }
  if (server) await new Promise(resolve => server.close(resolve));
}

function verify(opening, black, white) {
  const file = `${opening.id}-${black}-black-${white}.json`, location = path.join(root, directory, file);
  const report = JSON.parse(fs.readFileSync(location, 'utf8'));
  assert.ok(!report.error, `${file}: ${report.error}`);
  assert.ok(report.finishedAt, `${file}: unfinished game`);
  assert.equal(report.opening?.plies, opening.moves.length, `${file}: opening not applied`);
  const board = Array.from({ length: 15 }, () => Array(15).fill(0));
  let winning = null;
  for (const [index, move] of report.moves.entries()) {
    assert.equal(winning, null, `${file}: continued after a win`);
    assert.equal(move.move, index + 1);
    assert.equal(move.player, index % 2 + 1);
    // Opening plies are pre-placed and belong to no engine.
    const expectedModel = index < opening.moves.length ? 'opening' : (move.player === 1 ? black : white);
    assert.equal(move.model, expectedModel, `${file}: wrong model on move ${move.move}`);
    assert.equal(board[move.row][move.col], 0, `${file}: illegal move at ${move.row},${move.col}`);
    board[move.row][move.col] = move.player;
    if (won(board, move.row, move.col, move.player)) winning = move.model;
  }
  for (const [i, openingMove] of opening.moves.entries()) {
    const played = report.moves[i];
    assert.equal(played.row, openingMove[0], `${file}: opening ply ${i + 1} row`);
    assert.equal(played.col, openingMove[1], `${file}: opening ply ${i + 1} col`);
  }
  assert.equal(report.winner, winning, `${file}: winner mismatch`);
  for (const [source, hash] of Object.entries(report.fingerprints)) {
    assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root, source))).digest('hex'), hash, `${file}: changed resource ${source}`);
  }
  return report;
}
const stats = values => {
  const sorted = values.slice().sort((a, b) => a - b);
  if (!sorted.length) return { moves: 0, meanMs: 0, maxMs: 0 };
  const total = sorted.reduce((a, b) => a + b, 0);
  return { moves: sorted.length, meanMs: Math.round(total / sorted.length), maxMs: sorted.at(-1) };
};

const summary = { generatedAt: new Date().toISOString(), complete: false, pair: [first, second],
  protocol: 'fixed opening, both engines play it twice with colors swapped', openings: [], models: {} };
for (const name of [first, second]) summary.models[name] = { wins: 0, losses: 0, draws: 0, asBlack: { wins: 0, losses: 0 }, asWhite: { wins: 0, losses: 0 }, durations: [] };
for (const opening of OPENINGS) {
  const row = { id: opening.id, plies: opening.moves.length, games: [] };
  for (const [black, white] of [[first, second], [second, first]]) {
    const report = verify(opening, black, white);
    const winner = report.winner;
    row.games.push({ black, white, winner, moves: report.moves.length });
    for (const name of [first, second]) {
      const entry = summary.models[name];
      const color = black === name ? 'black' : 'white';
      const result = winner === name ? 'win' : winner ? 'loss' : 'draw';
      entry[result === 'win' ? 'wins' : result === 'loss' ? 'losses' : 'draws']++;
      entry[color === 'black' ? 'asBlack' : 'asWhite'][result === 'win' ? 'wins' : 'losses']++;
      for (const move of report.moves.filter(move => move.model === name)) entry.durations.push(move.elapsedMs || 0);
    }
  }
  summary.openings.push(row);
}
summary.complete = summary.openings.length === OPENINGS.length;
for (const entry of Object.values(summary.models)) { Object.assign(entry, stats(entry.durations)); delete entry.durations; }
fs.writeFileSync(path.join(root, directory, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');

const seconds = ms => (ms / 1000).toFixed(2);
console.log(`\n=== ${first} vs ${second} (fixed openings, colors swapped) ===`);
console.log('opening        plies  ' + first + ' black / ' + first + ' white   winner(s)');
for (const row of summary.openings) {
  const [firstGame, secondGame] = row.games;
  console.log([row.id.padEnd(14), String(row.plies).padStart(5), '  ',
    (firstGame.winner === first ? 'W' : firstGame.winner ? 'L' : 'D'),
    ' / ',
    (secondGame.winner === first ? 'W' : secondGame.winner ? 'L' : 'D'),
    '   ',
    row.games.map(g => `${g.black}(B)${g.winner === g.black ? ' won' : ' lost'} ${g.moves}`).join(' | ')].join(''));
}
for (const [name, entry] of Object.entries(summary.models)) {
  console.log(`${name}: ${entry.wins}W/${entry.losses}L/${entry.draws}D  as black ${entry.asBlack.wins}W-${entry.asBlack.losses}L, as white ${entry.asWhite.wins}W-${entry.asWhite.losses}L  mean ${seconds(entry.meanMs)}s max ${seconds(entry.maxMs)}s`);
}
console.log(`complete=${summary.complete}; summary -> ${directory}/summary.json`);
if (!summary.complete) process.exitCode = 2;
