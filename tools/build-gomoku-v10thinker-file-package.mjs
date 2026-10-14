import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 以二进制方式写文件，避免文本模式把 CRLF 归一化为 LF。
async function writeFileBinary(target, data, encoding) {
  await writeFile(target, Buffer.from(data, encoding || 'utf8'));
}

// V10Thinker reuses the same Rapfi engine and Mix9 weights as V10Ultra; only the
// depth cap differs. This generates its opaque-origin package, exactly like the
// V10Ultra one, so both HTTP and file:// run the same bytes. Run it before
// wiring V10Thinker into a page that must also work from file://.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ultraDir = path.join(root, 'public/gomoku-models/v10ultra');
const thinkerDir = path.join(root, 'public/gomoku-models/v10thinker');
const packageData = {
  rapfiSource: await readFile(path.join(ultraDir, 'rapfi-single.js'), 'utf8'),
  workerSource: await readFile(path.join(thinkerDir, 'worker.js'), 'utf8'),
  wasmBase64: (await readFile(path.join(ultraDir, 'rapfi-single.wasm'))).toString('base64'),
  dataBase64: (await readFile(path.join(ultraDir, 'rapfi.data'))).toString('base64')
};
// 输出按原始字节写入：离线包内嵌的引擎源码必须与磁盘上的文件逐字节一致（含 CRLF）。
const output = `/* Generated file:// package. Rebuild with node tools/build-gomoku-v10thinker-file-package.mjs. */\nwindow.GOMOKU_V10THINKER_FILE_PACKAGE = ${JSON.stringify(packageData)};\n`;
await writeFileBinary(path.join(thinkerDir, 'file-package.js'), output, 'utf8');
console.log(`Built V10Thinker file:// package (${(Buffer.byteLength(output) / 1024 / 1024).toFixed(2)} MiB) from the same Rapfi Worker, WASM and Mix9 weights as V10Ultra.`);
