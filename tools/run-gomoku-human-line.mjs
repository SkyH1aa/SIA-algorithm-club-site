import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { won } from './gomoku-match.mjs';

// Replays one recorded game with a different engine on the AI side, keeping
// the recorded color assignment. The human's move list is replayed verbatim;
// the engine answers each of those moves itself.
//   node tools/run-gomoku-human-line.mjs <engine> <record.json> <output.json>
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [engine, recordPath, output] = process.argv.slice(2);
if (!engine || !recordPath || !output) throw new Error('Usage: node tools/run-gomoku-human-line.mjs <engine> <record.json> <output.json>');
const origin = process.env.GOMOKU_ORIGIN || 'http://127.0.0.1:4173';
const cdp = process.env.GOMOKU_CDP || 'http://127.0.0.1:9223';
const headless = process.env.GOMOKU_CHROME_HEADLESS !== '0';

const absolute = path.resolve(root, recordPath);
const record = JSON.parse(fs.readFileSync(absolute, 'utf8'));
const scriptedColor = record.player_color ?? record.playerColor;
const engineColor = record.ai_color ?? record.aiColor;
assert.ok([1, 2].includes(scriptedColor) && [1, 2].includes(engineColor) && scriptedColor !== engineColor, 'record colors');
assert.ok(Array.isArray(record.moves) && record.moves.length, 'record moves');
assert.ok(record.moves.filter(move => move.player === engineColor).length > 0, 'record has engine moves');
const scriptUrl = '/' + path.relative(root, absolute).split(path.sep).join('/');
const black = engineColor === 1 ? engine : 'script';
const white = engineColor === 2 ? engine : 'script';

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
  console.log(`LINE ${engineColor === 1 ? 'black' : 'white'} = ${engine}, ${scriptedColor === 1 ? 'black' : 'white'} = script`);
  await run(process.execPath, ['tools/run-gomoku-experiment-browser.mjs', black, white, output, origin],
    { GOMOKU_MATCH_SCRIPT: scriptUrl, GOMOKU_MATCH_SCRIPT_COLOR: String(scriptedColor) });
} finally {
  if (chrome) { spawn('taskkill', ['/pid', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' }); await sleep(500); }
  if (server) await new Promise(resolve => server.close(resolve));
}

const report = JSON.parse(fs.readFileSync(path.resolve(root, output), 'utf8'));
assert.ok(!report.error, report.error);
const board = Array.from({ length: 15 }, () => Array(15).fill(0));
let winning = null;
for (const [index, move] of report.moves.entries()) {
  assert.equal(winning, null, 'continued after a win');
  assert.equal(move.move, index + 1);
  assert.equal(move.player, index % 2 + 1);
  assert.equal(move.model, move.player === scriptedColor ? 'script' : engine, `wrong model on move ${move.move}`);
  assert.equal(board[move.row][move.col], 0, `illegal move at ${move.row},${move.col}`);
  board[move.row][move.col] = move.player;
  if (won(board, move.row, move.col, move.player)) winning = move.model;
}
assert.equal(report.winner, winning);
assert.equal(report.result, winning ? 'win' : 'draw');
for (const [source, hash] of Object.entries(report.fingerprints)) {
  assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root, source))).digest('hex'), hash, `changed resource ${source}`);
}

// Compare the engine's answers with the original engine's recorded answers.
const recordedEngineMoves = record.moves.filter(move => move.player === engineColor).map(move => `${move.row},${move.col}`);
const replayedEngineMoves = report.moves.filter(move => move.player === engineColor).map(move => `${move.row},${move.col}`);
let agreed = 0;
while (agreed < recordedEngineMoves.length && agreed < replayedEngineMoves.length && recordedEngineMoves[agreed] === replayedEngineMoves[agreed]) agreed++;
const recordedWinner = record.result === 'win' ? record.model_version : record.result === 'loss' ? 'human' : 'draw';
const humanColor = scriptedColor === 1 ? 'black' : 'white';
const engineColorName = engineColor === 1 ? 'black' : 'white';
const summary = { engine, record: path.relative(root, absolute).split(path.sep).join('/'), recordNickname: record.nickname ?? null,
  recordModelVersion: record.model_version, originalResult: record.result, originalWinner: recordedWinner,
  colors: { [engine]: engineColorName, script: humanColor }, scriptedMoves: record.moves.filter(move => move.player === scriptedColor).length,
  engineMoves: recordedEngineMoves.length, agreedMoves: agreed, firstDivergence: agreed < replayedEngineMoves.length ? { turn: agreed + 1, recorded: recordedEngineMoves[agreed], replayed: replayedEngineMoves[agreed] } : null,
  winner: report.winner, plies: report.moves.length, scriptExhausted: !!report.scriptExhausted, scriptConflict: report.scriptConflict ?? null,
  engineMovesPlayed: replayedEngineMoves, elapsedMs: report.moves.filter(move => move.model === engine).map(move => move.elapsedMs) };
summary.maxMs = summary.elapsedMs.length ? Math.max(...summary.elapsedMs) : 0;
summary.meanMs = summary.elapsedMs.length ? Math.round(summary.elapsedMs.reduce((a, b) => a + b, 0) / summary.elapsedMs.length) : 0;
delete summary.elapsedMs;
fs.writeFileSync(path.resolve(root, output).replace(/\.json$/, '.summary.json'), JSON.stringify(summary, null, 2) + '\n');

console.log(`\n=== ${engine} replays ${summary.recordNickname ?? 'record'} vs ${record.model_version} (${record.model_version} played ${engineColorName}) ===`);
console.log(`recorded outcome: ${recordedWinner} won in ${record.moves.length} plies`);
console.log(`${engine} matched the recorded engine for the first ${agreed}/${recordedEngineMoves.length} engine replies`);
if (summary.firstDivergence) console.log(`  first divergence on reply ${summary.firstDivergence.turn}: recorded ${summary.firstDivergence.recorded}, replayed ${summary.firstDivergence.replayed}`);
console.log(`replay outcome: ${report.winner ?? 'unfinished'} in ${report.moves.length} plies${report.scriptExhausted ? ' (script exhausted)' : ''}${report.scriptConflict ? ` (script conflict on move ${report.scriptConflict.move})` : ''}`);
console.log(`${engine}: ${replayedEngineMoves.length} replies, mean ${(summary.meanMs / 1000).toFixed(2)}s, max ${(summary.maxMs / 1000).toFixed(2)}s`);
