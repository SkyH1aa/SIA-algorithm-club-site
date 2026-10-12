import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Converts an arena match report into a training sample that
// tools/build-gomoku-training-model.mjs can read. The sample is written from
// the requested engine's own perspective, so its `result` is that engine's
// outcome rather than the game winner.
//   node tools/import-gomoku-match-as-sample.mjs <match.json> <engine> <output dir>
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [matchPath, engine, outputDirectory] = process.argv.slice(2);
if (!matchPath || !engine || !outputDirectory) throw new Error('Usage: node tools/import-gomoku-match-as-sample.mjs <match.json> <engine> <output dir>');

// Arena engine keys mapped to the model versions the production page uploads.
const VERSIONS = { v9: 9, v9pro: 9.1, v9thinker: 9.2, v10: 10, v10ultra: 10.1, v10flash: 10.4, v10exp: 10.3, slowrenju: 10.2, gomokuzero: 9.3 };

const report = JSON.parse(fs.readFileSync(path.resolve(root, matchPath), 'utf8'));
if (report.error) throw new Error(`match has an error: ${report.error}`);
if (!report.finishedAt || !report.moves?.length) throw new Error('match is unfinished');
const opponent = report.black === engine ? report.white : report.white === engine ? report.black : null;
if (!opponent) throw new Error(`${engine} did not play in ${matchPath}`);
if (!(engine in VERSIONS) || !(opponent in VERSIONS)) throw new Error(`unknown engine version for ${engine} or ${opponent}`);

const aiColor = report.black === engine ? 1 : 2;
const winner = report.winner;
const result = winner === engine ? 'win' : winner ? 'loss' : 'draw';
const moves = report.moves.map((move, index) => {
  if (move.move !== index + 1 || move.player !== index % 2 + 1) throw new Error(`move ${index + 1} is out of order or off-color`);
  return { move: move.move, row: move.row, col: move.col, player: move.player };
});
const sample = {
  schema: 'algorithm-club.gomoku-training.v1',
  result,
  model_version: VERSIONS[engine],
  nickname: '模型对战',
  player_color: 3 - aiColor,
  ai_color: aiColor,
  model_battle: true,
  model_color: aiColor,
  opponent_model_color: 3 - aiColor,
  opponent_model_version: VERSIONS[opponent],
  moves,
  move_count: moves.length,
  created_at: new Date().toISOString(),
  source: { arena_match: path.relative(root, path.resolve(root, matchPath)).split(path.sep).join('/'), rule: report.rule, winner, plies: report.moves.length }
};

const directory = path.resolve(root, outputDirectory);
fs.mkdirSync(directory, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '');
const fileName = `gomoku-${stamp}-${randomUUID()}.json`;
fs.writeFileSync(path.join(directory, fileName), JSON.stringify(sample, null, 2) + '\n');

console.log(`Imported ${path.relative(root, path.resolve(root, matchPath))} as ${path.join(outputDirectory, fileName)}`);
console.log(`${engine} (${VERSIONS[engine]}, ${aiColor === 1 ? 'black' : 'white'}) vs ${opponent} (${VERSIONS[opponent]}) -> ${result} in ${moves.length} plies`);
