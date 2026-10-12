(function () {
  'use strict';
  const SIZE = 15, THINK_MS = 90000, MAX_DEPTH = 16;
  const base = new URL('./', document.currentScript?.src || document.baseURI);
  let worker = null, ready = null, sequence = 0, generation = 0, lastSearch = null, assetsPromise = null;
  const pending = new Map();
  function win(board, row, col, color) {
    return [[1,0],[0,1],[1,1],[1,-1]].some(([dr,dc]) => {
      let total = 1;
      for (const sign of [-1,1]) for (let n=1;n<SIZE;n++) { if (board[row+sign*dr*n]?.[col+sign*dc*n] !== color) break; total++; }
      return total >= 5;
    });
  }
  function tactical(board, color) {
    const moves = [];
    for (let row=0;row<SIZE;row++) for (let col=0;col<SIZE;col++) if (!board[row][col]) {
      board[row][col] = color; const isWin = win(board,row,col,color); board[row][col] = 0;
      if (isWin) moves.push({row,col});
    }
    return moves;
  }
  function stoneHistory(history, color) { return (history || gameMoves || []).map(m => ({row:m.row,col:m.col,piece:m.player===color?'ai':'player'})); }
  function dispose(error) { worker?.terminate(); worker=null; if (error) for (const p of pending.values()) p.reject(error); pending.clear(); ready=null; assetsPromise=null; }
  function assets() {
    if (assetsPromise) return assetsPromise;
    assetsPromise = Promise.all([
      fetch(new URL('v10ultra/rapfi.data', base)).then(r => { if (!r.ok) throw new Error(`V11 data ${r.status}`); return r.arrayBuffer(); }),
      fetch(new URL('v10ultra/rapfi-single.wasm', base)).then(r => { if (!r.ok) throw new Error(`V11 wasm ${r.status}`); return r.arrayBuffer(); })
    ]).then(([data, wasm]) => ({data, wasm})).catch(error => { assetsPromise = null; throw error; });
    return assetsPromise;
  }
  function ensure() {
    if (ready) return ready;
    const gen = generation;
    ready = new Promise((resolve,reject) => {
      worker = new Worker(new URL('v11candidate/worker.js', base), {name:'gomoku-v11candidate'});
      worker.onmessage = ({data}) => {
        if (data.type === 'loading') return;
        const p = pending.get(data.id); if (!p) return;
        pending.delete(data.id); data.type === 'error' ? p.reject(new Error(data.error)) : p.resolve(data);
      };
      worker.onerror = e => { const err = new Error(e.message || 'V11 candidate Worker failed'); dispose(err); reject(err); };
      assets().then(inlineAssets => {
        const id=++sequence; pending.set(id,{resolve,reject}); worker.postMessage({op:'preload',id,inlineAssets}, [inlineAssets.data, inlineAssets.wasm]);
      }).catch(reject);
    }).then(() => { if (gen !== generation) throw new Error('V11 candidate reset'); return true; }).catch(e => { if (gen === generation) dispose(); throw e; });
    return ready;
  }
  function request(data) { return new Promise((resolve,reject) => { const id=++sequence; pending.set(id,{resolve,reject}); worker.postMessage({...data,id}); }); }
  async function findBestMove(state={board,color:aiColor,history:gameMoves}) {
    const board = state.board, color = state.color;
    const wins = tactical(board,color); if (wins.length) { lastSearch={reason:'immediate-win',depth:0,candidates:wins.length,elapsedMs:0}; return wins[0]; }
    const blocks = tactical(board,3-color); if (blocks.length) { lastSearch={reason:'forced-block',depth:0,candidates:blocks.length,elapsedMs:0}; return blocks[0]; }
    await ensure(); const started=performance.now(); const result=await request({op:'think',boardSize:SIZE,timeoutTurnMs:THINK_MS,maxDepth:MAX_DEPTH,maxNodes:0,playerIsBlack:color===2,stoneHistory:stoneHistory(state.history,color)});
    lastSearch={...result.stats,configuredDepth:MAX_DEPTH,reason:'rapfi-mix9-candidate',elapsedMs:Math.round(performance.now()-started)};
    window.updateExplain?.({...lastSearch,target:`${result.move.row+1}, ${result.move.col+1}`,move:result.move}); return result.move;
  }
  window.GomokuV11Candidate={findBestMove,preload:ensure,clearCache(){generation++;dispose(new Error('V11 candidate reset'));},timeMs:THINK_MS,depth:MAX_DEPTH,get lastSearch(){return lastSearch;}};
})();
