// 从 public/data/changelog.json 生成 public/data/changelog-data.js（内置快照）。
//   node tools/build-changelog-data.mjs
//
// 为什么需要内置快照：changelog.html 用 fetch('data/changelog.json') 取数，但
// file:// 下浏览器禁止 fetch 本地文件、线上 GitHub Pages 在部分网络环境可能
// 连不上——两种情况页面都会变成「读取失败」白屏。内置快照让页面在任何网络
// 状态下都有内容可渲染，网络可用时再用最新数据覆盖。
//
// 改动 public/data/changelog.json 后必须重跑本脚本（单一数据源是 json 文件，
// 生成的 js 只是快照）。与 build-i18n-dict.mjs 同一模式。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'public', 'data', 'changelog.json');
const target = path.join(root, 'public', 'data', 'changelog-data.js');

let entries;
try {
  entries = JSON.parse(fs.readFileSync(source, 'utf8'));
} catch (error) {
  console.error('FAIL changelog.json is not valid JSON:', error.message);
  process.exit(1);
}
if (!Array.isArray(entries) || !entries.length) {
  console.error('FAIL changelog.json must be a non-empty array');
  process.exit(1);
}

const banner = `// 由 tools/build-changelog-data.mjs 生成，请勿手工编辑；数据源是同目录 changelog.json。
// 作为更新日志页的内置快照：file:// 与离线时兜底渲染，网络可用时页面仍以
// fetch('data/changelog.json') 的最新数据为准。`;
const body = `${banner}
window.CLUB_CHANGELOG_SNAPSHOT = Object.freeze(${JSON.stringify(entries, null, 2)});
`;

fs.writeFileSync(target, body, 'utf8');
console.log(`Built public/data/changelog-data.js: ${entries.length} entries (snapshot).`);
