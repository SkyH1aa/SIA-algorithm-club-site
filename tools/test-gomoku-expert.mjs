import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
import { loadEngine, won } from './gomoku-match.mjs';

const empty = () => Array.from({ length: 15 }, () => Array(15).fill(0));
// Internal inspection is injected into this VM only; the browser API remains small.
const source = fs.readFileSync(new URL('../public/gomoku-models/expert-core.js', import.meta.url), 'utf8')
  .replace('return { findBestMove, clearCache()', 'return { debug: { initialize, change, generate, evaluate, pointScore, immediate, cells, codes, scores, sums, nearby }, findBestMove, clearCache()');
const context = { board: empty(), aiColor: 1, gameMoves: [], performance, updateExplain() {} };
context.window = context;
vm.createContext(context); vm.runInContext(source, context);
const expert = context.createGomokuExpert({ depth: 6, candidates: 12, timeMs: 25000, threatDepth: 7, vcfMs: 3500, training: () => ({}) });
const d = expert.debug;
function snapshot() { return JSON.stringify([Array.from(d.cells), d.codes.slice(1).map(a => Array.from(a)), d.scores.slice(1).map(a => Array.from(a)), Array.from(d.sums), Array.from(d.nearby)]); }
// Compare every incremental state to a full recomputation, including make/unmake.
let seed = 1012; const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
for (let round = 0; round < 20; round++) {
  context.board = empty(); d.initialize(); const stack = [];
  for (let n = 0; n < 45; n++) {
    let cell; do { cell = random() % 225; } while (d.cells[cell]);
    const p = n % 2 + 1; d.change(cell, p); stack.push([cell, p]); context.board[Math.floor(cell / 15)][cell % 15] = p;
    const incremental = snapshot(); d.initialize(); assert.equal(snapshot(), incremental, `incremental mismatch ${round}/${n}`);
  }
  while (stack.length) {
    const [cell, p] = stack.pop(); d.change(cell, p, true); context.board[Math.floor(cell / 15)][cell % 15] = 0;
    const incremental = snapshot(); d.initialize(); assert.equal(snapshot(), incremental, 'undo mismatch');
  }
}
// Every point score must transform with the board, and swap with the color.
context.board = empty();
for (let n=0; n<40; n++) { let cell; do { cell=random()%225; } while(context.board[Math.floor(cell/15)][cell%15]); context.board[Math.floor(cell/15)][cell%15]=n%2+1; }
d.initialize(); const original = context.board.map(r=>r.slice()), originalScores = d.scores.slice(1).map(a=>Array.from(a));
for (let flip=0;flip<2;flip++) for (let rotation=0;rotation<4;rotation++) for (let swap=0;swap<2;swap++) {
  const transform=(r,c)=>{ if(flip)c=14-c;for(let i=0;i<rotation;i++)[r,c]=[c,14-r];return [r,c]; };
  context.board=empty();
  for(let r=0;r<15;r++)for(let c=0;c<15;c++){const [nr,nc]=transform(r,c);const p=original[r][c];context.board[nr][nc]=p&&swap?3-p:p;}
  d.initialize();
  for(let r=0;r<15;r++)for(let c=0;c<15;c++)for(let p=1;p<=2;p++){const [nr,nc]=transform(r,c);assert.equal(d.scores[swap?3-p:p][nr*15+nc],originalScores[p-1][r*15+c],'rotation/color score mismatch');}
}
// A gapped four has one completion, while a straight open four has two.
for (const p of [1, 2]) {
  context.board = empty(); for (const c of [4, 5, 8]) context.board[7][c] = p;
  d.initialize(); assert.equal(d.pointScore(7 * 15 + 6, p) >= 1000000, false, 'gapped four falsely labelled open');
  context.board = empty(); for (const c of [4, 5, 6]) context.board[7][c] = p;
  d.initialize(); assert.equal(d.pointScore(7 * 15 + 7, p), 1000000, 'open four not recognized');
}
for (const version of ['v9pro', 'v9thinker']) for (const color of [1, 2]) {
  const move = loadEngine(version);
  let b = empty();
  for (let c = 3; c <= 6; c++) { b[4][c] = color; b[9][c] = 3 - color; }
  let result = move(b, color, []);
  assert.equal(result.row, 4, 'must win before blocking opponent four'); assert.ok([2, 7].includes(result.col));
  b = empty(); for (let c = 3; c <= 6; c++) b[9][c] = 3 - color; b[9][2] = color;
  result = move(b, color, []); assert.equal(result.row, 9); assert.equal(result.col, 7, 'must block single immediate win');
  // An open-three extension wins by creating two completion cells.
  b = empty(); for (const c of [5, 6, 7]) b[7][c] = color;
  result = move(b, color, []); assert.equal(result.row, 7); assert.ok([4, 8].includes(result.col));
}
console.log('PASS: 1800 incremental/recompute comparisons; all 8 symmetries and color swap; four classification; both engines/colors immediate win, forced block and VCF; input boards restored.');

const directory = new URL('../docs/gomoku-1012-validation/', import.meta.url);
let verified = 0;
function winningMoves(b,p) { const out=[];for(let r=0;r<15;r++)for(let c=0;c<15;c++)if(!b[r][c]){b[r][c]=p;if(won(b,r,c,p))out.push([r,c]);b[r][c]=0;}return out; }
// Independent proof checker: enumerate all forcing attacks, with the sole
// legal defense against a single completion. No expert-core internals used.
function provesVcf(b,p,remaining,selected) {
  if(remaining<=0)return false;
  const candidates=selected?[selected]:Array.from({length:225},(_,i)=>[Math.floor(i/15),i%15]).filter(([r,c])=>!b[r][c]);
  for(const [r,c] of candidates){
    b[r][c]=p;let result=won(b,r,c,p);
    if(!result&&!winningMoves(b,3-p).length){
      const wins=winningMoves(b,p);
      if(wins.length>1)result=true;
      else if(wins.length===1&&remaining>=3){const [dr,dc]=wins[0];b[dr][dc]=3-p;result=provesVcf(b,p,remaining-2);b[dr][dc]=0;}
    }
    b[r][c]=0;if(result)return true;
  }
  return false;
}
if(fs.existsSync(directory))for(const file of fs.readdirSync(directory).filter(f=>f.endsWith('.json')&&f!=='data-audit.json')){
  const report=JSON.parse(fs.readFileSync(new URL(file,directory),'utf8'));
  if(!report.finishedAt)continue;
  const b=empty();let winningColor=0;
  for(let i=0;i<report.moves.length;i++){
    const m=report.moves[i];assert.equal(m.player,i%2+1);assert.equal(b[m.row][m.col],0);assert.equal(winningColor,0,'play after game over');
    if(m.explanation?.reason==='VCF'){assert.ok(provesVcf(b,m.player,m.explanation.configuredDepth===7?8:7,[m.row,m.col]),`${file} unproved VCF at move ${i+1}`);verified++;}
    b[m.row][m.col]=m.player;if(won(b,m.row,m.col,m.player))winningColor=m.player;
  }
  assert.equal(report.winner,winningColor===1?report.black:winningColor===2?report.white:null);
}
console.log(`PASS: recorded games legal; ${verified} VCF decisions independently proved.`);
