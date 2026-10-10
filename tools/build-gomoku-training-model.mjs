import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const boardSize = 15;
const outputPath = path.join(root, 'public', 'data', 'gomoku-training-model.js');
const v9TrainingPeriodLimit = 1010;

function transform(row, col, rotation, reflected) {
  let r = row;
  let c = reflected ? boardSize - 1 - col : col;
  for (let i = 0; i < rotation; i++) [r, c] = [c, boardSize - 1 - r];
  return [r, c];
}

function canonicalKey(aiColor, history, moveNumber, move) {
  const variants = [];
  for (let reflected = 0; reflected < 2; reflected++) {
    for (let rotation = 0; rotation < 4; rotation++) {
      const [r, c] = transform(move.row, move.col, rotation, reflected);
      const state = history.map(previousMove => {
        const [historyRow, historyCol] = transform(previousMove.row, previousMove.col, rotation, reflected);
        return `${previousMove.player}:${historyRow},${historyCol}`;
      }).join(';');
      variants.push(`${aiColor}|${moveNumber}|${state}|${r},${c}`);
    }
  }
  return variants.sort()[0];
}

const directories = (await readdir(root, { withFileTypes: true }))
  .filter(entry => entry.isDirectory() && /^五子棋训练数据/.test(entry.name))
  .map(entry => entry.name)
  .sort();

async function buildModel(sourceDirectories) {
  const outcomes = { win: 0, loss: 0, draw: 0 };
  const priors = {};
  let gameCount = 0;
  for (const directory of sourceDirectories) {
    const directoryPath = path.join(root, directory);
    const files = (await readdir(directoryPath, { withFileTypes: true }))
      .filter(entry => entry.isFile() && /^gomoku-.*\.json$/i.test(entry.name))
      .map(entry => entry.name)
      .sort();

    for (const file of files) {
      const game = JSON.parse(await readFile(path.join(directoryPath, file), 'utf8'));
      if (!['win', 'loss', 'draw'].includes(game.result) || !Array.isArray(game.moves)) continue;
      const playerColor = game.player_color ?? game.playerColor;
      const aiColor = game.ai_color ?? game.aiColor;
      if (![1, 2].includes(playerColor) || ![1, 2].includes(aiColor) || playerColor === aiColor) continue;

      gameCount++;
      outcomes[game.result]++;
      let aiMoveNumber = 0;
      for (let moveIndex = 0; moveIndex < game.moves.length; moveIndex++) {
        const move = game.moves[moveIndex];
        if (move.player !== aiColor || aiMoveNumber >= 4) continue;
        aiMoveNumber++;
        const key = canonicalKey(aiColor, game.moves.slice(0, moveIndex), aiMoveNumber, move);
        const entry = priors[key] ??= { win: 0, loss: 0, draw: 0 };
        entry[game.result]++;
      }
    }
  }

  return {
    schema: 'algorithm-club.gomoku-opening-model.v1',
    gameCount,
    outcomes,
    sourceDirectories,
    priors
  };
}

const legacyDirectories = directories.filter(directory => {
  const match = directory.match(/^五子棋训练数据(\d+)$/);
  return match && Number(match[1]) < v9TrainingPeriodLimit;
});
const cumulativeModel = await buildModel(directories);
const v9Model = await buildModel(legacyDirectories);
const output = [
  `window.GOMOKU_TRAINING_MODEL = ${JSON.stringify(cumulativeModel)};`,
  'window.GOMOKU_V9PRO_TRAINING_MODEL = window.GOMOKU_TRAINING_MODEL;',
  `window.GOMOKU_V9_TRAINING_MODEL = ${JSON.stringify(v9Model)};`,
  ''
].join('\n');
await writeFile(outputPath, output, 'utf8');
console.log(`Built ${Object.keys(cumulativeModel.priors).length} cumulative opening patterns from ${cumulativeModel.gameCount} games in ${directories.length} training folders.`);
console.log(`Built ${Object.keys(v9Model.priors).length} V9 opening patterns from ${v9Model.gameCount} games in ${legacyDirectories.length} training folders.`);
