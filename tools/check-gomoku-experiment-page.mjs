import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const targets=await fetch('http://127.0.0.1:9224/json').then(r=>r.json());
const socket=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
const pending=new Map();let id=0;
socket.onmessage=({data})=>{const m=JSON.parse(data),p=pending.get(m.id);if(!p)return;pending.delete(m.id);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);};
await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
const call=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});socket.send(JSON.stringify({id:n,method,params}));});
async function evaluate(expression){const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||JSON.stringify(r.exceptionDetails));return r.result.value;}
try {
  await call('Page.enable');await call('Runtime.enable');
  await call('Emulation.setDeviceMetricsOverride',{width:1280,height:980,deviceScaleFactor:1,mobile:false});
  const reports=[];
  for(const url of [pathToFileURL(path.join(root,'public/gomoku-experiments.html')).href,'http://127.0.0.1:4173/public/gomoku-experiments.html']) {
    await call('Page.navigate',{url});
    let loaded=false;
    for(let n=0;n<100;n++) {loaded=await evaluate('typeof resetGame === "function" && typeof GomokuExperiments !== "undefined"');if(loaded)break;await new Promise(r=>setTimeout(r,200));}
    assert.ok(loaded,'experiment page loaded');
    const report=await evaluate(`(async()=>{
      function check(c,m){if(!c)throw new Error(m);}
      let writes=0;
      const backendRequests=[];
      const originalFetch=window.fetch.bind(window);
      window.fetch=async(url,options={})=>{
        if(options.method && !['GET','HEAD'].includes(options.method.toUpperCase())) {
          writes++;backendRequests.push(String(url));throw new Error('Unexpected experiment backend request');
        }
        return originalFetch(url,options);
      };
      check(supabaseClient===null,'backend disabled');
      check(MODEL_VERSIONS.includes(10.2)&&MODEL_VERSIONS.includes(9.3),'both options registered');
      const expectedOrder=[1,2,3,6,7,8,9,9.1,9.3,9.2,10,10.2,10.4,10.3,10.1];
      populateBattleModels();
      check(JSON.stringify(MODEL_VERSIONS)===JSON.stringify(expectedOrder),'Experimental registry follows strength order');
      for(const selector of [modelVersionSelect,blackModelVersionSelect,whiteModelVersionSelect])
        check(JSON.stringify([...selector.options].map(o=>Number(o.value)))===JSON.stringify(expectedOrder),'Experimental selector order');
      document.getElementById('nickname').value='local-test';
      queueAIMove=()=>{};
      const results=[];
      for(const version of [10.2,9.3]) for(const color of [1,2]) {
        board=Array.from({length:15},()=>Array(15).fill(0));gameMoves=[];
        for(let col=4;col<8;col++){board[7][col]=color;board[3][col]=3-color;}
        if(color===2)board[0][0]=1;
        const move=await findModelMove(version,color);
        check(move.row===7&&[3,8].includes(move.col),'immediate win takes precedence for both colors');
        results.push({version,color,move});
        startAiCountdown(version);
        check(!document.getElementById('aiCountdown').hidden,'countdown visible');
        check(document.getElementById('aiCountdownLabel').textContent.includes('120.0'),'120-second budget');
        stopAiCountdown();
      }
      for(const mode of ['human','model-battle']) {
        gameModeSelect.value=mode;gameModeSelect.dispatchEvent(new Event('change'));
        check(board.flat().every(x=>x===0)&&gameMoves.length===0,'switch clears board');
        isModelBattle=mode==='model-battle';gameInProgress=true;resultSubmitted=false;
        activeModelVersion=10.2;blackModelVersion=10.2;whiteModelVersion=9.3;
        gameMoves=[{row:7,col:7,player:1}];moveCount=1;
        await finishGame(mode==='model-battle'?1:'win');
        check(!gameInProgress,'result exits active state');
      }
      check(writes===0,'no backend writes: '+backendRequests.join(','));
      check(await uploadGameTrainingData('local-test','win')===false,'direct upload refused');
      check(writes===0,'direct upload cannot write');
      for(const version of MODEL_VERSIONS)for(const result of ['win','loss','draw'])check(!canUploadTrainingResult(version,result),'all experimental-page uploads disabled');
      resetGame();check(board.flat().every(x=>!x),'reset clears board');
      return {source:location.protocol,results,noBackendWrites:true,countdownMs:120000};
    })()`);
    reports.push(report);console.log('PASS',url);
  }
  fs.writeFileSync(path.join(root,'docs/gomoku-experiment-validation/page-integration.json'),JSON.stringify(reports,null,2)+'\n');
  await new Promise(resolve=>setTimeout(resolve,1000));
  const shot=await call('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync(path.join(root,'docs/gomoku-experiment-validation/page.png'),Buffer.from(shot.data,'base64'));
} finally{socket.close();}
