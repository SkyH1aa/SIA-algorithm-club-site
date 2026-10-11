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
      const versions = [1, 2, 3, 6, 7, 8, 9, 9.1, 9.2, 9.3, 10, 10.1, 10.2, 10.3];
      const eligible = [9.2, 10, 10.1, 10.2, 10.3];
      const expectedPoints = { '9.1': 10, '9.2': 12, '10': 12, '10.1': 15, '9.3': 9, '10.2': 14, '10.3': 15 };
      const expectedOrder=[1,2,3,6,7,8,9,9.1,9.3,9.2,10,10.2,10.3,10.1];
      check(JSON.stringify(MODEL_VERSIONS)===JSON.stringify(expectedOrder),'Strength order registry');
      populateBattleModels();
      for(const selector of [modelVersionSelect,blackModelVersionSelect,whiteModelVersionSelect]) {
        check(JSON.stringify([...selector.options].map(o=>Number(o.value)))===JSON.stringify(expectedOrder),'All three selectors follow strength order');
        for(const option of selector.options)check(option.textContent===getModelName(Number(option.value)),'Selector model labels');
      }
      for(const lang of ['zh','en']) {
        const hint=ClubI18n.t('gomoku.lbHint',{},lang);
        check(['V9Mesa','V10Mesa','V10Exp','V10Ultra','14','15'].every(s=>hint.includes(s)),'Leaderboard points hint');
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
      for(const version of [9.3,10.2,10.3])for(const color of [1,2]) {
        board=Array.from({length:15},()=>Array(15).fill(0));gameMoves=[];
        for(let c=4;c<8;c++){board[7][c]=color;board[3][c]=3-color;}
        if(color===2)board[0][0]=1;
        const move=await findModelMove(version,color);
        check(move.row===7 && [3,8].includes(move.col),'New model own win priority');
        startAiCountdown(version);
        const expected=version===10.3?'180.0':'120.0';
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
      for(const mode of ['model-battle','human']) {
        board[7][7]=1;gameMoves=[{row:7,col:7,player:1}];
        gameModeSelect.value=mode;gameModeSelect.dispatchEvent(new Event('change'));
        check(board.flat().every(x=>!x)&&gameMoves.length===0,'Mode switch clears all engines');
      }
      return {url: location.href, humanCases, battleCases, strengthOrder:expectedOrder, points:expectedPoints, uploadVersions:eligible, surrenderCases:eligible.length, workerMoves, newWorkerMoves, expNeuralMoves, expCancellation:true};
    })()`);
    reports.push(report);
    console.log(`PASS ${url}: ${report.humanCases} human cases, ${report.battleCases} model battle cases, black/white/reset Worker moves.`);
  }
  await call('Page.removeScriptToEvaluateOnNewDocument', { identifier: injection.identifier });
  fs.writeFileSync(path.join(root, 'docs/gomoku-page-integration.json'), JSON.stringify(reports, null, 2) + '\n');
} finally {
  socket.close();
}
