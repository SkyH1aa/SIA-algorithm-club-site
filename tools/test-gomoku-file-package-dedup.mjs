// Offline: node tools/test-gomoku-file-package-dedup.mjs
//
// The Rapfi engine source, WASM and Mix9 weights are byte-identical across
// V10Ultra / V10Thinker / V10Champion / V10Flash. They now live only in
// v10ultra/file-package.js; the other packages carry their own worker bridge
// (and, for Flash, the frozen expert assets). This test proves the deduplicated
// layout still resolves to exactly the same bytes the old fat packages had.
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const models = path.join(root, 'public', 'gomoku-models');
const read = name => readFile(path.join(models, name), 'utf8');
const readBin = name => readFile(path.join(models, name));

// Execute a generated package the same way the browser does and return its global.
async function loadPackage(relative, globalName) {
  const source = await readFile(path.join(models, relative), 'utf8');
  const sandbox = { window: {} };
  vm.runInNewContext(source, sandbox, { filename: relative });
  const value = sandbox.window[globalName];
  assert.ok(value, `${relative} must define window.${globalName}`);
  return value;
}

// SHA-256 of the standalone engine files -- the ground truth every package must
// still reproduce byte-for-byte after dedup.
const truth = {
  rapfiSource: crypto.createHash('sha256').update(await read('v10ultra/rapfi-single.js')).digest('hex'),
  wasm: crypto.createHash('sha256').update(await readBin('v10ultra/rapfi-single.wasm')).digest('hex'),
  data: crypto.createHash('sha256').update(await readBin('v10ultra/rapfi.data')).digest('hex')
};

const ultra = await loadPackage('v10ultra/file-package.js', 'GOMOKU_V10ULTRA_FILE_PACKAGE');
assert.deepEqual(Object.keys(ultra).sort(), ['dataBase64', 'rapfiSource', 'wasmBase64', 'workerSource'],
  'V10Ultra remains the single self-contained engine package');

const hashOf = (text, encoding) => crypto.createHash('sha256').update(Buffer.from(text, encoding || 'utf8')).digest('hex');
assert.equal(hashOf(ultra.rapfiSource), truth.rapfiSource, 'Ultra rapfiSource matches rapfi-single.js');
assert.equal(hashOf(Buffer.from(ultra.wasmBase64, 'base64')), truth.wasm, 'Ultra wasm decodes to rapfi-single.wasm');
assert.equal(hashOf(Buffer.from(ultra.dataBase64, 'base64')), truth.data, 'Ultra data decodes to rapfi.data');
assert.equal(ultra.workerSource, await read('v10ultra/worker.js'), 'Ultra workerSource matches worker.js');

// Each slim package: only its own bridge (plus model-specific extras for Flash).
const thinker = await loadPackage('v10thinker/file-package.js', 'GOMOKU_V10THINKER_FILE_PACKAGE');
assert.deepEqual(Object.keys(thinker).sort(), ['workerSource'], 'Thinker ships only its worker bridge');
assert.equal(thinker.workerSource, await read('v10thinker/worker.js'), 'Thinker workerSource matches worker.js');

const champion = await loadPackage('v10champion/file-package.js', 'GOMOKU_V10CHAMPION_FILE_PACKAGE');
assert.deepEqual(Object.keys(champion).sort(), ['workerSource'], 'Champion ships only its worker bridge');
assert.equal(champion.workerSource, await read('v10champion/worker.js'), 'Champion workerSource matches worker.js');

const flash = await loadPackage('v10flash/file-package.js', 'GOMOKU_V10FLASH_FILE_PACKAGE');
assert.deepEqual(Object.keys(flash).sort(),
  ['expert', 'expertWorker', 'proof', 'thinker', 'training', 'v10', 'v10core', 'workerSource'],
  'Flash keeps every frozen expert asset but no engine payload');
assert.equal(flash.workerSource, await read('v10flash/worker.js'), 'Flash workerSource matches worker.js');
assert.equal(flash.expert, await read('expert-core.js'), 'Flash expert matches frozen expert-core.js');
assert.equal(flash.thinker, await read('v9thinker.js'), 'Flash thinker matches frozen v9thinker.js');
assert.equal(flash.v10core, await read('v10-core.js'), 'Flash v10core matches frozen v10-core.js');
assert.equal(flash.v10, await read('v10.js'), 'Flash v10 matches frozen v10.js');
assert.equal(flash.expertWorker, await read('v10flash/expert-worker.js'), 'Flash expertWorker matches disk');
assert.equal(flash.proof, await read('v10flash/proof-core.js'), 'Flash proof matches generated proof-core.js');
assert.equal(flash.training, await readFile(path.join(root, 'public', 'data', 'gomoku-training-model.js'), 'utf8'),
  'Flash training snapshot equals the live training model (priors unchanged)');
assert.match(flash.proof, /createGomokuFlashProofExpert/, 'Flash proof core is its own derivative');
assert.doesNotMatch(flash.proof, /createGomokuExpProofExpert/, 'Flash never reuses the V10Exp factory');

// No slim package may smuggle a duplicate engine payload back in.
for (const [name, pack] of [['v10thinker', thinker], ['v10champion', champion], ['v10flash', flash]]) {
  for (const field of ['rapfiSource', 'wasmBase64', 'dataBase64']) {
    assert.equal(pack[field], undefined, `${name} must not embed ${field}`);
  }
}

// Wrappers must load the shared engine package first under file://.
for (const [file, globalName] of [
  ['v10thinker.js', 'GOMOKU_V10ULTRA_FILE_PACKAGE'],
  ['v10champion.js', 'GOMOKU_V10ULTRA_FILE_PACKAGE'],
  ['v10flash.js', 'GOMOKU_V10ULTRA_FILE_PACKAGE']
]) {
  const source = await read(file);
  assert.ok(source.includes(globalName), `${file} loads the shared Ultra engine package`);
  assert.ok(source.includes("v10ultra/file-package.js"), `${file} references v10ultra/file-package.js`);
}

// The whole point: total bytes drop by roughly 43 MiB while nothing is lost.
const sizes = {};
for (const name of ['v10ultra', 'v10thinker', 'v10champion', 'v10flash']) {
  sizes[name] = (await stat(path.join(models, name, 'file-package.js'))).size;
}
const total = Object.values(sizes).reduce((sum, value) => sum + value, 0);
assert.ok(total < 16 * 1024 * 1024, `deduplicated packages must total under 16 MiB, saw ${(total / 1048576).toFixed(1)} MiB`);
assert.ok(sizes.v10ultra > 14 * 1024 * 1024, 'Ultra still owns the full engine package');

console.log(`Gomoku file packages: engine/weights shared from V10Ultra; all worker/expert sources byte-identical to disk. `
  + `Total ${(total / 1048576).toFixed(1)} MiB (was ~57.2 MiB).`);
