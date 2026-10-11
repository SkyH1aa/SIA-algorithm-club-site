'use strict';
self.window=self;
let board,aiColor,playerColor,gameMoves=[];
let currentId=0;
function updateExplain(stats) {
  if(stats.move)postMessage({type:'progress',id:currentId,move:stats.move,stats});
}
if(!self.createGomokuExpert) {
  importScripts('../expert-core.js','../v9thinker.js','../v10-core.js','../v10.js',
    '../../data/gomoku-training-model.js','./proof-core.js');
}
const proof=self.createGomokuExpProofExpert({depth:8,candidates:20,timeMs:18000,threatDepth:12,vcfMs:18000,training:()=>null});
self.onmessage=({data:req})=>{
  currentId=req.id;
  try {
    if(req.op==='preload')return postMessage({type:'ready',id:req.id});
    board=req.board; aiColor=req.color; playerColor=3-aiColor; gameMoves=req.history||[];
    if(req.op==='proof')return postMessage({type:'result',id:req.id,proof:proof.proveForcing(req.timeMs)});
    const engine=req.engine==='thinker'?self.GomokuV9Thinker:self.GomokuV10;
    const move=engine.findBestMove();
    postMessage({type:'result',id:req.id,move,stats:engine.lastSearch});
  } catch(error){postMessage({type:'error',id:req.id,error:String(error.stack||error)});}
};
