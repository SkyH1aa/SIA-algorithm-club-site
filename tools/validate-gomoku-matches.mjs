import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const directory=path.join(root,'docs/gomoku-1012-validation');
const matrix=[
  ['pro-black-v8','v9pro','v8','v9pro'],['pro-white-v8','v8','v9pro','v9pro'],
  ['pro-black-v9','v9pro','v9','v9pro'],['pro-white-v9','v9','v9pro','v9pro'],
  ['thinker-black-v8','v9thinker','v8','v9thinker'],['thinker-white-v8','v8','v9thinker','v9thinker'],
  ['thinker-black-v9','v9thinker','v9','v9thinker'],['thinker-white-v9','v9','v9thinker','v9thinker'],
  ['thinker-black-pro','v9thinker','v9pro','v9thinker'],['thinker-white-pro','v9pro','v9thinker','v9thinker']
];
const sha=buffer=>createHash('sha256').update(buffer).digest('hex');
const rows=[];
for(const [name,black,white,winner] of matrix){
  const report=JSON.parse(fs.readFileSync(path.join(directory,name+'.json'),'utf8'));
  assert.ok(report.finishedAt,`${name}: incomplete`);assert.equal(report.black,black);assert.equal(report.white,white);assert.equal(report.winner,winner,`${name}: target not met`);
  assert.ok(report.fingerprints,`${name}: missing fingerprints`);
  for(const [file,hash] of Object.entries(report.fingerprints))assert.equal(sha(fs.readFileSync(path.join(root,file))),hash,`${name}: stale ${file}`);
  const stats={};
  for(const version of ['v9pro','v9thinker']){
    const moves=report.moves.filter(m=>(m.player===1?black:white)===version), search=moves.filter(m=>m.explanation.reason==='search');
    if(!moves.length)continue;
    const limit=version==='v9pro'?25000:40000;
    assert.ok(moves.every(m=>m.elapsedMs<=limit+500),`${name}: excessive time overrun`);
    stats[version]={moves:moves.length,searches:search.length,fullDepth:search.filter(m=>m.explanation.depth===m.explanation.configuredDepth).length,timeAborts:search.filter(m=>m.explanation.aborted).length,maxMs:Math.max(...moves.map(m=>m.elapsedMs))};
  }
  rows.push({name,black,white,winner,plies:report.moves.length,stats});
}
const protectedFiles=['public/gomoku-models/v8.html','public/gomoku-models/v9.js','supabase/functions/gomoku-training/index.ts'];
const protectedHashes={};
for(const file of protectedFiles){
  const current=fs.readFileSync(path.join(root,file));const previous=execFileSync('git',['show',`HEAD:${file}`],{cwd:root});
  assert.equal(sha(current),sha(previous),`${file} changed`);protectedHashes[file]=sha(current);
}
const current={window:{}},previous={window:{}};
vm.runInNewContext(fs.readFileSync(path.join(root,'public/data/gomoku-training-model.js'),'utf8'),current);
vm.runInNewContext(execFileSync('git',['show','HEAD:public/data/gomoku-training-model.js'],{cwd:root,encoding:'utf8'}),previous);
for(const name of ['GOMOKU_V9_TRAINING_MODEL','GOMOKU_V9THINKER_TRAINING_MODEL'])assert.equal(JSON.stringify(current.window[name]),JSON.stringify(previous.window[name]),`${name} changed`);
fs.writeFileSync(path.join(directory,'summary.json'),JSON.stringify({verifiedAt:new Date().toISOString(),scope:'10 color-swapped empty-board matches; production parameters; no claim for arbitrary openings or devices',protectedHashes,v9PriorUnchanged:true,thinkerPriorUnchanged:true,rows},null,2)+'\n');
console.table(rows.map(({black,white,winner,plies})=>({black,white,winner,plies})));
console.log('PASS: all ten targets, current source fingerprints, frozen V8/V9 and priors, unchanged edge function, production time limits.');
