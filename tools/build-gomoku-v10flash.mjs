import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Builds V10Flash's own expert assets, mirroring tools/build-gomoku-v10exp.mjs:
// a proof-only derivative of the frozen V10 core, plus a file:// package that
// carries the frozen expert sources, the training priors and the Rapfi bridge.
// The frozen originals (expert-core.js, v10-core.js, v9thinker.js, v10.js) are
// read only and never rewritten, and the generated core is V10Flash's own copy,
// so V10Flash does not depend on V10Exp's artifacts.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const models = path.join(root, 'public/gomoku-models');
const directory = path.join(models, 'v10flash');
fs.mkdirSync(directory, { recursive: true });
const read = name => fs.readFileSync(path.join(models, name), 'utf8');
const readModel = name => fs.readFileSync(path.join(root, 'public/data', name), 'utf8');

// Keep the production core unchanged in place: the derivative only adds a
// proof-only API and never treats an unfinished search as a safety certificate.
let core = read('v10-core.js').replace('createGomokuV10Expert', 'createGomokuFlashProofExpert');
core = core.replace('    return { findBestMove, clearCache()', `    function proveForcing(timeMs) {
      const started=performance.now(); deadline=started+timeMs;
      aborted=false; nodes=qnodes=0; rootColor=aiColor;
      initialize(); rootPriors=new Map();
      const cell=forcingWin(rootColor,config.threatDepth,0,deadline);
      return { proved:cell>=0, move:cell>=0?{row:Math.floor(cell/15),col:cell%15}:null,
        nodes, elapsedMs:performance.now()-started, aborted:aborted||performance.now()>=deadline };
    }
    return { proveForcing, findBestMove, clearCache()`);
fs.writeFileSync(path.join(directory, 'proof-core.js'), '// Generated derivative; rebuild with tools/build-gomoku-v10flash.mjs.\n' + core);

const pack = {
  rapfiSource: read('v10ultra/rapfi-single.js'),
  workerSource: read('v10flash/worker.js'),
  wasmBase64: fs.readFileSync(path.join(models, 'v10ultra/rapfi-single.wasm')).toString('base64'),
  dataBase64: fs.readFileSync(path.join(models, 'v10ultra/rapfi.data')).toString('base64'),
  expert: read('expert-core.js'),
  thinker: read('v9thinker.js'),
  v10core: read('v10-core.js'),
  v10: read('v10.js'),
  training: readModel('gomoku-training-model.js'),
  proof: fs.readFileSync(path.join(directory, 'proof-core.js'), 'utf8'),
  expertWorker: read('v10flash/expert-worker.js')
};
fs.writeFileSync(path.join(directory, 'file-package.js'),
  '// Generated; frozen experts and the same Rapfi engine/weights as the HTTP path.\nwindow.GOMOKU_V10FLASH_FILE_PACKAGE=' + JSON.stringify(pack) + ';\n');
console.log('Built V10Flash proof core and file-origin package (Rapfi bridge, frozen experts, training priors).');
