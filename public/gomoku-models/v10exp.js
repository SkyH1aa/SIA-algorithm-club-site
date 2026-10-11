(function () {
  'use strict';
  const base=new URL('./',document.currentScript.src);
  const TIME_MS=180000;
  let generation=0,sequence=0,ready=null,lastSearch=null,packagePromise=null;
  const slots=new Map();
  function loadScript(url,key) {
    if(window[key])return Promise.resolve(window[key]);
    return new Promise((resolve,reject)=>{
      const script=document.createElement('script');script.src=url;
      script.onload=()=>window[key]?resolve(window[key]):reject(new Error('融合资源包缺失'));
      script.onerror=()=>reject(new Error('融合资源加载失败'));document.head.append(script);
    });
  }
  function packages() {
    return packagePromise ||= Promise.all([
      loadScript(new URL('v10exp/file-package.js',base).href,'GOMOKU_V10EXP_FILE_PACKAGE'),
      loadScript(new URL('v10ultra/file-package.js',base).href,'GOMOKU_V10ULTRA_FILE_PACKAGE')
    ]).catch(error=>{packagePromise=null;throw error;});
  }
  const decode=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0)).buffer;
  function dispose(name) {
    const slot=slots.get(name);if(!slot)return;
    slot.worker.terminate();if(slot.url)URL.revokeObjectURL(slot.url);
    for(const p of slot.pending.values()){clearTimeout(p.timer);p.reject(new Error('V10Exp 搜索已停止'));}
    slots.delete(name);
  }
  function clearCache(){generation++;ready=null;for(const name of [...slots.keys()])dispose(name);}
  async function create(name) {
    if(slots.has(name))return slots.get(name);
    const gen=generation;let worker,url=null,assets=null;
    if(location.protocol==='file:') {
      const [exp,rapfi]=await packages();
      if(gen!==generation)throw new Error('V10Exp 对局已重置');
      const source=name==='neural'?rapfi.rapfiSource+'\n'+exp.neuralWorker:
        'self.window=self;\n'+exp.expert+'\n'+exp.thinker+'\n'+exp.v10core+'\n'+exp.v10+'\n'+exp.training+'\n'+exp.proof+'\n'+exp.worker;
      url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));worker=new Worker(url);
      if(name==='neural')assets={wasm:decode(rapfi.wasmBase64),data:decode(rapfi.dataBase64)};
    } else worker=new Worker(new URL('v10exp/'+(name==='neural'?'neural-worker':'expert-worker')+'.js',base));
    const slot={worker,url,pending:new Map(),busy:false};slots.set(name,slot);
    worker.onmessage=({data})=>{
      const p=slot.pending.get(data.id);if(!p)return;
      if(data.type==='loading')return;
      if(data.type==='progress'){p.progress?.(data);return;}
      clearTimeout(p.timer);slot.pending.delete(data.id);slot.busy=false;
      data.type==='error'?p.reject(new Error(data.error)):p.resolve(data);
    };
    worker.onerror=event=>{
      for(const p of slot.pending.values()){clearTimeout(p.timer);p.reject(new Error(event.message||'V10Exp Worker failed'));}
      slot.pending.clear();slot.busy=false;
    };
    await request(name,{op:'preload',inlineAssets:assets},null,60000,assets?[assets.wasm,assets.data]:[]);
    return slot;
  }
  function request(name,req,progress,timeoutMs=180000,transfer=[]) {
    const slot=slots.get(name),id=++sequence;slot.busy=true;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{slot.pending.delete(id);reject(new Error('V10Exp '+name+' 超时'));dispose(name);},timeoutMs);
      slot.pending.set(id,{resolve,reject,timer,progress});slot.worker.postMessage({...req,id},transfer);
    });
  }
  function preload(){return ready ||= Promise.all(['neural','thinker','v10','proof'].map(create)).catch(error=>{clearCache();throw error;});}
  function won(b,r,c,p) {
    return [[1,0],[0,1],[1,1],[1,-1]].some(([dr,dc])=>{
      let n=1;for(const sign of [-1,1])for(let k=1;k<15;k++){if(b[r+dr*k*sign]?.[c+dc*k*sign]!==p)break;n++;}return n>=5;
    });
  }
  function immediate(b,p) {
    const moves=[];for(let r=0;r<15;r++)for(let c=0;c<15;c++)if(!b[r][c]&&won(b,r,c,p))moves.push({row:r,col:c});return moves;
  }
  const same=(a,b)=>a&&b&&a.row===b.row&&a.col===b.col;
  async function findBestMove(state={board,color:aiColor,history:gameMoves}) {
    await preload();const gen=generation,started=performance.now(),deadline=started+179000;
    const b=state.board.map(row=>row.slice()),color=state.color,history=state.history||gameMoves;
    const wins=immediate(b,color),blocks=immediate(b,3-color);
    if(wins.length||blocks.length){lastSearch={reason:wins.length?'immediate-win':'forced-block',elapsedMs:Math.round(performance.now()-started),depth:1};return (wins.length?wins:blocks)[0];}
    const observations={},expertTasks=[];
    let best=null,proven=false,neuralMove=null,timer,resolveProof;
    const proofReady=new Promise(resolve=>{resolveProof=resolve;});
    function observe(name,data){
      if(!data.move||b[data.move.row]?.[data.move.col]!==0)return;
      observations[name]=data;
      if(data.stats?.reason==='VCF'||data.stats?.reason==='win'){best=data.move;proven=true;resolveProof(best);}
      else if(!best)best=data.move;
      window.updateExplain?.({...data.stats,target:`${data.move.row+1}, ${data.move.col+1}`});
    }
    async function safe(move,timeMs) {
      const next=b.map(row=>row.slice());next[move.row][move.col]=color;
      if(immediate(next,3-color).length)return {proved:true,reason:'immediate-loss'};
      if(!slots.has('proof'))await create('proof');
      return (await request('proof',{op:'proof',board:next,color:3-color,
        history:[...history,{...move,player:color}],timeMs},null,timeMs+1000)).proof;
    }
    const search=(async()=>{
      for(const name of ['thinker','v10']) {
        if(!slots.has(name))await create(name);
        expertTasks.push(request(name,{op:'think',engine:name,board:b,color,history},data=>observe(name,data),42000)
          .then(data=>{observe(name,data);return data;}).catch(error=>({error:String(error)})));
      }
      const neural=await request('neural',{op:'think',boardSize:15,timeoutTurnMs:164000,maxDepth:18,maxNodes:0,
        playerIsBlack:color===2,stoneHistory:history.map(m=>({...m,piece:m.player===color?'ai':'player'}))},null,170000);
      neuralMove=neural.move;
      if(b[neuralMove.row]?.[neuralMove.col]!==0)throw new Error('V10Exp 自由网返回非法落点');
      if(proven)return best;
      const proofStart=performance.now();
      const check=await safe(neuralMove,Math.min(6500,Math.max(1,deadline-performance.now()-2000)));
      if(!check.proved){lastSearch={reason:'mix9-expert-checked',neural:neural.stats,proof:check};return neuralMove;}
      await Promise.all(expertTasks);
      const alternatives=[observations.v10?.move,observations.thinker?.move].filter(m=>m&&!same(m,neuralMove));
      for(const move of alternatives) {
        if(proven)return best;
        const remaining=deadline-performance.now()-1000;if(remaining<=0)break;
        const alternativeCheck=await safe(move,Math.min(5500,remaining));
        if(!alternativeCheck.proved){lastSearch={reason:'expert-rejected-forced-loss',neuralRejected:neuralMove,
          proof:check,alternativeProof:alternativeCheck,proofMs:performance.now()-proofStart};return move;}
      }
      lastSearch={reason:'no-proven-safe-alternative',proof:check};return neuralMove;
    })();
    // Main-thread watchdog stays responsive while every engine searches off-thread.
    // It uses only completed iterations / proved moves, never a random replacement.
    const watchdog=new Promise(resolve=>{timer=setTimeout(()=>resolve(proven?best:neuralMove||best),179000);});
    try {
      const move=await Promise.race([search,watchdog,proofReady]);
      if(gen!==generation)throw new Error('V10Exp 对局已重置');
      if(!move)throw new Error('V10Exp 预算结束前未取得完整迭代');
      lastSearch={...lastSearch,elapsedMs:Math.round(performance.now()-started),experts:observations,
        reason:proven?'expert-proved-win':lastSearch?.reason||'completed-iteration-deadline',configuredDepth:18};
      window.updateExplain?.({...lastSearch,target:`${move.row+1}, ${move.col+1}`});return move;
    } finally {
      clearTimeout(timer);
      for(const [name,slot]of slots)if(slot.busy)dispose(name);
      ready=null;
    }
  }
  window.GomokuV10Exp={findBestMove,preload,clearCache,timeMs:TIME_MS,get lastSearch(){return lastSearch;}};
})();
