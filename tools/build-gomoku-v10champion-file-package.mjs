import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 以二进制方式写文件，避免文本模式把 CRLF 归一化为 LF。
async function writeFileBinary(target, data, encoding) {
  await writeFile(target, Buffer.from(data, encoding || 'utf8'));
}

// Opaque-origin worker package for V10Champion.
//
// The HTTP path still uses this directory's own rapfi-single.js / .wasm / .data,
// which stay in place so the folder remains self-contained for direct serving.
// The file:// package, however, only carries the Champion worker bridge: its
// engine/weight payload is byte-identical to V10Ultra's (verified by
// tools/test-gomoku-file-package-dedup.mjs), so the wrapper reuses
// v10ultra/file-package.js instead of shipping a third 14.3 MiB copy.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'public/gomoku-models/v10champion');
const packageData = {
  workerSource: await readFile(path.join(dir, 'worker.js'), 'utf8')
};
// 输出按原始字节写入：离线包内嵌的源码必须与磁盘上的文件逐字节一致（含 CRLF）。
const output = `/* Generated file:// worker package. Rebuild with node tools/build-gomoku-v10champion-file-package.mjs. */\nwindow.GOMOKU_V10CHAMPION_FILE_PACKAGE = ${JSON.stringify(packageData)};\n`;
await writeFileBinary(path.join(dir, 'file-package.js'), output, 'utf8');
console.log(`Built V10Champion file:// worker package (${(Buffer.byteLength(output) / 1024).toFixed(1)} KiB); engine/weights are shared from v10ultra/file-package.js.`);
