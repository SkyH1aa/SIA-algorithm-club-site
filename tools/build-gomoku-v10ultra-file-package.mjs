import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 以二进制方式写文件，避免文本模式把 CRLF 归一化为 LF。
async function writeFileBinary(target, data, encoding) {
  await writeFile(target, Buffer.from(data, encoding || 'utf8'));
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, 'public/gomoku-models/v10ultra');
const packageData = {
  rapfiSource: await readFile(path.join(directory, 'rapfi-single.js'), 'utf8'),
  workerSource: await readFile(path.join(directory, 'worker.js'), 'utf8'),
  wasmBase64: (await readFile(path.join(directory, 'rapfi-single.wasm'))).toString('base64'),
  dataBase64: (await readFile(path.join(directory, 'rapfi.data'))).toString('base64')
};
// 输出按原始字节写入：离线包内嵌的引擎源码必须与磁盘上的文件逐字节一致（含 CRLF）。
const output = `/* Generated file:// package. Rebuild with node tools/build-gomoku-v10ultra-file-package.mjs. */\nwindow.GOMOKU_V10ULTRA_FILE_PACKAGE = ${JSON.stringify(packageData)};\n`;
await writeFileBinary(path.join(directory, 'file-package.js'), output, 'utf8');
console.log(`Built V10Ultra file:// package (${(Buffer.byteLength(output) / 1024 / 1024).toFixed(2)} MiB) from the existing Rapfi Worker, WASM, and Mix9 weights.`);
