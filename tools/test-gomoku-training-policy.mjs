import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
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
const versions = [1, 2, 3, 6, 7, 8, 9, 9.1, 9.2, 9.3, 10, 10.1, 10.2, 10.3];
let cases = 0;
for (const version of versions) for (const result of ['win', 'loss', 'draw']) for (const color of [1, 2]) for (const battle of [false, true]) {
  stored = null;
  const payload = {
    result, modelVersion: version, nickname: 'test-only', aiColor: color, playerColor: 3 - color,
    moves: [{ row: 7, col: 7, player: 1 }, { row: 6, col: 8, player: 2 }],
    ...(battle ? { modelBattle: true, opponentModelVersion: 9.1 } : {})
  };
  const response = await serve({ method: 'POST', json: async () => payload });
  if ([9.2, 10, 10.1, 10.2, 10.3].includes(version)) {
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
for(const version of [9.2,10,10.1,10.2,10.3])for(const opponent of versions)
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
console.log(`PASS: ${cases} edge function cases; only 9.2/10/10.1/10.2/10.3 accept all outcomes, colors and modes preserved; file:// and HTTP engine/weights are identical.`);
