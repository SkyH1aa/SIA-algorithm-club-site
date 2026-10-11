import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
import { loadEngine } from './gomoku-match.mjs';

const empty = () => Array.from({ length: 15 }, () => Array(15).fill(0));
const play = (board, moves) => {
  for (const { row, col, player } of moves) board[row][col] = player;
  return board;
};
const engine = loadEngine('v10');
let board = empty();
for (const color of [1, 2]) {
  board = empty();
  for (let col = 3; col <= 6; col++) {
    board[4][col] = color;
    board[9][col] = 3 - color;
  }
  const win = engine(board, color, []);
  assert.equal(win.row, 4, 'V10 must win before defending');
  assert.ok([2, 7].includes(win.col));

  board = empty();
  for (let col = 3; col <= 6; col++) board[9][col] = 3 - color;
  board[9][2] = color;
  const block = engine(board, color, []);
  assert.deepEqual([block.row, block.col], [9, 7], 'V10 must block a unique immediate win');
}

const book = [
  { black: [9, 7], white: [6, 7] },
  { black: [6, 7], white: [7, 9] },
  { black: [7, 9], white: [8, 10] }
];
for (const { black, white } of book) {
  const moves = [{ row: 7, col: 7, player: 1 }, { row: 8, col: 8, player: 2 }, { row: black[0], col: black[1], player: 1 }];
  const response = engine(play(empty(), moves), 2, moves);
  assert.deepEqual([response.row, response.col], white);
  assert.equal(response.explanation.reason, 'opening');
}
const opening = [{ row: 7, col: 7, player: 1 }];
const firstReply = engine(play(empty(), opening), 2, opening);
assert.deepEqual([firstReply.row, firstReply.col], [8, 8]);
const loss = JSON.parse(fs.readFileSync(new URL('../docs/gomoku-v10-development/thinker-black-v10-depth8-loss.json', import.meta.url), 'utf8'));
const learnedLine = loss.moves.slice(0, 17);
const continuation = engine(play(empty(), learnedLine), 2, learnedLine);
assert.deepEqual([continuation.row, continuation.col], [8, 5]);
assert.equal(continuation.explanation.reason, 'repertoire');

// V10 owns its own copy of the expert core. Verify incremental make/unmake
// state against full recomputation and all board/color symmetries.
const source = fs.readFileSync(new URL('../public/gomoku-models/v10-core.js', import.meta.url), 'utf8')
  .replace('return { findBestMove, clearCache()', 'return { debug: { initialize, change, pointScore, cells, codes, scores, sums, nearby }, findBestMove, clearCache()');
const context = { board: empty(), aiColor: 1, gameMoves: [], performance, updateExplain() {} };
context.window = context;
vm.createContext(context);
vm.runInContext(source, context);
const core = context.createGomokuV10Expert({ depth: 1, candidates: 2, timeMs: 1000, threatDepth: 1, vcfMs: 100, training: () => ({}) });
const d = core.debug;
const snapshot = () => JSON.stringify([Array.from(d.cells), d.codes.slice(1).map(a => Array.from(a)), d.scores.slice(1).map(a => Array.from(a)), Array.from(d.sums), Array.from(d.nearby)]);
let seed = 1013;
const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
for (let round = 0; round < 8; round++) {
  context.board = empty(); d.initialize(); const stack = [];
  for (let n = 0; n < 30; n++) {
    let cell; do { cell = random() % 225; } while (d.cells[cell]);
    const player = n % 2 + 1;
    d.change(cell, player); stack.push([cell, player]);
    context.board[Math.floor(cell / 15)][cell % 15] = player;
    const incremental = snapshot(); d.initialize();
    assert.equal(snapshot(), incremental, 'incremental state differs from recomputation');
  }
  while (stack.length) {
    const [cell, player] = stack.pop(); d.change(cell, player, true);
    context.board[Math.floor(cell / 15)][cell % 15] = 0;
    const incremental = snapshot(); d.initialize();
    assert.equal(snapshot(), incremental, 'undo state differs from recomputation');
  }
}
context.board = empty();
for (let n = 0; n < 32; n++) {
  let cell; do { cell = random() % 225; } while (context.board[Math.floor(cell / 15)][cell % 15]);
  context.board[Math.floor(cell / 15)][cell % 15] = n % 2 + 1;
}
d.initialize();
const original = context.board.map(row => row.slice());
const originalScores = d.scores.slice(1).map(scores => Array.from(scores));
for (let flip = 0; flip < 2; flip++) for (let rotation = 0; rotation < 4; rotation++) for (let swap = 0; swap < 2; swap++) {
  const transform = (row, col) => {
    if (flip) col = 14 - col;
    for (let i = 0; i < rotation; i++) [row, col] = [col, 14 - row];
    return [row, col];
  };
  context.board = empty();
  for (let row = 0; row < 15; row++) for (let col = 0; col < 15; col++) {
    const [r, c] = transform(row, col);
    const p = original[row][col];
    context.board[r][c] = p && swap ? 3 - p : p;
  }
  d.initialize();
  for (let row = 0; row < 15; row++) for (let col = 0; col < 15; col++) for (let p = 1; p <= 2; p++) {
    const [r, c] = transform(row, col);
    assert.equal(d.scores[swap ? 3 - p : p][r * 15 + c], originalScores[p - 1][row * 15 + col]);
  }
}
console.log('PASS: V10 black/white tactics, opening replies, incremental state, and eight board symmetries with color swap.');
