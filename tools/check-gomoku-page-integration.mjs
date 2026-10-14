import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targets = await fetch(`http://127.0.0.1:${process.env.GOMOKU_UI_PORT || 9222}/json`).then(response => response.json());
const target = targets.find(item => item.type === 'page');
assert.ok(target, 'Chrome DevTools page required on port 9222');
const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
let sequence = 0;
socket.addEventListener('message', event => {
  const message = JSON.parse(String(event.data));
  if (!pending.has(message.id)) return;
  const callbacks = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) callbacks.reject(new Error(JSON.stringify(message.error)));
  else callbacks.resolve(message.result);
});
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || JSON.stringify(result.exceptionDetails));
  return result.result.value;
}

try {
  await call('Page.enable');
  await call('Runtime.enable');
  await call('Network.enable');
  await call('Network.setCacheDisabled', {cacheDisabled:true});
  // Every backend operation is stubbed before the production page loads.
  // Validation never changes a real leaderboard or uploads training records.
  const injection = await call('Page.addScriptToEvaluateOnNewDocument', { source: `
    const client = {
      rpc: async () => ({error: null}),
      from() {
        const query = new Proxy({}, {get: (_target, key) => key === 'then'
          ? (resolve) => Promise.resolve({data: [], error: null}).then(resolve)
          : () => query});
        return query;
      }
    };
    Object.defineProperty(window, 'supabase', {get: () => ({createClient: () => client}), set() {}});
    window.fetch = async () => ({ok: true, json: async () => ({upload: {ok: true}})});
  ` });
  const reports = [];
  for (const url of [pathToFileURL(path.join(root, 'public/gomoku.html')).href, 'http://127.0.0.1:4173/public/gomoku.html']) {
    await call('Page.navigate', { url });
    let loaded = false;
    for (let i = 0; i < 100; i++) {
      loaded = await evaluate('typeof finishGame === "function" && typeof GomokuV10Ultra !== "undefined"');
      if (loaded) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.ok(loaded, `Production page did not load: ${url}`);
    const report = await evaluate(`(async () => {
      function check(condition, message) { if (!condition) throw new Error(message); }
      const uploads = [], scores = [];
      window.fetch = async (url, options) => {
        uploads.push(JSON.parse(options.body));
        return {ok: true, json: async () => ({upload: {ok: true}})};
      };
      supabaseClient.rpc = async (name, parameters) => { scores.push(parameters); return {error: null}; };
      loadLeaderboard = async () => {};
      ClubI18n.init();
      document.getElementById('nickname').value = 'integration-check';
      const versions = [1, 2, 3, 6, 7, 8, 9, 9.1, 9.2, 9.3, 10, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6];
      const eligible = [9.2, 10, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6];
      const expectedPoints = { '9.1': 10, '9.2': 12, '10': 12, '10.1': 15, '9.3': 9, '10.2': 14, '10.3': 15, '10.4': 15, '10.5': 16, '10.6': 15 };
      const expectedOrder=[1,2,3,6,7,8,9,9.1,9.3,9.2,10,10.2,10.4,10.3,10.1,10.5,10.6];
      check(JSON.stringify(MODEL_VERSIONS)===JSON.stringify(expectedOrder),'Strength order registry');
      populateBattleModels();
      for(const selector of [modelVersionSelect,blackModelVersionSelect,whiteModelVersionSelect]) {
        // 所有选项都参与强度顺序（V10Bru·我非我Champion 已开放，无禁用项）。
        const allOptions=[...selector.options];
        const enabled=allOptions.filter(o=>!o.disabled).map(o=>Number(o.value));
        check(JSON.stringify(enabled)===JSON.stringify(expectedOrder),'All three selectors follow strength order');
        for(const option of allOptions.filter(o=>!o.disabled))check(option.textContent===getModelName(Number(option.value)),'Selector model labels');
      }
      // V10Bru·我非我Champion 已全面开放：可挑战、可模型对战，且不再有禁用的待发布项。
      check([...modelVersionSelect.options].every(o=>!o.disabled),'No disabled model entries remain');
      check(MODEL_VERSIONS.includes(10.6),'V10Bru Champion is challengeable');
      check(getModelName(10.6)==='铭星V10Bru·我非我Champion','V10Bru Champion display name');
      check(getModelWinPoints(10.6)===15,'V10Bru Champion awards 15 points');
      for(const selector of [blackModelVersionSelect,whiteModelVersionSelect]) {
        check([...selector.options].some(o=>Number(o.value)===10.6),'V10Bru Champion is selectable in model battle');
      }
      for(const lang of ['zh','en']) {
        const hint=ClubI18n.t('gomoku.lbHint',{},lang);
        check(['V9Mesa','V10Mesa','V10Exp','V10Flash','V10Ultra','V10Thinker','V10Bru','14','15','16'].every(s=>hint.includes(s)),'Leaderboard points hint');
      }
      let humanCases = 0, battleCases = 0;
      for (const version of versions) for (const color of [1, 2]) for (const outcome of ['win', 'loss', 'draw']) {
        uploads.length = scores.length = 0;
        activeModelVersion = version; aiColor = color; playerColor = 3 - color;
        resultSubmitted = false; isModelBattle = false;
        gameMoves = [{row: 7, col: 7, player: 1}, {row: 6, col: 8, player: 2}]; moveCount = 2;
        await finishGame(outcome);
        const expectedResult = outcome === 'win' ? 'loss' : outcome === 'loss' ? 'win' : 'draw';
        check(uploads.length === (eligible.includes(version) ? 1 : 0), 'Human upload whitelist: ' + version);
        if (uploads.length) {
          check(uploads[0].result === expectedResult && uploads[0].modelVersion === version, 'Human result/version');
          check(uploads[0].aiColor === color && uploads[0].playerColor === 3 - color, 'Human colors');
          check(!uploads[0].modelBattle && !uploads[0].opponentModelVersion, 'Human mode leaked');
        }
        const points = expectedPoints[String(version)] || version;
        check(scores.length === 1 && scores[0].p_win_points === points && scores[0].p_result === outcome, 'Score RPC: ' + version);
        const award = outcome === 'win' ? points : outcome === 'draw' ? 1 : 0;
        const resultText = ClubI18n.t(outcome === 'win' ? 'gomoku.win' : outcome === 'draw' ? 'gomoku.draw' : 'gomoku.lose', {score: award, model: getModelName(version)});
        check(getModelWinPoints(version) === points && document.getElementById('result').textContent.startsWith(resultText), 'Displayed points');
        humanCases++;
      }
      for (const black of versions) for (const white of versions) for (const winner of [1, 2, null]) {
        uploads.length = 0; blackModelVersion = black; whiteModelVersion = white;
        await finishModelBattle(winner);
        check(uploads.length === Number(eligible.includes(black)) + Number(eligible.includes(white)), 'Battle upload count');
        for (const color of [1, 2]) {
          const version = color === 1 ? black : white;
          if (!eligible.includes(version)) continue;
          const record = uploads.find(entry => entry.aiColor === color);
          check(record && record.modelVersion === version && record.modelBattle === true, 'Battle version/mode');
          check(record.playerColor === 3 - color && record.opponentModelVersion === (color === 1 ? white : black), 'Battle colors/opponent');
          check(record.result === (winner === null ? 'draw' : winner === color ? 'win' : 'loss'), 'Battle result');
        }
        battleCases++;
      }
      for(const version of eligible) {
        uploads.length = scores.length = 0; resultSubmitted = false; isModelBattle = false; activeModelVersion = version;
        await finishGame('loss', {uploadTraining: false});
        check(uploads.length === 0, 'Surrender must not upload');
        check(scores.length===1 && scores[0].p_result==='loss' && scores[0].p_win_points===expectedPoints[String(version)],'Surrender still records loss');
      }
      // Exercise the real page dispatch and the real Worker for both colors,
      // then recreate the Worker as the Restart button does.
      const workerMoves = [];
      for (const color of [1, 2, 1]) {
        GomokuV10Ultra.clearCache();
        board = Array.from({length: 15}, () => Array(15).fill(0)); gameMoves = [];
        if (color === 2) { board[7][7] = 1; gameMoves.push({row: 7, col: 7, player: 1}); }
        const started = performance.now();
        const move = await findModelMove(10.1, color);
        check(move && Number.isInteger(move.row) && Number.isInteger(move.col) && board[move.row]?.[move.col] === 0, 'Worker legal move');
        workerMoves.push({color, move, elapsedMs: Math.round(performance.now() - started)});
      }
      GomokuV10Ultra.clearCache();
      const newWorkerMoves=[];
      for(const version of [9.3,10.2,10.3,10.4])for(const color of [1,2]) {
        board=Array.from({length:15},()=>Array(15).fill(0));gameMoves=[];
        for(let c=4;c<8;c++){board[7][c]=color;board[3][c]=3-color;}
        if(color===2)board[0][0]=1;
        const move=await findModelMove(version,color);
        check(move.row===7 && [3,8].includes(move.col),'New model own win priority');
        startAiCountdown(version);
        const expected=version===10.3?'180.0':version===10.4?'120.0':'120.0';
        check(!document.getElementById('aiCountdown').hidden && document.getElementById('aiCountdownLabel').textContent.includes(expected),'New budget countdown');
        stopAiCountdown();newWorkerMoves.push({version,color,move});
      }
      const expNeuralMoves=[];
      for(const color of [1,2]) {
        GomokuV10Exp.clearCache();
        board=Array.from({length:15},()=>Array(15).fill(0));gameMoves=[];
        if(color===2){board[7][7]=1;gameMoves=[{row:7,col:7,player:1}];}
        const move=await findModelMove(10.3,color);
        check(board[move.row]?.[move.col]===0,'Exp full engine legal move');
        expNeuralMoves.push({color,move,search:GomokuV10Exp.lastSearch});
      }
      GomokuV10Exp.clearCache();
      await GomokuV10Exp.preload();
      board=Array.from({length:15},()=>Array(15).fill(0));board[7][7]=1;
      gameMoves=[{row:7,col:7,player:1}];
      const interrupted=findModelMove(10.3,2).then(()=>false,()=>true);
      await new Promise(resolve=>setTimeout(resolve,100));
      GomokuV10Exp.clearCache();
      check(await interrupted,'Exp reset cancels active neural and expert search');
      // V10Flash runs the same Rapfi Mix9 Worker as V10Ultra, plus the opening
      // book built from its exclusive data boundary (period >= 1014).
      const bookA = GomokuV10Flash.bookFor(
        (()=>{const b=Array.from({length:15},()=>Array(15).fill(0));b[7][7]=1;return b;})(), 2, [{row:7,col:7,player:1}]);
      const bookACells = [...bookA.cells.keys()].sort();
      // The book's contract is "data-backed, in the first four plies, picking the
      // strongest recorded reply" -- the exact cells move as the archive grows, so
      // the assertions check that contract rather than a hard-coded cell.
      check(bookA && bookA.best.games>=4 && bookACells.includes(bookA.best.row+','+bookA.best.col), 'Book picks a data-backed reply');
      check(bookACells.length>=1 && bookACells.every(cell=>bookA.cells.get(cell).games>=4), 'Every book cell clears the sample threshold');
      check([...bookA.cells.values()].every(cell=>cell.score>0), 'Book only keeps non-negative records');
      const bookB = GomokuV10Flash.bookFor(Array.from({length:15},()=>Array(15).fill(0)), 1, []);
      check(bookB && bookB.best.row===7 && bookB.best.col===7, 'Book center opening');
      const bookC = GomokuV10Flash.bookFor(
        (()=>{const b=Array.from({length:15},()=>Array(15).fill(0));b[7][7]=1;b[5][9]=2;return b;})(), 1,
        [{row:7,col:7,player:1},{row:5,col:9,player:2}]);
      check(bookC===null, 'Book stays silent beyond its data');
      const flashWorkerMoves=[];
      for(const color of [1,2]) {
        GomokuV10Flash.clearCache();
        board=Array.from({length:15},()=>Array(15).fill(0));gameMoves=[];
        if(color===2){board[7][7]=1;gameMoves=[{row:7,col:7,player:1}];}
        const started=performance.now();
        const move=await findModelMove(10.4,color);
        check(move&&Number.isInteger(move.row)&&Number.isInteger(move.col)&&board[move.row]?.[move.col]===0,'Flash Worker legal move');
        if(color===1) check(move.row===7&&move.col===7,'Flash center opening agreed with the book');
        if(color===2) check(bookACells.indexOf(move.row+','+move.col)>=0,'Flash opening book constrained the reply');
        flashWorkerMoves.push({color,move,elapsedMs:Math.round(performance.now()-started),search:GomokuV10Flash.lastSearch});
      }
      // V10Thinker is pure Rapfi like V10Ultra: no tactical pre-check, so it is
      // checked for its countdown only (it must not be asserted to find wins).
      startAiCountdown(10.5);
      check(!document.getElementById('aiCountdown').hidden && document.getElementById('aiCountdownLabel').textContent.includes('75.0'),'V10Thinker budget countdown');
      stopAiCountdown();
      // A proven four-chase must be played at once, without calling the engine.
      board=Array.from({length:15},()=>Array(15).fill(0));gameMoves=[];
      [[7,4],[7,5],[7,6]].forEach(([r,c])=>{board[r][c]=1;gameMoves.push({row:r,col:c,player:1});});
      board[2][2]=2;gameMoves.push({row:2,col:2,player:2});
      check(GomokuV10Flash.threatsFor(board,1).openFour>=2,'V10Flash sees the open-four threats');
      const forced=await findModelMove(10.4,1);
      check(GomokuV10Flash.lastSearch.reason==='vcf-win','A proven forced win must be played as vcf-win');
      check(forced.row===7&&(forced.col===3||forced.col===7),'Forced win move');
      check(board[forced.row][forced.col]===0,'Forced win move targets an empty cell');
      GomokuV10Flash.clearCache();
      await GomokuV10Flash.preload();
      board=Array.from({length:15},()=>Array(15).fill(0));board[7][7]=1;
      gameMoves=[{row:7,col:7,player:1}];
      const flashInterrupted=findModelMove(10.4,2).then(()=>false,()=>true);
      await new Promise(resolve=>setTimeout(resolve,100));
      GomokuV10Flash.clearCache();
      check(await flashInterrupted,'Flash reset cancels active search');
      for(const mode of ['model-battle','human']) {
        board[7][7]=1;gameMoves=[{row:7,col:7,player:1}];
        gameModeSelect.value=mode;gameModeSelect.dispatchEvent(new Event('change'));
        check(board.flat().every(x=>!x)&&gameMoves.length===0,'Mode switch clears all engines');
      }
      // 页面必须能自由滚动：滚动吸附会把视图卡在单个面板上，看不到完整界面。
      check(getComputedStyle(document.documentElement).scrollSnapType==='none','Page must not trap scrolling with scroll-snap');
      check(document.documentElement.scrollHeight>window.innerHeight,'Page is taller than the viewport so it can scroll');
      const snapAligned=[...document.querySelectorAll('*')].filter(el=>getComputedStyle(el).scrollSnapAlign!=='none').length;
      check(snapAligned===0,'No element keeps a scroll-snap alignment');
      // AI 决策面板：九项字段齐全，缺失项要明确标注而不是只显示破折号。
      const explainIds=['explainSource','explainTarget','explainDepth','explainSelDepth','explainScore','explainCandidates','explainNodes','explainEngineTime','explainTotalTime'];
      for(const id of explainIds) check(!!document.getElementById(id),'Explain panel field '+id);
      const savedExplain=explainEnabled; explainEnabled=true; document.getElementById('explainPanelBody').hidden=false;
      // 有完整遥测的引擎：字段应逐项写入。
      updateExplain({reason:'rapfi-nnue',depth:12,configuredDepth:12,score:128,nodes:12345,selDepth:9,engineTimeMs:850,elapsedMs:900,candidates:20,target:'8, 8'});
      check(document.getElementById('explainScore').textContent==='128','Explain shows the engine score');
      check(document.getElementById('explainNodes').textContent==='12345','Explain shows node counts');
      updateExplain({reason:'search',depth:8,nodes:1234567,target:'1, 1'});
      check(document.getElementById('explainNodes').textContent==='1,234,567','Explain groups large node counts');
      // 引擎用时必须在同一次带 engineTimeMs 的上报里检查，避免被前一次上报重置。
      updateExplain({reason:'rapfi-nnue',depth:12,selDepth:9,engineTimeMs:850,elapsedMs:900,target:'8, 8'});
      check(document.getElementById('explainEngineTime').textContent==='850 ms','Explain formats engine time in ms');
      updateExplain({reason:'rapfi-nnue',depth:12,engineTimeMs:2500,elapsedMs:2600,target:'8, 8'});
      check(document.getElementById('explainEngineTime').textContent==='2.50 s','Explain formats engine time in seconds');
      check(document.getElementById('explainSource').textContent.includes('Rapfi'),'Explain names the decision source');
      check(document.getElementById('explainDepthNote').hidden,'No missing note when the field is present');
      // 不上报评估分的引擎：显示破折号并标注原因。
      updateExplain({reason:'forced-block',depth:0,candidates:3,target:'7, 7'});
      check(document.getElementById('explainScore').textContent==='—','Missing score shows a dash');
      check(!document.getElementById('explainScoreNote').hidden&&document.getElementById('explainScoreNote').textContent.length>0,'Missing score explains why');
      check(document.getElementById('explainSource').textContent.includes('必防')||document.getElementById('explainSource').textContent.includes('block'),'Explain localises the reason');
      // 缺失原因必须按引擎族解释：Rapfi 精简构建与极小极大引擎说法不同。
      activeModelVersion=10.1; isModelBattle=false;
      updateExplain({reason:'rapfi-nnue',depth:12,target:'7, 7'});
      check(document.getElementById('explainScoreNote').textContent.includes('Rapfi'),'Rapfi missing score explains the slim build');
      activeModelVersion=9.2;
      updateExplain({reason:'immediate-win',depth:0,candidates:1,target:'7, 7'});
      check(document.getElementById('explainScoreNote').hidden||!document.getElementById('explainScoreNote').textContent.includes('Rapfi'),'Minimax engines do not blame the Rapfi build');
      // 必败/必胜的边界评估值翻译成人话。
      updateExplain({reason:'search',score:-1000001,depth:8,target:'1, 1'});
      check(document.getElementById('explainScore').textContent==='必败','A losing mate bound reads as a loss');
      updateExplain({reason:'search',score:1000001,depth:8,target:'1, 1'});
      check(document.getElementById('explainScore').textContent==='必胜','A winning mate bound reads as a win');
      updateExplain({reason:'vcf-win',depth:10,threats:{openFour:1,four:2,openThree:3},target:'5, 5'});
      check(document.getElementById('explainSource').textContent.includes('VCF'),'Explain surfaces the VCF origin');
      check(document.getElementById('explainSource').textContent.includes('威胁'),'Explain appends the threat census');
      explainEnabled=savedExplain;
      // 胜率条：开局后可见、两侧百分比相加为 100、决定性棋形推到边界。
      check(typeof renderWinRate==='function' && typeof winRateFor==='function' && typeof threatProfile==='function','Win rate helpers exist');
      const emptyBoard=()=>Array.from({length:15},()=>Array(15).fill(0));
      board=emptyBoard(); gameMoves=[];
      isModelBattle=false; playerColor=1; aiColor=2; activeModelVersion=9;
      setWinRateLabels(); renderWinRate();
      check(!document.getElementById('winratePanel').hidden,'Win rate bar visible for a human game');
      check(document.getElementById('winrateLeftValue').textContent==='50%'&&document.getElementById('winrateRightValue').textContent==='50%','An empty board starts at 50/50');
      // 黑棋已有活四时，黑方胜率必须接近满值。
      // 胜率必须与胜负一致：已经输的一方不能显示高胜率（这是此前的真实缺陷）。
      const winBoard=(black,white=[])=>{const b=Array.from({length:15},()=>Array(15).fill(0));black.forEach(c=>b[c[0]][c[1]]=1);white.forEach(c=>b[c[0]][c[1]]=2);return b;};
      check(Math.round(estimateWinRate(winBoard([[7,3],[7,4],[7,5],[7,6],[7,7]]),1,2)*100)===100,'Five in a row reads as a win');
      check(Math.round(estimateWinRate(winBoard([[0,0]],[[7,3],[7,4],[7,5],[7,6],[7,7]]),1,1)*100)===0,'A lost position reads as a loss');
      check(Math.round(estimateWinRate(winBoard([[0,0]],[[7,5],[7,6],[7,7],[7,8]]),1,1)*100)===0,'An opponent open four reads as a loss');
      check(Math.round(estimateWinRate(winBoard([]),1,1)*100)===50,'An empty board reads as even');
      check(Math.round(estimateWinRate(winBoard([[7,5],[7,6],[7,7],[7,8]]),1,2)*100)===100,'Our own open four reads as a win');
      // 双方都已有四连（各有两个成五点）：轮到谁谁赢。
      const raceBoard=(()=>{const b=Array.from({length:15},()=>Array(15).fill(0));
        [[7,4],[7,5],[7,6],[7,7]].forEach(c=>b[c[0]][c[1]]=1);
        [[3,4],[3,5],[3,6],[3,7]].forEach(c=>b[c[0]][c[1]]=2);
        return b;})();
      check(immediateWinCount(raceBoard,1)>=2&&immediateWinCount(raceBoard,2)>=2,'Race fixture gives both sides two five-points');
      check(Math.round(estimateWinRate(raceBoard,1,1)*100)===100,'Whoever moves first wins the immediate race (black)');
      check(Math.round(estimateWinRate(raceBoard,1,2)*100)===0,'Whoever moves first wins the immediate race (white)');
      // 一侧已有四连（两个成五点）而对手无威胁：该侧稳赢，轮不轮到都成立。
      const dominant=winBoard([[7,4],[7,5],[7,6],[7,7]]);
      check(Math.round(estimateWinRate(dominant,1,2)*100)===100,'An unblockable double five-point still wins when it is the opponent turn');
      // 只有对手单向成五、且没有第二点时，形势不利但不是必败。
      const single=winBoard([], [[7,4],[7,5],[7,6],[7,7]]);
      check(estimateWinRate(single,1,1)<=0.02,'A single blocked-by-one four leaves no winning line');
      // 直接以“左侧=黑方”计算，避免依赖此前用例留下的 playerColor 状态。
      board=emptyBoard(); [[7,4],[7,5],[7,6],[7,7]].forEach(([r,c])=>board[r][c]=1);
      check(winRateFor(1).left>=0.95,'A live four drives that side to the top');
      check(winRateFor(2).left<=0.05,'The opponent live four drives the other side to the bottom');
      // 渲染路径：显式走一遍人机状态，百分比必须写到 DOM 上。
      isModelBattle=false; playerColor=1; aiColor=2; setWinRateLabels();
      check(!document.getElementById('winratePanel').hidden,'Win rate panel shown before render');
      renderWinRate();
      const renderedLeft=String(document.getElementById('winrateLeftValue').textContent||'');
      check(renderedLeft.endsWith('%')&&Number(renderedLeft.replace('%',''))>=95,'Win rate bar renders the side value ('+renderedLeft+')');
      const renderedWidth=String(document.getElementById('winrateLeftFill').style.width||'');
      check(Number(renderedWidth.replace('%',''))>=95,'Win rate fill width follows the percentage ('+renderedWidth+')');
      hideWinRate(); check(document.getElementById('winratePanel').hidden,'Win rate bar hides on reset');
      // 对战记录：折叠框默认关闭，展开后才拉取；指纹与开始/结束 RPC 都已接线。
      check(document.getElementById('matchLogPanel') && !document.getElementById('matchLogPanel').open,'Match log starts collapsed');
      check(typeof startMatchLog==='function' && typeof finishMatchLog==='function','Match log helpers exist');
      // 对战记录必须在排行榜写入失败时也能回写：这是“大量对局被标为无效”的根因。
      {
        const calls = [];
        const originalRpc = supabaseClient.rpc;
        supabaseClient.rpc = async (name, params) => {
          calls.push({ name, outcome: params ? params.p_outcome : null });
          if (name === 'record_gomoku_result') return { error: { message: 'simulated leaderboard failure' } };
          return { error: null };
        };
        const savedLeaderboard = loadLeaderboard; loadLeaderboard = async () => {};
        document.getElementById('nickname').value = 'integration-check';
        activeModelVersion = 9; playerColor = 1; aiColor = 2; isModelBattle = false;
        gameMoves = [{row:7,col:7,player:1}]; moveCount = 1;
        resultSubmitted = false; gameInProgress = true; gameStartedAt = Date.now() - 4000;
        currentMatchFingerprint = 'gm-integration-log-1';
        await finishGame('win');
        check(calls.some(c => c.name === 'finish_gomoku_match'), 'Match log is written even when the leaderboard fails');
        check(calls.findIndex(c => c.name === 'finish_gomoku_match') < calls.findIndex(c => c.name === 'record_gomoku_result'), 'Match log is written before the leaderboard call');
        // 投降只回写一次，且结果记为 surrender。
        calls.length = 0;
        gameMoves = [{row:7,col:7,player:1},{row:6,col:8,player:2}]; moveCount = 2;
        resultSubmitted = false; gameInProgress = true; gameover = false; gameActionBusy = false;
        gameStartedAt = Date.now() - 9000;
        currentMatchFingerprint = 'gm-integration-log-2';
        await handleGameAction();
        const surrenderLogs = calls.filter(c => c.name === 'finish_gomoku_match');
        check(surrenderLogs.length === 1, 'Surrender writes exactly one log entry');
        check(surrenderLogs[0].outcome === 'surrender', 'Surrender is recorded as surrender, not a plain loss');
        supabaseClient.rpc = originalRpc;
        loadLeaderboard = savedLeaderboard;
      }
      // 对战记录：七栏（时间/昵称/模式/执子情况/用时/步数/获胜方），且必须描述谁赢了与双方执子。
      const logHeaders=[...document.querySelectorAll('#matchLogPanel table thead th')].map(th=>th.textContent);
      check(logHeaders.length===7,'Match log has seven columns');
      check(!logHeaders.some(h=>h.includes('积分')||h.includes('Points')),'The points column is gone');
      check(typeof modeLabel==='function'&&typeof sidesLabel==='function'&&typeof winnerCell==='function','Match log helpers exist');
      check(modeLabel({mode:'human'})!==modeLabel({mode:'model-battle'}),'Mode column distinguishes human and battle');
      const humanSides=sidesLabel({mode:'human',nickname:'老J',model_version:10.1,player_color:1});
      check(humanSides.includes('老J')&&humanSides.includes('V10Ultra'),'Human sides name both players');
      check(humanSides.indexOf('老J')<humanSides.indexOf('V10Ultra'),'Black side is listed first');
      const whiteSides=sidesLabel({mode:'human',nickname:'老J',model_version:10.1,player_color:2});
      check(whiteSides.indexOf('V10Ultra')<whiteSides.indexOf('老J'),'When the player is white the AI is listed first');
      const battleSides=sidesLabel({mode:'model-battle',model_version:10.4,opponent_model_version:10.3});
      check(battleSides.includes('V10Flash')&&battleSides.includes('V10Exp'),'Battle sides name both models');
      check(winnerCell({outcome:'win',winner_label:'老J',winner_color:1}).includes('老J'),'Winner column names the winner');
      check(winnerCell({outcome:'win',winner_label:'老J',winner_color:1}).includes('黑'),'Winner column shows the winning colour');
      check(winnerCell({outcome:'surrender',player_color:1,winner_label:null}).includes('投降'),'Surrender is labelled');
      check(winnerCell({outcome:'draw'}).length>0,'Draw is labelled');
      check(winnerCell({outcome:null,started_at:new Date(Date.now()-700000).toISOString()}).length>0,'A stale record reads as invalid');
      return {url: location.href, humanCases, battleCases, strengthOrder:expectedOrder, points:expectedPoints, uploadVersions:eligible, surrenderCases:eligible.length, workerMoves, newWorkerMoves, expNeuralMoves, expCancellation:true, flashWorkerMoves, flashCancellation:true, flashBook:{best:[bookA.best.row,bookA.best.col],games:bookA.best.games,cells:[...bookA.cells.keys()].sort()}};
    })()`);
    reports.push(report);
    console.log(`PASS ${url}: ${report.humanCases} human cases, ${report.battleCases} model battle cases, black/white/reset Worker moves.`);
  }
  await call('Page.removeScriptToEvaluateOnNewDocument', { identifier: injection.identifier });
  fs.writeFileSync(path.join(root, 'docs/gomoku-page-integration.json'), JSON.stringify(reports, null, 2) + '\n');
} finally {
  socket.close();
}
