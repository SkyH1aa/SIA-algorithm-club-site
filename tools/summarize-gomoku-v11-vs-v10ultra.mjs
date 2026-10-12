import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { won } from './gomoku-match.mjs';

// Replays the two V11-candidate-vs-V10Ultra games, re-checks every resource
// fingerprint, and reports the candidate's black/white results. A match only
// counts once its game is finished, the replay is legal and the hashes match.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, 'docs/gomoku-v11-candidate-validation');
const candidate = 'v11candidate', baseline = 'v10ultra';
const stats = moves => {
  const sorted = moves.slice().sort((a, b) => a - b);
  if (!sorted.length) return { moves: 0, totalMs: 0, meanMs: 0, maxMs: 0, medianMs: 0 };
  return { moves: sorted.length, totalMs: sorted.reduce((a, b) => a + b, 0),
    meanMs: Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
    maxMs: sorted.at(-1), medianMs: sorted[Math.floor(sorted.length / 2)] };
};
const summary = { generatedAt: new Date().toISOString(), complete: false, candidate, baseline,
  rule: 'freestyle; 15x15; >=5 wins; no opening constraints', matches: [], totals: { wins: 0, losses: 0, draws: 0, completed: 0 },
  telemetry: { [candidate]: { durations: [], depths: [] }, [baseline]: { durations: [], depths: [] } } };
for (const [black, white] of [[candidate, baseline], [baseline, candidate]]) {
  const file = `${black}-black-${white}.json`, location = path.join(directory, file);
  assert.ok(fs.existsSync(location), `missing match report ${file}; run tools/run-v11-vs-v10ultra.mjs`);
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
    assert.ok(Number.isInteger(move.row) && Number.isInteger(move.col), `${file}: non-integer move`);
    assert.equal(board[move.row]?.[move.col], 0, `${file}: illegal move at ${move.row},${move.col}`);
    board[move.row][move.col] = move.player;
    if (won(board, move.row, move.col, move.player)) winning = move.model;
    const entry = summary.telemetry[move.model];
    if (entry) { entry.durations.push(move.elapsedMs || 0); if (Number.isInteger(move.search?.depth)) entry.depths.push(move.search.depth); }
  }
  assert.equal(report.winner, winning, `${file}: winner mismatch`);
  assert.equal(report.result, winning ? 'win' : 'draw');
  if (!winning) assert.equal(report.moves.length, 225, `${file}: premature draw`);
  for (const [source, hash] of Object.entries(report.fingerprints)) {
    assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root, source))).digest('hex'), hash, `${file}: changed resource ${source}`);
  }
  const result = winning === candidate ? 'win' : winning ? 'loss' : 'draw';
  summary.totals[result === 'win' ? 'wins' : result === 'loss' ? 'losses' : 'draws']++; summary.totals.completed++;
  summary.matches.push({ black, white, candidateColor: black === candidate ? 'black' : 'white', result, winner: winning, moves: report.moves.length, file,
    candidate: stats(report.moves.filter(move => move.model === candidate).map(move => move.elapsedMs || 0)),
    baseline: stats(report.moves.filter(move => move.model === baseline).map(move => move.elapsedMs || 0)) });
}
summary.complete = summary.totals.completed === 2;
for (const entry of Object.values(summary.telemetry)) {
  const timing = stats(entry.durations), depths = entry.depths.slice().sort((a, b) => a - b);
  entry.moves = timing.moves; entry.totalMs = timing.totalMs; entry.meanMs = timing.meanMs; entry.maxMs = timing.maxMs; entry.medianMs = timing.medianMs;
  entry.minDepth = depths[0] ?? null; entry.maxDepth = depths.at(-1) ?? null;
  entry.meanDepth = depths.length ? Number((depths.reduce((a, b) => a + b, 0) / depths.length).toFixed(2)) : null;
}
fs.writeFileSync(path.join(directory, 'v10ultra-summary.json'), JSON.stringify(summary, null, 2) + '\n');
const seconds = ms => (ms / 1000).toFixed(2);
console.log(`\n=== ${candidate} vs ${baseline} (double color, empty board) ===`);
console.log(`rule: ${summary.rule}`);
console.log('game  black          white          winner         plies  cand_total  cand_mean  cand_max  base_total  base_mean');
for (const [index, match] of summary.matches.entries()) {
  console.log([`${index + 1}`, match.black.padEnd(14), match.white.padEnd(14), String(match.winner || 'draw').padEnd(14),
    String(match.moves).padStart(5), seconds(match.candidate.totalMs).padStart(11), seconds(match.candidate.meanMs).padStart(10),
    seconds(match.candidate.maxMs).padStart(9), seconds(match.baseline.totalMs).padStart(11), seconds(match.baseline.meanMs).padStart(10)].join(' '));
}
const { wins, losses, draws, completed } = summary.totals;
console.log(`\n${candidate}: ${wins} win / ${losses} loss / ${draws} draw (${completed}/2 games)`);
for (const [name, entry] of Object.entries(summary.telemetry)) {
  console.log(`${name}: ${entry.moves} moves, mean ${seconds(entry.meanMs)}s, max ${seconds(entry.maxMs)}s, depth ${entry.minDepth}-${entry.maxDepth} (mean ${entry.meanDepth})`);
}
console.log(`complete=${summary.complete}; summary -> ${path.relative(root, path.join(directory, 'v10ultra-summary.json'))}`);
if (!summary.complete) process.exitCode = 2;
