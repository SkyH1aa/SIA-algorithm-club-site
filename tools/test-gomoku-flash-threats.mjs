import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { createProver, fixtures, replay, won } from './gomoku-ultra-regression.mjs';

// Unit and soundness tests for the V10Flash threat layer: the pattern
// classifier, the exact four-chase (VCF) prover, and a cross-check of every
// claimed win against the independent V10Exp proof engine.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadFlash() {
  const context = { console, performance, URL, Blob, TextEncoder, atob, btoa,
    document: { currentScript: { src: 'http://127.0.0.1/public/gomoku-models/v10flash.js' }, baseURI: 'http://127.0.0.1/',
      createElement: () => ({}), head: { appendChild() {} } },
    location: { protocol: 'http:' },
    Worker: function Worker() { this.terminate = () => {}; this.addEventListener = () => {}; this.postMessage = () => {}; },
    fetch: async () => { throw new Error('no fetch during tests'); } };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'public/gomoku-models/v10flash.js'), 'utf8'), context);
  return context.GomokuV10Flash;
}
const flash = loadFlash();
const SIZE = 15;
const board = () => Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
const put = (b, color, cells) => { for (const [r, c] of cells) b[r][c] = color; return b; };
// A claimed VCF move must at least threaten five.
function threatensFive(replayed, move, attacker) {
  const b = replayed.map(row => row.slice());
  b[move.row][move.col] = attacker;
  if (won(b, move.row, move.col, attacker)) return true;
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
    if (b[r][c]) continue;
    b[r][c] = attacker;
    const made = won(b, r, c, attacker);
    b[r][c] = 0;
    if (made) return true;
  }
  return false;
}

// ---- pattern classification -------------------------------------------------
{
  // ·XXX· with a free extension on either side: an open four.
  const b = put(board(), 1, [[7,4],[7,5],[7,6]]);
  const threats = flash.threatsFor(b, 1);
  assert.ok(threats.openFour >= 2, `open-four threats expected, got ${JSON.stringify(threats)}`);
  assert.equal(threats.four, 0, 'no plain four beside them');
  const win = flash.vcfFor(b, 1, 300);
  assert.ok(win && win.row === 7 && (win.col === 3 || win.col === 7), `open four must be played, got ${JSON.stringify(win)}`);
}
{
  // A diagonal three likewise reaches an open four.
  const b = put(board(), 1, [[7,7],[8,8],[9,9]]);
  assert.ok(flash.threatsFor(b, 1).openFour >= 1, 'diagonal three can become an open four');
}
{
  // ·XX· with room on both sides: an open three, not yet a four. (A three that
  // is blocked on one side can only ever reach a one-point four, so it is not
  // counted as an open three.)
  const b = put(board(), 2, [[2,2]]);
  put(b, 1, [[7,5],[7,6]]);
  const threats = flash.threatsFor(b, 1);
  assert.ok(threats.openThree >= 1, `open three expected, got ${JSON.stringify(threats)}`);
  assert.equal(threats.openFour, 0, 'no open four yet');
  assert.equal(threats.four, 0, 'no four yet');
}
{
  // A blocked three extended once is a four with a single completion point.
  const b = put(board(), 1, [[7,4],[7,5],[7,6]]);
  put(b, 2, [[7,7]]);
  const threats = flash.threatsFor(b, 1);
  assert.ok(threats.four >= 1, `four expected, got ${JSON.stringify(threats)}`);
  assert.equal(threats.openFour, 0, 'the blocked line is not an open four');
}
{
  const b = put(board(), 1, [[7,7]]);
  assert.equal(JSON.stringify(flash.threatsFor(b, 1)), JSON.stringify({ openFour: 0, four: 0, openThree: 0 }), 'a lone stone threatens nothing');
  assert.equal(flash.vcfFor(b, 1, 300), null, 'no forced win from a single stone');
}
{
  // One stone completing a four in one line and an open four in another.
  const b = put(board(), 1, [[7,4],[7,5],[7,7]]);
  put(b, 1, [[4,6],[5,6],[6,6]]);
  const win = flash.vcfFor(b, 1, 300);
  assert.ok(win, 'a double-four position must have a forced win');
  assert.ok(threatensFive(b, win, 1), 'the chosen move must threaten five');
}
{
  // The opponent already wins next move, so a four chase cannot be sound.
  const b = put(board(), 2, [[7,4],[7,5],[7,6]]);
  put(b, 1, [[7,3]]);
  assert.equal(flash.vcfFor(b, 1, 300), null, 'no VCF claim while the opponent has an immediate five');
}

// ---- soundness: every claimed win must be confirmed by the V10Exp prover ----
const prove = createProver();
let positions = 0, claims = 0;
for (const sample of fixtures().filter(entry => entry.history.length >= 8).slice(0, 8)) {
  for (let ply = 8; ply <= sample.history.length; ply += 2) {
    const history = sample.history.slice(0, ply).map(({ row, col, player }) => ({ row, col, player }));
    const replayed = replay(history).board;
    const attacker = (ply % 2) + 1;   // the side to move
    positions++;
    const move = flash.vcfFor(replayed, attacker, 400);
    if (!move) continue;
    claims++;
    assert.equal(replayed[move.row][move.col], 0, 'a VCF move must be legal');
    assert.ok(threatensFive(replayed, move, attacker), 'a VCF move must threaten five');
    const oracle = prove(history, attacker, 1500);
    assert.ok(oracle.proved, `V10Flash claimed a VCF win at ply ${ply} for ${attacker}, but the independent prover found none`);
  }
}
assert.ok(positions >= 20, `expected a decent position sample, got ${positions}`);
// A finished recorded game must contain at least one guaranteed claim, so the
// cross-check above is known to have exercised the prover.
const record = JSON.parse(fs.readFileSync(path.join(root, '五子棋训练数据1014/gomoku-20261011121404834-5ea23e88-c0a2-4b8b-b7b4-29e01d2ae80a.json'), 'utf8'));
for (let ply = 20; ply <= record.moves.length; ply += 2) {
  const history = record.moves.slice(0, ply).map(({ row, col, player }) => ({ row, col, player }));
  const replayed = replay(history).board;
  const attacker = (ply % 2) + 1;
  positions++;
  const move = flash.vcfFor(replayed, attacker, 400);
  if (!move) continue;
  claims++;
  assert.equal(replayed[move.row][move.col], 0, 'a VCF move must be legal');
  assert.ok(threatensFive(replayed, move, attacker), 'a VCF move must threaten five');
  const oracle = prove(history, attacker, 1500);
  assert.ok(oracle.proved, `V10Flash claimed a VCF win at ply ${ply} for ${attacker}, but the independent prover found none`);
}
assert.ok(claims >= 1, 'the recorded-game sample must produce at least one VCF claim');
console.log(`PASS: V10Flash threat patterns classified; ${positions} positions scanned, ${claims} VCF claims, all confirmed by the V10Exp prover.`);
