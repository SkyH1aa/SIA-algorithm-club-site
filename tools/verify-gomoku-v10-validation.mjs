import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const games = [
  ['v10', 'v8', 'v10-black-v8.json'],
  ['v8', 'v10', 'v8-black-v10.json'],
  ['v10', 'v9', 'v10-black-v9.json'],
  ['v9', 'v10', 'v9-black-v10.json'],
  ['v10', 'v9pro', 'v10-black-v9pro.json'],
  ['v9pro', 'v10', 'v9pro-black-v10.json'],
  ['v10', 'v9thinker', 'v10-black-thinker.json'],
  ['v9thinker', 'v10', 'v9thinker-black-v10.json']
];
function won(board, row, col, color) {
  return [[0, 1], [1, 0], [1, 1], [1, -1]].some(([dr, dc]) => {
    let n = 1;
    for (const sign of [-1, 1]) for (let k = 1; k < 15; k++) {
      if (board[row + sign * dr * k]?.[col + sign * dc * k] !== color) break;
      n++;
    }
    return n >= 5;
  });
}
for (const [black, white, file] of games) {
  const report = JSON.parse(fs.readFileSync(path.join(root, 'docs/gomoku-v10-validation', file), 'utf8'));
  assert.equal(report.black, black, `${file}: black model`);
  assert.equal(report.white, white, `${file}: white model`);
  assert.ok(report.finishedAt, `${file}: unfinished`);
  assert.equal(report.limits, 'production, real monotonic clock');
  assert.equal(report.winner, 'v10', `${file}: V10 did not win`);
  assert.equal(report.result, 'win');
  assert.ok(report.moves.length >= 5 && report.moves.length <= 225);
  for (const [filePath, fingerprint] of Object.entries(report.fingerprints)) {
    const actual = createHash('sha256').update(fs.readFileSync(path.join(root, filePath))).digest('hex');
    assert.equal(fingerprint, actual, `${file}: stale ${filePath} fingerprint`);
  }
  const board = Array.from({ length: 15 }, () => Array(15).fill(0));
  let winner = null;
  for (const [index, move] of report.moves.entries()) {
    assert.equal(winner, null, `${file}: moves after a win`);
    assert.equal(move.move, index + 1);
    assert.equal(move.player, index % 2 + 1);
    assert.ok(Number.isInteger(move.row) && move.row >= 0 && move.row < 15);
    assert.ok(Number.isInteger(move.col) && move.col >= 0 && move.col < 15);
    assert.equal(board[move.row][move.col], 0, `${file}: occupied point`);
    assert.ok(Number.isFinite(move.elapsedMs) && move.elapsedMs >= 0);
    if (move.player === (black === 'v10' ? 1 : 2)) {
      assert.ok(move.elapsedMs <= 41000, `${file}: V10 exceeded its time budget`);
      assert.ok(move.explanation?.reason, `${file}: missing V10 decision reason`);
    }
    board[move.row][move.col] = move.player;
    if (won(board, move.row, move.col, move.player)) winner = move.player === 1 ? black : white;
  }
  assert.equal(winner, report.winner, `${file}: recorded winner differs from board`);
  console.log(`${black} black / ${white} white: ${report.moves.length} moves, V10 win`);
}
console.log('PASS: eight complete V10 games, both colors against four frozen models; all moves legal and fingerprints current.');
