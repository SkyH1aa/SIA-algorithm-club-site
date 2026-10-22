import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 以二进制方式写文件，避免文本模式把 CRLF 归一化为 LF。
async function writeFileBinary(target, data, encoding) {
  await writeFile(target, Buffer.from(data, encoding || 'utf8'));
}

// V10Thinker reuses the same Rapfi engine and Mix9 weights as V10Ultra; only the
// depth cap differs. The 14.3 MiB engine/weight payload therefore lives ONLY in
// v10ultra/file-package.js -- shipping another copy here would duplicate it
// byte-for-byte. This package carries just the Thinker worker bridge; the
// wrapper loads the Ultra package first on file:// (same pattern as v10exp.js).
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const thinkerDir = path.join(root, 'public/gomoku-models/v10thinker');
const packageData = {
  workerSource: await readFile(path.join(thinkerDir, 'worker.js'), 'utf8')
};
// 输出按原始字节写入：离线包内嵌的源码必须与磁盘上的文件逐字节一致（含 CRLF）。
const output = `/* Generated file:// worker package. Rebuild with node tools/build-gomoku-v10thinker-file-package.mjs. */\nwindow.GOMOKU_V10THINKER_FILE_PACKAGE = ${JSON.stringify(packageData)};\n`;
await writeFileBinary(path.join(thinkerDir, 'file-package.js'), output, 'utf8');
console.log(`Built V10Thinker file:// worker package (${(Buffer.byteLength(output) / 1024).toFixed(1)} KiB); engine/weights are shared from v10ultra/file-package.js.`);
