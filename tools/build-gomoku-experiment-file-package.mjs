import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = path.join(root, 'public/gomoku-models/experimental');
const read = (p) => fs.readFileSync(path.join(base, p));
const text = (p) => read(p).toString('utf8');
const b64 = (p) => read(p).toString('base64');
const pack = {
  slowrenju: { source: text('slowrenju/engine.js') + '\n' + text('slowrenju/worker.js'), wasm: b64('slowrenju/engine.wasm') },
  gomokuzero: { source: text('runtime/ort.wasm.min.js') + '\n' + text('gomokuzero/worker.js'),
    wasm: b64('runtime/ort-wasm-simd-threaded.wasm'), mjs: text('runtime/ort-wasm-simd-threaded.mjs'), model: b64('gomokuzero/model.onnx') }
};
fs.writeFileSync(path.join(base, 'file-package.js'), '// Generated; same engine and weight bytes as HTTP assets.\nwindow.GOMOKU_EXPERIMENT_FILE_PACKAGE = ' + JSON.stringify(pack) + ';\n');
console.log('Built experimental file:// package:', fs.statSync(path.join(base, 'file-package.js')).size, 'bytes');
