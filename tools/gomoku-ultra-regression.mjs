import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const reportDir = path.join(root, 'docs/gomoku-ultra-1013-analysis');
export const source = '五子棋训练数据1013/gomoku-20261011121404834-5ea23e88-c0a2-4b8b-b7b4-29e01d2ae80a.json';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const emptyBoard = () => Array.from({length:15}, () => Array(15).fill(0));
export function won(b, r, c, color) {
  return [[1,0],[0,1],[1,1],[1,-1]].some(([dr,dc]) => {
    let n = 1;
    for (const sign of [-1,1]) for (let i=1; i<15; i++) {
      if (b[r+sign*dr*i]?.[c+sign*dc*i] !== color) break;
      n++;
    }
    return n >= 5;
  });
}
export function winningPoints(b, color) {
  const points = [];
  for (let r=0;r<15;r++) for (let c=0;c<15;c++) if (!b[r][c]) {
    b[r][c] = color;
    if (won(b,r,c,color)) points.push([r,c]);
    b[r][c] = 0;
  }
  return points;
}
export function replay(history) {
  const board = emptyBoard(); let winner = null;
  history.forEach((m,i) => {
    assert.equal(winner, null, 'Move after terminal win');
    assert.equal(m.player, i%2+1, 'Invalid alternating colors');
    assert.ok(Number.isInteger(m.row) && Number.isInteger(m.col));
    assert.equal(board[m.row]?.[m.col], 0, 'Illegal or occupied coordinate');
    board[m.row][m.col] = m.player;
    if (won(board,m.row,m.col,m.player)) winner=m.player;
  });
  return {board,winner};
}
export function transform([r,c], symmetry) {
  if (symmetry>=4) c=14-c;
  for (let n=0;n<symmetry%4;n++) [r,c]=[c,14-r];
  return [r,c];
}
export function fixtures() {
  const record=JSON.parse(fs.readFileSync(path.join(root,source),'utf8'));
  const audit=JSON.parse(fs.readFileSync(path.join(reportDir,'audit.json'),'utf8'));
  const samples=[];
  for (const swapped of [false,true]) for (let symmetry=0;symmetry<8;symmetry++) {
    const mapMove=m => {
      const [row,col]=transform([m.row,m.col],symmetry);
      return {row,col,player:swapped?3-m.player:m.player};
    };
    // Add a quiet black corner before swapping the original colors. This keeps
    // black-first alternation legal. It is a synthetic test, not a new game.
    const h=record.moves.slice(0,13).map(mapMove);
    if (swapped) { const [row,col]=transform([0,0],symmetry);h.unshift({row,col,player:1}); }
    const sample={id:`ply14-${swapped?'black-synthetic':'white-recorded'}-s${symmetry}`,
      source, coordinates:'zero-based row,col', symmetry, synthetic:swapped,
      toMove:swapped?1:2, history:h,
      knownLosingMove:transform([6,5],symmetry),
      unprovedAlternative:transform([2,9],symmetry),
      alternativeLabel:'No VCF found is not a proof of safety or a win',
      forcingLine:audit.afterPly14ForcedLine.map(m=>mapMove({
        row:m.point[0]-1,col:m.point[1]-1,player:m.player}))};
    samples.push(sample);
  }
  return samples;
}
export function createProver() {
  const context={performance,board:[],aiColor:1,gameMoves:[],updateExplain(){}};
  context.window=context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root,'public/gomoku-models/v10exp/proof-core.js'),'utf8'),context);
  const expert=context.createGomokuExpProofExpert({depth:8,candidates:20,timeMs:1500,
    threatDepth:20,vcfMs:1500,training:()=>null});
  return (history,attacker,timeMs=1500) => {
    context.board=replay(history).board;
    context.aiColor=attacker;context.gameMoves=history;
    return JSON.parse(JSON.stringify(expert.proveForcing(timeMs)));
  };
}
export function diagnosticFixtures() {
  const samples=fixtures();
  const record=JSON.parse(fs.readFileSync(path.join(root,source),'utf8'));
  for(const ply of [2,4,6,8,10,12]) samples.push({id:`ply${ply}-white-recorded-s0`,toMove:2,
    history:record.moves.slice(0,ply-1).map(({row,col,player})=>({row,col,player})),
    recordedMove:[record.moves[ply-1].row,record.moves[ply-1].col]});
  const base=samples[0];
  samples.push({id:'after-alternative-black-recorded-s0',toMove:1,
    history:[...base.history,{row:2,col:9,player:2}]});
  return samples;
}
export function verifyCertificate(sample) {
  const history=[...sample.history,{row:sample.knownLosingMove[0],col:sample.knownLosingMove[1],player:sample.toMove}];
  const {board}=replay(history), attacker=3-sample.toMove;
  for (let i=0;i<sample.forcingLine.length;i++) {
    const m=sample.forcingLine[i];
    assert.equal(board[m.row][m.col],0);
    if (m.player===sample.toMove) {
      assert.deepEqual(winningPoints(board,attacker),[[m.row,m.col]],'Defender must have exactly this forced block');
      assert.equal(winningPoints(board,sample.toMove).length,0,'Defender has counter-win');
    }
    board[m.row][m.col]=m.player;
    assert.equal(won(board,m.row,m.col,m.player),false,'Unexpected earlier terminal win');
  }
  const wins=winningPoints(board,attacker);
  assert.ok(wins.length>=2);
  assert.equal(winningPoints(board,sample.toMove).length,0);
  // Verify all possible final replies, including non-blocks, rather than merely
  // trusting the proof engine's own score or matching the historical moves.
  for(let r=0;r<15;r++)for(let c=0;c<15;c++)if(!board[r][c]) {
    board[r][c]=sample.toMove;
    assert.equal(won(board,r,c,sample.toMove),false);
    assert.ok(winningPoints(board,attacker).length>0);
    board[r][c]=0;
  }
  return {id:sample.id,certificateVerified:true,forcingPlies:13,finalWinningPoints:wins};
}
export function census() {
  const directories=fs.readdirSync(root).filter(n=>/^五子棋训练数据\d+$/.test(n)).sort();
  const raw=new Set(),perspectives=new Set(),games=new Map(),positions=new Set(),ultraGames=new Set();
  const invalid=[],periods=[];let records=0;
  for(const dir of directories) {
    let count=0;
    for(const file of fs.readdirSync(path.join(root,dir)).filter(f=>/^gomoku-.*\.json$/.test(f))) {
      const bytes=fs.readFileSync(path.join(root,dir,file)); records++;count++;raw.add(sha256(bytes));
      try {
        const g=JSON.parse(bytes),{board,winner}=replay(g.moves);
        assert.ok(g.moves.length>0);
        assert.ok(winner || g.moves.length===225,'Incomplete game');
        const color=Number(g.ai_color ?? g.model_color);
        assert.ok(color===1 || color===2);
        const expected=winner?(winner===color?'win':'loss'):'draw';
        assert.equal(g.result,expected,'Result inconsistent with board');
        const key=g.moves.map(m=>`${m.row},${m.col},${m.player}`).join(';');
        const id=sha256(key);
        perspectives.add(`${id}|${g.model_version}|${color}|${g.result}`);
        if(Number(g.model_version)===10.1)ultraGames.add(id);
        if(!games.has(id))games.set(id,{plies:g.moves.length,winner});
        const b=emptyBoard();
        g.moves.forEach(m=>{positions.add(b.flat().join('')+'|'+m.player);b[m.row][m.col]=m.player;});
      } catch(e) {invalid.push({file:`${dir}/${file}`,error:e.message});}
    }
    periods.push({directory:dir,files:count});
  }
  return {generatedAt:new Date().toISOString(),periods,files:records,uniqueRawFiles:raw.size,
    validUniquePerspectives:perspectives.size,uniqueCompleteTrajectories:games.size,
    uniqueBoardPositions:positions.size,ultraUniqueCompleteTrajectories:ultraGames.size,
    invalid,notes:['Trajectories merge timestamp/download/perspective duplicates, not symmetries.',
      'Positions are highly correlated; these are not independent training examples.',
      'No teacher policy/value/search-depth labels are supplied by these records.']};
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  fs.mkdirSync(reportDir,{recursive:true});
  const samples=fixtures(), prove=createProver();
  const verified=samples.map(sample=>{
    const certificate=verifyCertificate(sample);
    const after=[...sample.history,{row:sample.knownLosingMove[0],col:sample.knownLosingMove[1],player:sample.toMove}];
    const proof=prove(after,3-sample.toMove);
    assert.equal(proof.proved,true,`${sample.id} missed proven VCF`);
    return {...certificate,proof};
  });
  const data=census();
  fs.writeFileSync(path.join(reportDir,'tactical-fixtures.json'),JSON.stringify({samples},null,2)+'\n');
  fs.writeFileSync(path.join(reportDir,'tactical-regression.json'),JSON.stringify({passed:verified.length,verified},null,2)+'\n');
  fs.writeFileSync(path.join(reportDir,'training-census.json'),JSON.stringify(data,null,2)+'\n');
  console.log(JSON.stringify({passed:verified.length,census:data},null,2));
}
