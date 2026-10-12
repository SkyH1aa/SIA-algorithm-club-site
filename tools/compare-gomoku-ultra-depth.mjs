import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {root,reportDir,sha256,diagnosticFixtures,replay,createProver} from './gomoku-ultra-regression.mjs';

// Each run uses a fresh Worker/TT. Time, binaries, rules and board are identical;
// only the requested depth limit changes. No backend or production page is used.
const depths=(process.env.GOMOKU_DEPTHS || '12,18,24').split(',').map(Number);
const pattern=process.env.GOMOKU_SAMPLE_PATTERN || '-s0$';
const samples=diagnosticFixtures().filter(s=>new RegExp(pattern).test(s.id));
assert.ok(samples.length && depths.every(n=>Number.isInteger(n)&&n>=2));
const budgetMs=75000;
const origin=process.env.GOMOKU_ORIGIN || 'http://127.0.0.1:4173';
const devtools=`http://127.0.0.1:${process.env.GOMOKU_CDP_PORT || 9223}`;
const output=path.resolve(process.argv[2] || path.join(reportDir,'depth-comparison.json'));
const target=await fetch(devtools+'/json/new?about:blank',{method:'PUT'}).then(r=>r.json());
const socket=new WebSocket(target.webSocketDebuggerUrl),pending=new Map();let sequence=0;
socket.onmessage=({data})=>{
  const m=JSON.parse(data),p=pending.get(m.id);if(!p)return;
  pending.delete(m.id);clearTimeout(p.timer);
  m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);
};
await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
function call(method,params={}) {
  return new Promise((resolve,reject)=>{
    const id=++sequence;
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout: '+method));},160000);
    pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));
  });
}
async function evaluate(expression,awaitPromise=false) {
  const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise});
  if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
}
const files=['public/gomoku-models/v10ultra.js','public/gomoku-models/v10ultra/worker.js',
  'public/gomoku-models/v10ultra/rapfi-single.js','public/gomoku-models/v10ultra/rapfi-single.wasm',
  'public/gomoku-models/v10ultra/rapfi.data','public/gomoku-models/v10exp/proof-core.js',
  'tools/gomoku-ultra-diagnostic-worker.js','tools/gomoku-ultra-diagnostic.html'];
const fingerprints=Object.fromEntries(files.map(f=>[f,sha256(fs.readFileSync(path.join(root,f)))]));
const report={startedAt:new Date().toISOString(),complete:false,budgetMs,depths,
  samples:samples.map(s=>s.id),coldWorkerPerSearch:true,fingerprints,results:[],
  limitations:['Configured maxDepth is not actual completed depth.',
    'An unproved opponent VCF does not establish safety or improved overall strength.',
    'Black defensive samples are synthetic legal color swaps with a quiet corner stone.',
    'This is a local position regression, not a complete-game strength evaluation.']};
fs.mkdirSync(path.dirname(output),{recursive:true});
const save=()=>{
  // Windows indexers may briefly hold the report between incremental writes.
  for(let attempt=0;;attempt++)try {
    fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');return;
  } catch(e) {
    if(attempt>=9 || !['UNKNOWN','EBUSY','EPERM','EACCES'].includes(e.code))throw e;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,100);
  }
};
try {
  await call('Page.enable');await call('Runtime.enable');await call('Network.enable');
  await call('Network.setCacheDisabled',{cacheDisabled:true});
  await call('Page.navigate',{url:origin+'/tools/gomoku-ultra-diagnostic.html'});
  for(let i=0;i<100;i++) {
    if(await evaluate('typeof window.runDiagnostic === "function"'))break;
    await new Promise(r=>setTimeout(r,100));
  }
  report.browser=await call('Browser.getVersion');
  for(const sample of samples)for(const depth of depths) {
    console.log('START',sample.id,depth);save();
    const result=await evaluate(`window.runDiagnostic(${JSON.stringify(sample)},${depth},${budgetMs})`,true);
    const after=[...sample.history,{...result.move,player:sample.toMove}];
    const {winner}=replay(after);
    result.opponentVCF=winner?null:createProver()(after,3-sample.toMove);
    result.knownLosingMove=sample.knownLosingMove?result.move.row===sample.knownLosingMove[0] && result.move.col===sample.knownLosingMove[1]:null;
    result.matchesUnprovedAlternative=sample.unprovedAlternative?result.move.row===sample.unprovedAlternative[0] && result.move.col===sample.unprovedAlternative[1]:null;
    result.recordedMove=sample.recordedMove || null;
    const summary=result.trace.map(t=>t.line).findLast(s=>/^MESSAGE Speed /.test(s));
    const parsed=summary?.match(/Depth (\d+)-(\d+) \| Eval (\S+) \| Node (\S+) \| Time (\S+)/);
    result.engineSummary=parsed?{completedDepth:Number(parsed[1]),selectiveDepth:Number(parsed[2]),
      evaluation:parsed[3],nodesText:parsed[4],timeText:parsed[5],raw:summary}:null;
    result.principalVariation=result.trace.map(t=>t.line).findLast(s=>/^MESSAGE Depth /.test(s)) || null;
    result.withinBudget=result.elapsedMs<=budgetMs;
    report.results.push(result);save();
    console.log('RESULT',JSON.stringify({sampleId:result.sampleId,depth,move:result.move,
      elapsedMs:result.elapsedMs,opponentVCF:result.opponentVCF?.proved,summary:result.engineSummary}));
  }
  report.complete=true;report.finishedAt=new Date().toISOString();save();
} catch(e) {report.error=e.stack;save();throw e;}
finally {
  for(const p of pending.values())clearTimeout(p.timer);
  socket.close();await fetch(devtools+'/json/close/'+target.id);
}
