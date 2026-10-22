// 从 tools/i18n-dict.template.js + public/i18n-dict-zh.js 生成 public/i18n-dict.js。
//   node tools/build-i18n-dict.mjs
//
// 为什么是「整文件生成」而不是原地替换：
// 之前的原地替换在重复运行时会把结束锚点匹配到对象内部，越build越坏。
// 整文件生成保证无论运行多少次结果都一样。
//
// 为什么要内联中文词典：
// i18n-dict.js 曾只是「加载器 + 外部词典」，用 document.write / 同步 XHR 注入。
// file:// 下浏览器拒绝同步 XHR，defer 阶段也不执行 document.write，于是全站
// 显示 guide.h1、common.confirm 这类原始 key，必须手动点语言切换才恢复。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');
const templateFile = path.join(root, 'tools/i18n-dict.template.js');
const zhFile = path.join(publicDir, 'i18n-dict-zh.js');
const target = path.join(publicDir, 'i18n-dict.js');
const PLACEHOLDER = '/*__ZH_DICT__*/ {}';

const template = fs.readFileSync(templateFile, 'utf8');
if (!template.includes(PLACEHOLDER)) {
  console.error('FAIL template is missing the zh dictionary placeholder');
  process.exit(1);
}

const zhSource = fs.readFileSync(zhFile, 'utf8');
// 取 `window.ClubI18nDictZh = {...};` 里的对象字面量。
const match = /window\.ClubI18nDictZh\s*=\s*(\{[\s\S]*?\});\s*\}\)\(\);?\s*$/.exec(zhSource.trim());
if (!match) {
  console.error('FAIL could not extract the zh dictionary object from i18n-dict-zh.js');
  process.exit(1);
}
const objectLiteral = match[1].trim();

// 先验证字面量能真正解析成对象，避免把半截内容写进页面。
const sandbox = {};
vm.runInNewContext(`globalThis.__probe = ${objectLiteral};`, sandbox);
const sections = Object.keys(sandbox.__probe || {});
if (sections.length < 20) {
  console.error(`FAIL the extracted zh dictionary only has ${sections.length} sections`);
  process.exit(1);
}
for (const required of ['common', 'guide', 'theme', 'notify', 'memberProfile']) {
  if (!sandbox.__probe[required]) {
    console.error(`FAIL the zh dictionary is missing the "${required}" section`);
    process.exit(1);
  }
}

const output = template.replace(PLACEHOLDER, objectLiteral);
fs.writeFileSync(target, output, 'utf8');

// 生成物必须自洽：语法正确、能产出有内容的 ClubI18nDict。
const generated = fs.readFileSync(target, 'utf8');
const runtime = { window: {}, document: { currentScript: { src: 'https://example.test/public/i18n-dict.js' }, head: { appendChild() {} }, createElement: () => ({}) } };
vm.runInNewContext(generated, runtime, { filename: 'i18n-dict.js' });
const dict = runtime.window.ClubI18nDict;
const checkSections = dict && dict.zh ? Object.keys(dict.zh).length : 0;
if (checkSections !== sections.length) {
  console.error(`FAIL generated file exposes ${checkSections} sections, expected ${sections.length}`);
  process.exit(1);
}
if (dict.zh.common?.confirm !== '确定') {
  console.error('FAIL common.confirm did not survive inlining');
  process.exit(1);
}

console.log(`Built public/i18n-dict.js: ${sections.length} zh sections inline (${(Buffer.byteLength(output) / 1024).toFixed(1)} KiB); English stays lazy.`);
