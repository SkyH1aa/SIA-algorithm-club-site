import fs from 'node:fs';
import path from 'node:path';
import { won } from './gomoku-match.mjs';

const directory = process.argv[2] || '五子棋训练数据1012';
const files = fs.readdirSync(directory).filter(f => /^gomoku-.*\.json$/i.test(f));
const rawSeen = new Set(), games = new Map(), trajectories = new Set(), losses = [];
function immediate(board, color) {
  const result = [];
  for (let row=0; row<15; row++) for (let col=0; col<15; col++) if (!board[row][col]) {
    board[row][col] = color; if (won(board,row,col,color)) result.push(`${row},${col}`); board[row][col] = 0;
  }
  return result;
}
for (const file of files.sort()) {
  const raw = fs.readFileSync(path.join(directory,file),'utf8');
  if (rawSeen.has(raw)) continue; rawSeen.add(raw);
  const game = JSON.parse(raw), ai = game.ai_color;
  const black = ai === 1 ? game.model_version : game.opponent_model_version;
  const white = ai === 2 ? game.model_version : game.opponent_model_version;
  const sequence = game.moves.map(m=>`${m.player}:${m.row},${m.col}`).join(';');
  const trajectory = `${black}/${white}/${sequence}`; trajectories.add(trajectory);
  const group = games.get(trajectory) || { black, white, moves:game.moves.length, winner: game.moves.at(-1).player === 1 ? black : white, perspectives: [] };
  group.perspectives.push({ file, color:ai, result:game.result, created_at:game.created_at }); games.set(trajectory,group);
  if (game.result !== 'loss') continue;
  const board = Array.from({length:15},()=>Array(15).fill(0)), errors = [];
  for (const move of game.moves) {
    if (move.player === ai) {
      const own = immediate(board,ai), other = immediate(board,3-ai), selected = `${move.row},${move.col}`;
      if (own.length && !own.includes(selected)) errors.push({ move:move.move, type:'missed-win', options:own });
      if (!own.length && other.length === 1 && !other.includes(selected)) errors.push({ move:move.move, type:'missed-only-block', options:other });
    }
    board[move.row][move.col] = move.player;
  }
  losses.push({ file, model:game.model_version, color:ai, errors });
}
console.log(JSON.stringify({ directory, files:files.length, distinctPerspectiveRecords:rawSeen.size, duplicateDownloads:files.length-rawSeen.size, distinctTrajectories:trajectories.size, trajectories:[...games.values()], losingRecordTacticalAudit:losses },null,2));
