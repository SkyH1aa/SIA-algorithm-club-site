import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function loadEngine(version) {
  let explanation = {};
  const dummy = () => ({ style: {}, dataset: {}, classList: { add() {}, remove() {} }, appendChild() {}, addEventListener() {}, setAttribute() {}, innerHTML: '' });
  const sandbox = { console, performance, setTimeout() {}, clearTimeout() {}, BOARD_SIZE: 15,
    board: [], aiColor: 1, playerColor: 2, gameMoves: [], updateExplain(value) { explanation = { ...explanation, ...value }; },
    document: { getElementById: dummy, createElement: dummy, querySelector: dummy, querySelectorAll: () => [] },
    addEventListener() {}, parent: { postMessage() {} } };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, 'public/data/gomoku-training-model.js'), 'utf8'), context);
  if (version === 'v8') {
    const html = fs.readFileSync(path.join(root, 'public/gomoku-models/v8.html'), 'utf8');
    for (const script of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) vm.runInContext(script[1], context);
    vm.runInContext('window.testMove = (b, color) => { board = b; aiColor = color; playerColor = 3-color; transpositionTable.clear(); return findBestMoveWithMinimax(); };', context);
  } else {
    if (version !== 'v9') vm.runInContext(fs.readFileSync(path.join(root, 'public/gomoku-models/expert-core.js'), 'utf8'), context);
    vm.runInContext(fs.readFileSync(path.join(root, `public/gomoku-models/${version}.js`), 'utf8'), context);
  }
  return (board, color, history) => {
    explanation = {};
    sandbox.board = board.map(row => row.slice());
    sandbox.aiColor = color; sandbox.playerColor = 3-color; sandbox.gameMoves = history.map(move => ({ ...move }));
    const before = JSON.stringify(sandbox.board);
    const started = performance.now();
    const engine = { v9: 'GomokuV9', v9pro: 'GomokuV9Pro', v9thinker: 'GomokuV9Thinker' }[version];
    const move = version === 'v8' ? sandbox.testMove(sandbox.board, color) : sandbox[engine].findBestMove();
    const elapsedMs = Math.round(performance.now() - started);
    if (JSON.stringify(sandbox.board) !== before) throw new Error(`${version} mutated board`);
    if (!move || !Number.isInteger(move.row) || !Number.isInteger(move.col) || !board[move.row] || board[move.row][move.col] !== 0) throw new Error(`${version} illegal move ${JSON.stringify(move)}`);
    return { row: move.row, col: move.col, elapsedMs, explanation };
  };
}

export function won(board, row, col, color) {
  return [[1,0],[0,1],[1,1],[1,-1]].some(([dr,dc]) => {
    let count = 1;
    for (const sign of [-1,1]) for (let i=1; i<15; i++) {
      if (board[row+sign*dr*i]?.[col+sign*dc*i] !== color) break;
      count++;
    }
    return count >= 5;
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [black = 'v9pro', white = 'v8', output = '.tmp-gomoku-match.json', openingFile] = process.argv.slice(2);
  const engines = [null, loadEngine(black), loadEngine(white)];
  const board = Array.from({length:15},()=>Array(15).fill(0));
  const moves = openingFile ? JSON.parse(fs.readFileSync(openingFile, 'utf8')).moves : [];
  for (const move of moves) board[move.row][move.col] = move.player;
  const inputs = ['public/gomoku-models/expert-core.js', 'public/data/gomoku-training-model.js', ...[...new Set([black, white])].map(v => `public/gomoku-models/${v}.${v === 'v8' ? 'html' : 'js'}`)];
  const fingerprints = Object.fromEntries(inputs.map(file => [file, createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]));
  const report = { black, white, startedAt: new Date().toISOString(), limits: 'production, real monotonic clock', fingerprints, moves, winner: null };
  fs.mkdirSync(path.dirname(path.resolve(root, output)), { recursive: true });
  for (let i=moves.length; i<225; i++) {
    const player = i%2+1;
    const move = { ...engines[player](board, player, moves), player, move: i+1 };
    board[move.row][move.col] = player; moves.push(move);
    console.log(`${black}/${white} ${move.move} ${player===1?'B':'W'} ${move.row},${move.col} ${move.elapsedMs}ms depth=${move.explanation.depth} score=${move.explanation.score}`);
    if (won(board,move.row,move.col,player)) report.winner = player===1?black:white;
    fs.writeFileSync(path.resolve(root,output), JSON.stringify(report,null,2)+'\n');
    if (report.winner) break;
  }
  report.finishedAt = new Date().toISOString();
  report.result = report.winner ? 'win' : 'draw';
  fs.writeFileSync(path.resolve(root,output), JSON.stringify(report,null,2)+'\n');
  console.log('RESULT', report.winner || 'draw', moves.length);
}
