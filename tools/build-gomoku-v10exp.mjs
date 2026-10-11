import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const models=path.join(root,'public/gomoku-models');
const dir=path.join(models,'v10exp');
fs.mkdirSync(dir,{recursive:true});
const read=name=>fs.readFileSync(path.join(models,name),'utf8');
// Keep both production cores unchanged. The derivative adds a proof-only API;
// it never treats an unfinished tactical search as a safety certificate.
let core=read('v10-core.js').replace('createGomokuV10Expert','createGomokuExpProofExpert');
core=core.replace('    return { findBestMove, clearCache()', `    function proveForcing(timeMs) {
      const started=performance.now(); deadline=started+timeMs;
      aborted=false; nodes=qnodes=0; rootColor=aiColor;
      initialize(); rootPriors=new Map();
      const cell=forcingWin(rootColor,config.threatDepth,0,deadline);
      return { proved:cell>=0, move:cell>=0?{row:Math.floor(cell/15),col:cell%15}:null,
        nodes, elapsedMs:performance.now()-started, aborted:aborted||performance.now()>=deadline };
    }
    return { proveForcing, findBestMove, clearCache()`);
fs.writeFileSync(path.join(dir,'proof-core.js'),'// Generated derivative; rebuild with tools/build-gomoku-v10exp.mjs.\n'+core);
const pack={expert:read('expert-core.js'),thinker:read('v9thinker.js'),v10core:read('v10-core.js'),
  v10:read('v10.js'),training:fs.readFileSync(path.join(root,'public/data/gomoku-training-model.js'),'utf8'),
  proof:fs.readFileSync(path.join(dir,'proof-core.js'),'utf8'),worker:read('v10exp/expert-worker.js'),
  neuralWorker:read('v10exp/neural-worker.js').replace("return new URL('../v10ultra/', self.location.href).href", "if (inlineAssets) return ''; return new URL('../v10ultra/', self.location.href).href")};
fs.writeFileSync(path.join(dir,'file-package.js'),'// Generated; original experts and unchanged priors.\nwindow.GOMOKU_V10EXP_FILE_PACKAGE='+JSON.stringify(pack)+';\n');
console.log('Built independent V10Exp proof core and file-origin source package.');
