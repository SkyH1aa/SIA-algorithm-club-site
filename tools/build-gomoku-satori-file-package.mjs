import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 以二进制方式写文件，避免文本模式把 CRLF 归一化为 LF。
async function writeFileBinary(target, data) {
  await writeFile(target, Buffer.from(data, 'utf8'));
}

// Gomoku-Satori 是纯 JavaScript 引擎，没有 WASM、权重文件或网络请求；
// 离线包内嵌引擎与 Worker 源码，让 file:// 页面能用 Blob Worker 跑同一份字节。
// 改动 satori/engine.js 或 satori/worker.js 后必须重新运行本脚本。
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const satoriDir = path.join(root, 'public/gomoku-models/satori');
const packageData = {
  engineSource: await readFile(path.join(satoriDir, 'engine.js'), 'utf8'),
  workerSource: await readFile(path.join(satoriDir, 'worker.js'), 'utf8')
};
// 输出按原始字节写入：离线包内嵌的源码必须与磁盘文件逐字节一致（含 CRLF）。
const output = `/* Generated file:// package. Rebuild with node tools/build-gomoku-satori-file-package.mjs. */\nwindow.GOMOKU_SATORI_FILE_PACKAGE = ${JSON.stringify(packageData)};\n`;
await writeFileBinary(path.join(satoriDir, 'file-package.js'), output);
console.log(`Built Gomoku-Satori file:// package (${(Buffer.byteLength(output) / 1024).toFixed(2)} KiB) from satori/engine.js and satori/worker.js.`);
