import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { won } from './gomoku-match.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root,'docs/gomoku-v10exp-validation');
const candidates=['v10exp'], baselines=['v9thinker','v10','v10ultra'];
const summary={generatedAt:new Date().toISOString(),complete:false,matches:[],candidates:{}};
for(const candidate of candidates) {
  const totals={wins:0,losses:0,draws:0,moves:0,meanMs:0,maxMs:0,medianMs:0,completed:0,opponents:{}};
  const durations=[];
  for(const baseline of baselines) {
    const results={};
    for(const [black,white] of [[candidate,baseline],[baseline,candidate]]) {
      const file=`${black}-black-${white}.json`,location=path.join(directory,file);
      if(!fs.existsSync(location)) continue;
      const report=JSON.parse(fs.readFileSync(location,'utf8'));
      if(!report.finishedAt) continue;
      assert.equal(report.black,black);assert.equal(report.white,white);
      assert.ok(!report.error);
      const board=Array.from({length:15},()=>Array(15).fill(0));
      let winning=null;
      for(const [i,move] of report.moves.entries()) {
        assert.equal(winning,null,`${file}: continued after winning`);
        assert.equal(move.move,i+1);assert.equal(move.player,i%2+1);
        assert.equal(move.model,move.player===1?black:white);
        assert.ok(Number.isInteger(move.row)&&Number.isInteger(move.col));
        assert.equal(board[move.row]?.[move.col],0,`${file}: illegal move`);
        board[move.row][move.col]=move.player;
        if(won(board,move.row,move.col,move.player)) winning=move.model;
        if(move.model===candidate) durations.push(move.elapsedMs);
      }
      assert.equal(report.winner,winning);
      assert.equal(report.result,winning?'win':'draw');
      if(!winning)assert.equal(report.moves.length,225,`${file}: premature draw`);
      for(const [source,hash] of Object.entries(report.fingerprints)) {
        assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root,source))).digest('hex'),hash,`${file}: changed resource ${source}`);
      }
      const result=winning===candidate?'win':winning?'loss':'draw';
      totals[result==='win'?'wins':result==='loss'?'losses':'draws']++;totals.completed++;
      results[black===candidate?'black':'white']=result;
      summary.matches.push({candidate,baseline,black,white,result,winner:winning,moves:report.moves.length,file});
    }
    totals.opponents[baseline]=results;
  }
  if(durations.length) {
    durations.sort((a,b)=>a-b);totals.moves=durations.length;
    totals.meanMs=Math.round(durations.reduce((a,b)=>a+b,0)/durations.length);
    totals.maxMs=durations.at(-1);totals.medianMs=durations[Math.floor(durations.length/2)];
  }
  summary.candidates[candidate]=totals;
}
summary.complete=summary.matches.length===6;
fs.writeFileSync(path.join(directory,'summary.json'),JSON.stringify(summary,null,2)+'\n');
fs.writeFileSync(path.join(root,'public/gomoku-models/v10exp/comparison.js'),
  'window.GOMOKU_V10EXP_COMPARISON = '+JSON.stringify(summary,null,2)+';\n');
console.log(JSON.stringify(summary,null,2));
if(!summary.complete) process.exitCode=2;
