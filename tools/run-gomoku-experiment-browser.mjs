import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [black, white, output, origin = 'http://127.0.0.1:4173', mode] = process.argv.slice(2);
if (!black || !white || !output) throw new Error('Usage: node tools/run-gomoku-experiment-browser.mjs <black|smoke> <white> <output> [origin]');
// Each match owns a separate tab, so independent full games can run without
// navigating or interrupting another match or a user's production page.
// GOMOKU_MATCH_SCRIPT turns one side into a replay of a recorded move list.
const script = process.env.GOMOKU_MATCH_SCRIPT || null;
const scriptColor = script ? (process.env.GOMOKU_MATCH_SCRIPT_COLOR || null) : null;
const opening = process.env.GOMOKU_MATCH_OPENING || null;
const query=black==='smoke'?'smoke=1':new URLSearchParams({black,white,...(script?{script}:{}),...(scriptColor?{scriptColor}:{}),...(opening?{opening}:{})}).toString();
const target = mode === '--attach'
  ? (await fetch('http://127.0.0.1:9223/json').then(r=>r.json())).find(t=>t.url.endsWith('?'+query))
  : await fetch('http://127.0.0.1:9223/json/new?about:blank', {method:'PUT'}).then(r=>r.json());
if(!target) throw new Error('Running match tab not found');
const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map(); let sequence = 0;
socket.onmessage = ({data}) => {
  const message = JSON.parse(data);
  const p = pending.get(message.id); if (!p) return;
  pending.delete(message.id);
  message.error ? p.reject(new Error(JSON.stringify(message.error))) : p.resolve(message.result);
};
await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
function call(method,params={}) {return new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression) {
  const result = await call('Runtime.evaluate',{expression,returnByValue:true});
  if(result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
const out = path.resolve(root,output); fs.mkdirSync(path.dirname(out),{recursive:true});
const files = ['public/gomoku-models/expert-core.js','public/gomoku-models/v9.js','public/gomoku-models/v9pro.js','public/gomoku-models/v9thinker.js','public/gomoku-models/v10-core.js','public/gomoku-models/v10.js',
  'public/gomoku-models/v10ultra.js','public/gomoku-models/v10ultra/worker.js','public/gomoku-models/v10ultra/rapfi-single.wasm',
  'public/gomoku-models/v11candidate.js','public/gomoku-models/v11candidate/worker.js',
  'public/gomoku-models/v10flash.js','public/gomoku-models/v10flash/worker.js',
  'public/gomoku-models/v10thinker.js','public/gomoku-models/v10thinker/worker.js',
  'public/gomoku-models/v10champion.js','public/gomoku-models/v10champion/worker.js',
  'public/gomoku-models/satori.js', 'public/gomoku-models/satori/worker.js', 'public/gomoku-models/satori/engine.js',
  'public/gomoku-models/v10champion/rapfi-single.js','public/gomoku-models/v10champion/rapfi.data',
  'public/gomoku-models/v10ultra/rapfi.data','public/gomoku-models/experimental/models.js',
  'public/gomoku-models/experimental/slowrenju/worker.js','public/gomoku-models/experimental/slowrenju/engine.wasm',
  'public/gomoku-models/experimental/gomokuzero/worker.js','public/gomoku-models/experimental/gomokuzero/model.onnx'];
if(black==='v10exp'||white==='v10exp') files.push('public/gomoku-models/v10exp.js','public/gomoku-models/v10exp/expert-worker.js','public/gomoku-models/v10exp/proof-core.js','public/gomoku-models/v10exp/neural-worker.js');
if(script) files.push(script.replace(/^\//, ''));
if(opening) files.push(opening.replace(/^\//, ''));
const fingerprints = Object.fromEntries(files.map(f=>[f,createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex')]));
try {
  await call('Page.enable'); await call('Runtime.enable');
  if(mode!=='--attach') await call('Page.navigate',{url:origin+'/tools/gomoku-experiment-browser.html?'+query});
  let moves=-1, lastLog=0;
  while(true) {
    const state=await evaluate('({done:window.validationResult||null,progress:window.validationProgress||null})');
    if(state.done) {
      if(state.done.error) throw new Error(state.done.error);
      fs.writeFileSync(out,JSON.stringify({...state.done,fingerprints},null,2)+'\n');
      console.log('RESULT',state.done.winner||state.done.result,state.done.moves?.length||'');break;
    }
    if(state.progress) {
      fs.writeFileSync(out,JSON.stringify({...state.progress,fingerprints},null,2)+'\n');
      const n=state.progress.moves?.length||0;
      if(n!==moves || Date.now()-lastLog>45000) {console.log('PROGRESS',black,white,n, state.progress.moves?.at(-1)?.elapsedMs||'');moves=n;lastLog=Date.now();}
    }
    await new Promise(resolve=>setTimeout(resolve,2000));
  }
} finally {
  socket.close();
  await fetch('http://127.0.0.1:9223/json/close/'+target.id);
}
