import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'supabase/functions/gomoku-training/index.ts'), 'utf8');
let serve, stored;
const context = vm.createContext({
  TextEncoder, Response, crypto, btoa,
  Deno: { serve: handler => { serve = handler; }, env: { get: () => 'test-only' } },
  fetch: async (_url, options) => {
    if (options.method === 'PUT') stored = JSON.parse(options.body);
    return new Response(null, { status: 201 });
  }
});
vm.runInContext(stripTypeScriptTypes(source), context);
const versions = [1, 2, 3, 6, 7, 8, 9, 9.1, 9.2, 9.3, 10, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 11];
let cases = 0;
for (const version of versions) for (const result of ['win', 'loss', 'draw']) for (const color of [1, 2]) for (const battle of [false, true]) {
  stored = null;
  const payload = {
    result, modelVersion: version, nickname: 'test-only', aiColor: color, playerColor: 3 - color,
    moves: [{ row: 7, col: 7, player: 1 }, { row: 6, col: 8, player: 2 }],
    ...(battle ? { modelBattle: true, opponentModelVersion: 9.1 } : {})
  };
  const response = await serve({ method: 'POST', json: async () => payload });
  if ([9.2, 10, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6].includes(version)) {
    assert.equal(response.status, 200);
    assert.equal(stored.result, result);
    assert.equal(stored.model_version, version);
    assert.equal(stored.model_color, color);
    assert.equal(stored.ai_color, color);
    assert.equal(stored.player_color, 3 - color);
    assert.equal(stored.model_battle, battle);
    assert.equal(stored.opponent_model_version, battle ? 9.1 : null);
    assert.equal(stored.opponent_model_color, battle ? 3 - color : null);
  } else {
    assert.equal(response.status, 400);
    assert.equal(stored, null, 'Rejected model reached storage');
  }
  cases++;
}
// New non-uploading versions remain valid opponents of an uploading model.
for(const version of [9.2,10,10.1,10.2,10.3,10.4,10.5,10.6])for(const opponent of versions)
  for(const color of [1,2])for(const result of ['win','loss','draw']) {
    stored=null;
    const response=await serve({method:'POST',json:async()=>({
      result,modelVersion:version,opponentModelVersion:opponent,modelBattle:true,
      nickname:'test-only',aiColor:color,playerColor:3-color,
      moves:[{row:7,col:7,player:1},{row:6,col:8,player:2}]
    })});
    assert.equal(response.status,200);
    assert.equal(stored.opponent_model_version,opponent);
    assert.equal(stored.opponent_model_color,3-color);
    assert.equal(stored.result,result);
    cases++;
  }
// The opaque-origin build must wrap exactly the HTTP build, with no changes
// to the engine, neural weights, or the search protocol.
const directory = path.join(root, 'public/gomoku-models/v10ultra');
const packContext = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(directory, 'file-package.js'), 'utf8'), packContext);
const pack = packContext.window.GOMOKU_V10ULTRA_FILE_PACKAGE;
assert.equal(pack.rapfiSource, fs.readFileSync(path.join(directory, 'rapfi-single.js'), 'utf8'));
assert.equal(pack.workerSource, fs.readFileSync(path.join(directory, 'worker.js'), 'utf8'));
assert.ok(Buffer.from(pack.wasmBase64, 'base64').equals(fs.readFileSync(path.join(directory, 'rapfi-single.wasm'))));
assert.ok(Buffer.from(pack.dataBase64, 'base64').equals(fs.readFileSync(path.join(directory, 'rapfi.data'))));
// V10Flash reuses the same Rapfi engine and Mix9 weights; its opaque-origin
// package must wrap those exact bytes with its own Worker bridge.
const flashDirectory = path.join(root, 'public/gomoku-models/v10flash');
const flashContext = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(flashDirectory, 'file-package.js'), 'utf8'), flashContext);
const flashPack = flashContext.window.GOMOKU_V10FLASH_FILE_PACKAGE;
// The engine payload now lives only in the V10Ultra package; Flash's package must
// carry none of it and rely on the shared copy at file:// time.
assert.equal(flashPack.rapfiSource, undefined, 'V10Flash must not embed the shared Rapfi source');
assert.equal(flashPack.wasmBase64, undefined, 'V10Flash must not embed the shared WASM');
assert.equal(flashPack.dataBase64, undefined, 'V10Flash must not embed the shared Mix9 weights');
assert.equal(flashPack.workerSource, fs.readFileSync(path.join(flashDirectory, 'worker.js'), 'utf8'));
const flashWrapper = fs.readFileSync(path.join(root, 'public/gomoku-models/v10flash.js'), 'utf8');
assert.ok(flashWrapper.includes('GOMOKU_V10ULTRA_FILE_PACKAGE'), 'V10Flash composes the shared engine package under file://');
assert.ok(flashWrapper.includes("v10ultra/file-package.js"), 'V10Flash references the shared Ultra package');
assert.equal(fs.readFileSync(path.join(flashDirectory, 'worker.js'), 'utf8'), fs.readFileSync(path.join(root, 'public/gomoku-models/v11candidate/worker.js'), 'utf8'));
// V10Flash's own expert assets: the proof core is a derivative of the frozen V10
// core, and the package carries the frozen experts for the opaque-origin build.
assert.equal(flashPack.proof, fs.readFileSync(path.join(flashDirectory, 'proof-core.js'), 'utf8'));
assert.equal(flashPack.expertWorker, fs.readFileSync(path.join(flashDirectory, 'expert-worker.js'), 'utf8'));
assert.ok(flashPack.proof.includes('createGomokuFlashProofExpert'), 'V10Flash proof core factory');
assert.ok(!flashPack.proof.includes('createGomokuExpProofExpert'), 'V10Flash must not reuse the V10Exp proof core');
for (const [key, file] of [['expert', 'expert-core.js'], ['thinker', 'v9thinker.js'], ['v10core', 'v10-core.js'], ['v10', 'v10.js']]) {
  assert.equal(flashPack[key], fs.readFileSync(path.join(root, 'public/gomoku-models', file), 'utf8'), `frozen expert source ${file}`);
}
assert.equal(flashPack.training, fs.readFileSync(path.join(root, 'public/data/gomoku-training-model.js'), 'utf8'));
// V10Thinker is a copy of the V10Ultra Rapfi setup with a tunable depth cap. It
// must reuse V10Ultra's engine and weight bytes instead of shipping its own, and
// its wrapper must resolve paths from its own module URL (the factory is called
// from other pages' inline scripts, where document.currentScript.src is empty).
// V10Champion runs the V10Ultra Rapfi setup (same engine, weights, 12-ply cap
// and 75 s budget) with its own full-archive opening prior, so its engine and
// package bytes must equal V10Ultra's while the prior export is its own.
{
  const champDir = path.join(root, 'public/gomoku-models/v10champion');
  const ultraDir = path.join(root, 'public/gomoku-models/v10ultra');
  assert.ok(fs.readFileSync(path.join(champDir, 'rapfi-single.js')).equals(fs.readFileSync(path.join(ultraDir, 'rapfi-single.js'))), 'V10Champion engine equals V10Ultra');
  assert.ok(fs.readFileSync(path.join(champDir, 'rapfi.data')).equals(fs.readFileSync(path.join(ultraDir, 'rapfi.data'))), 'V10Champion package equals V10Ultra');
  assert.ok(fs.readFileSync(path.join(champDir, 'rapfi-single.wasm')).equals(fs.readFileSync(path.join(ultraDir, 'rapfi-single.wasm'))), 'V10Champion WASM equals V10Ultra');
  const wrapper = fs.readFileSync(path.join(root, 'public/gomoku-models/v10champion.js'), 'utf8');
  assert.ok(wrapper.includes('GOMOKU_V10CHAMPION_TRAINING_MODEL'), 'V10Champion reads its own prior');
  assert.ok(wrapper.includes('const THINK_MS = 75000') && wrapper.includes('const MAX_DEPTH = 12'), 'V10Champion uses the V10Ultra budget and depth');
  assert.ok(wrapper.includes('GOMOKU_V10ULTRA_FILE_PACKAGE'), 'V10Champion composes the shared engine package under file://');
  const champPackContext = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(champDir, 'file-package.js'), 'utf8'), champPackContext);
  const champPack = champPackContext.window.GOMOKU_V10CHAMPION_FILE_PACKAGE;
  assert.equal(champPack.rapfiSource, undefined, 'V10Champion must not embed the shared Rapfi source');
  assert.equal(champPack.workerSource, fs.readFileSync(path.join(champDir, 'worker.js'), 'utf8'), 'V10Champion file:// worker matches its own bridge');
}
const thinkerWrapper = fs.readFileSync(path.join(root, 'public/gomoku-models/v10thinker.js'), 'utf8');
assert.ok(thinkerWrapper.includes('window.GomokuV10ThinkerFactory'), 'V10Thinker factory is exported');
assert.ok(thinkerWrapper.includes("const MODEL_BASE = new URL('./', document.currentScript?.src || document.baseURI);"), 'V10Thinker resolves its base at module load');
const thinkerWorker = fs.readFileSync(path.join(root, 'public/gomoku-models/v10thinker/worker.js'), 'utf8');
assert.ok(thinkerWorker.includes("importScripts('../v10ultra/rapfi-single.js')"), 'V10Thinker loads V10Ultra Rapfi source');
assert.ok(thinkerWorker.includes("baseUrl() + '../v10ultra/rapfi.data'"), 'V10Thinker loads V10Ultra Mix9 weights');
const thinkerPackage = path.join(root, 'public/gomoku-models/v10thinker/file-package.js');
if (fs.existsSync(thinkerPackage)) {
  const thinkerContext = { window: {} };
  vm.runInNewContext(fs.readFileSync(thinkerPackage, 'utf8'), thinkerContext);
  const thinkerPack = thinkerContext.window.GOMOKU_V10THINKER_FILE_PACKAGE;
  assert.equal(thinkerPack.rapfiSource, undefined, 'V10Thinker must not embed the shared Rapfi source');
  assert.equal(thinkerPack.wasmBase64, undefined, 'V10Thinker must not embed the shared WASM');
  assert.equal(thinkerPack.dataBase64, undefined, 'V10Thinker must not embed the shared Mix9 weights');
  assert.equal(thinkerPack.workerSource, thinkerWorker, 'V10Thinker file:// worker matches its own bridge');
  assert.ok(thinkerWrapper.includes('GOMOKU_V10ULTRA_FILE_PACKAGE'), 'V10Thinker composes the shared engine package under file://');
}
// Gomoku-Satori (11) is a pure-JavaScript exhibition engine: no Rapfi, no WASM,
// no weights. Its opaque-origin package must embed exactly the HTTP engine and
// Worker sources, and the wrapper must keep it out of the upload path.
{
  const satoriDir = path.join(root, 'public/gomoku-models/satori');
  const engineSource = fs.readFileSync(path.join(satoriDir, 'engine.js'), 'utf8');
  const workerSource = fs.readFileSync(path.join(satoriDir, 'worker.js'), 'utf8');
  const satoriContext = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(satoriDir, 'file-package.js'), 'utf8'), satoriContext);
  const satoriPack = satoriContext.window.GOMOKU_SATORI_FILE_PACKAGE;
  assert.equal(satoriPack.engineSource, engineSource, 'Satori file:// engine matches the HTTP engine');
  assert.equal(satoriPack.workerSource, workerSource, 'Satori file:// worker matches the HTTP bridge');
  // 展示版边界：引擎不得引用 Rapfi/神经网络资源，也不得读取任何训练先验。
  // 先去掉注释再检查——引擎头部注释本来就会写明“不使用 Rapfi”，那不是引用。
  // 匹配的是真实资源引用（字符串字面量里的文件/引擎名），而不是 `...data`
  // 这类展开语法或普通标识符，否则会产生误报。
  const stripComments = code => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const engineCode = stripComments(engineSource);
  const assetRef = /['"`][^'"`]*rapfi[^'"`]*['"`]|['"`][^'"`]*\.(wasm|data|onnx)['"`]|importScripts|createGomoku[A-Za-z]*Expert|GOMOKU_[A-Z0-9_]*TRAINING_MODEL/i;
  assert.ok(!assetRef.test(engineCode), 'Satori engine must not touch Rapfi/WASM/weight assets or a training prior');
  assert.ok(!/GOMOKU_[A-Z0-9_]*TRAINING_MODEL/.test(stripComments(workerSource)), 'Satori worker must not read a training prior');
  const satoriWrapper = fs.readFileSync(path.join(root, 'public/gomoku-models/satori.js'), 'utf8');
  assert.ok(!/GOMOKU_[A-Z0-9_]*TRAINING_MODEL/.test(stripComments(satoriWrapper)), 'Satori wrapper must not read a training prior');
  assert.ok(!/rapfi/i.test(stripComments(satoriWrapper)), 'Satori wrapper must not reference Rapfi');
  const gomokuPage = fs.readFileSync(path.join(root, 'public/gomoku.html'), 'utf8');
  assert.ok(gomokuPage.includes('function isExhibitionVersion(version) { return Number(version) === 11; }'), 'Satori is registered as an exhibition version');
  assert.ok(gomokuPage.includes("if (isExhibitionVersion(version)) return false;"), 'Satori is blocked from the upload whitelist');
  // 11 不能出现在任何上传白名单里（前端与边缘函数两侧）。
  assert.ok(!/canUploadTrainingResult[\s\S]{0,400}version === 11/.test(gomokuPage), 'Satori must not be added to the upload whitelist');
  assert.ok(!/acceptsResult = \[[^\]]*11[^\]]*\]/.test(fs.readFileSync(path.join(root, 'supabase/functions/gomoku-training/index.ts'), 'utf8')), 'Edge function must not accept Satori uploads');
}
// The V10Flash prior must draw exactly the games played by its four reference
// model families in any period, plus everything from period 1014 onward. Every
// other exported prior must stay free of the 1014+ periods.
const modelContext = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'public/data/gomoku-training-model.js'), 'utf8'), modelContext);
const models = modelContext.window;
const periodOf = directory => Number((directory.match(/^五子棋训练数据(\d+)$/) || [])[1]);
const flashModel = models.GOMOKU_V10FLASH_TRAINING_MODEL;
assert.ok(flashModel && flashModel.gameCount > 0, 'V10Flash prior exists');
assert.equal(JSON.stringify(flashModel.sourceModelVersions), JSON.stringify([9.2, 10, 10.1, 10.3]), 'V10Flash source model versions');
const expectedFlash = (() => {
  const seen = new Set();
  let count = 0;
  for (const directory of fs.readdirSync(root).filter(entry => /^五子棋训练数据/.test(entry) && fs.statSync(path.join(root, entry)).isDirectory()).sort()) {
    const period = periodOf(directory);
    for (const file of fs.readdirSync(path.join(root, directory)).filter(entry => /^gomoku-.*\.json$/i.test(entry))) {
      const raw = fs.readFileSync(path.join(root, directory, file), 'utf8');
      const hash = createHash('sha256').update(raw).digest('hex');
      if (seen.has(hash)) continue;
      seen.add(hash);
      const game = JSON.parse(raw);
      if (!['win', 'loss', 'draw'].includes(game.result) || !Array.isArray(game.moves)) continue;
      if (flashModel.sourceModelVersions.includes(game.model_version) || period >= flashModel.minPeriod) count++;
    }
  }
  return count;
})();
assert.equal(flashModel.gameCount, expectedFlash, 'V10Flash prior covers exactly the four families plus period >= 1014');
for (const name of ['GOMOKU_TRAINING_MODEL', 'GOMOKU_V9PRO_TRAINING_MODEL', 'GOMOKU_V9THINKER_TRAINING_MODEL', 'GOMOKU_V9_TRAINING_MODEL', 'GOMOKU_V10_TRAINING_MODEL']) {
  assert.ok(models[name].sourceDirectories.every(directory => periodOf(directory) < 1014), `${name} must exclude period >= 1014`);
}
const flashContributors = flashModel.sourceModelVersions.filter(version => version !== 10.3);
assert.ok(flashContributors.length === 3, 'V10Exp (10.3) contributes no games yet');
console.log(`PASS: ${cases} edge function cases; only 9.2/10/10.1/10.2/10.3/10.4/10.5/10.6 accept all outcomes (11 Gomoku-Satori is a valid opponent but never uploads), colors and modes preserved; file:// and HTTP engine/weights are identical for V10Ultra and V10Flash; the V10Flash prior is built from exactly ${expectedFlash} games (9.2/10/10.1/10.3 in any period, plus period >= 1014) and no other prior reads period 1014.`);
