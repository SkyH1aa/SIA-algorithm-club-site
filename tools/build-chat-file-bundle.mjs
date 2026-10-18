// 生成 chat 页的 file:// 兼容单文件包：
//   node tools/build-chat-file-bundle.mjs
//
// 背景：chat.js 是 ES module，file:// 下 import 会被浏览器按 CORS 拦截，
// 页面完全不执行（表现为黑屏）。这里把 chat-core / chat-store / chat.js
// 内联成一个普通脚本，只改变加载方式，不改任何运行逻辑。
//
// 产物：public/chat-file-bundle.js（由 chat.html 在 file:// 时加载）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');
const read = name => fs.readFileSync(path.join(publicDir, name), 'utf8');

const core = read('chat-core.js');
const store = read('chat-store.js');
const app = read('chat.js');

// 收集 chat-core 的导出名，供 app 的解构导入改写为普通 const。
function exportNames(source) {
  const names = new Set();
  for (const match of source.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) names.add(match[1]);
  for (const match of source.matchAll(/export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) names.add(match[1]);
  for (const match of source.matchAll(/export\s*\{([^}]+)\}/g)) {
    match[1].split(',').map(part => part.trim().split(/\s+as\s+/).pop()).filter(Boolean).forEach(name => names.add(name));
  }
  return names;
}

const stripModuleSyntax = source => source
  .replace(/^\s*export\s+(?=(?:async\s+)?function|const|let|var|class)/gm, '')
  .replace(/^\s*export\s*\{[^}]*\}\s*;?\s*$/gm, '')
  .replace(/^\s*export\s+default\s+/gm, 'var __default = ');

const coreNames = [...exportNames(core)];
const storeNames = [...exportNames(store)];

// import.meta 在普通脚本里不合法：file:// 包没有模块基址语义，
// 用脚本自身的 URL 顶替（pdf worker 仍指向同目录 vendor/chat/）。
const chatBaseUrl = "document.currentScript ? document.currentScript.src : location.href";
const appBody = app
  .replace(/import\.meta\.url/g, chatBaseUrl)
  // 去掉两条静态 import
  .replace(/^\s*import\s*\{[^}]*\}\s*from\s*'\.\/chat-core\.js';\s*$/m, '')
  .replace(/^\s*import\s*\{[^}]*\}\s*from\s*'\.\/chat-store\.js';\s*$/m, '')
  // 任何其它相对 import 都必须显式失败，避免静默漏打包
  .replace(/^\s*import\s+[^;]+;\s*$/gm, match => {
    if (/from\s*'\.\//.test(match)) throw new Error(`未处理的模块 import：${match.trim()}`);
    return match;
  });

const bundle = `/* 自动生成，请勿手改：node tools/build-chat-file-bundle.mjs */
(function () {
  'use strict';
  /* ---- chat-core.js ---- */
${stripModuleSyntax(core)}
  /* ---- chat-store.js ---- */
${stripModuleSyntax(store)}
  /* ---- chat.js（原 import 已改写为普通绑定） ---- */
${appBody}
})();
`;

fs.writeFileSync(path.join(publicDir, 'chat-file-bundle.js'), bundle, 'utf8');
console.log(`built public/chat-file-bundle.js (${(bundle.length / 1024).toFixed(1)} KB, core exports: ${coreNames.length})`);
