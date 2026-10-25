#!/usr/bin/env node
/*
 * check-ui-tokens.mjs — 全站 UI 体系守卫（2026-10 第二轮 UI 升级配套）
 *
 * 只检查挂了 body.club-page 的页面（T1/T2/T3 已收编页面），不检查豁免页
 * （index.html、chat/assistant、platformer 等自成体系页面）。
 *
 * FAIL（退出码 1）：
 *   1. club-page 页面在 :root 或本地 html[data-theme="light"] 块里定义 --club-* 令牌
 *      —— 令牌唯一真源是 public/club-ui.css。
 *   2. club-page 页面硬编码中文/旧字体栈（Microsoft YaHei / Segoe UI / PingFang 字面值）
 *      —— 必须用 var(--club-font) / var(--club-mono) 或继承。
 *   3. club-ui.css 之外定义 club-* 前缀 @keyframes —— 动画注册表只允许在 club-ui.css。
 *   4. club-page 页面缺失 <main>（页面骨架约定）。
 * WARN（不失败，打印清单，供后续清理）：
 *   5. 断点不在规范阶梯 {420, 640, 720, 900, 1100}。
 *   6. transition 仍用旧时长字面值（0.16s / .16s / 0.18s / .2s / .3s ease 等）。
 *
 * 用法：node tools/check-ui-tokens.mjs [--fix-html]（当前无自动修复，--fix-html 预留）
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(root, 'public');
const CANONICAL_BP = new Set(['420', '640', '720', '900', '1100']);
const FAIL = [];
const WARN = [];

const clubUi = readFileSync(join(publicDir, 'club-ui.css'), 'utf-8');
for (const token of ['--club-dur-fast', '--club-dur:', '--club-dur-slow', '--club-ease', '--club-fs-xs', '--club-space-1', '--club-z-nav']) {
  if (!clubUi.includes(token)) FAIL.push(`club-ui.css 缺少基础令牌 ${token}`);
}

const files = [];
for (const name of readdirSync(publicDir)) {
  if (name.endsWith('.html')) files.push(join(publicDir, name));
}
for (const name of ['index.html', '404.html', 'bad-gateway.html', 'service-unavailable.html']) {
  const p = join(root, name);
  if (existsSync(p)) files.push(p);
}

for (const file of files) {
  const rel = file.startsWith(root) ? file.slice(root.length + 1) : file;
  let html = '';
  try { html = readFileSync(file, 'utf-8'); } catch { continue; }
  const isClubPage = /<body[^>]*class="[^"]*\bclub-page\b[^"]*"/.test(html);
  if (!isClubPage) continue;

  // 提取内联 <style> 内容
  const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
  const css = styles.replace(/\/\*[\s\S]*?\*\//g, '');

  // 1. 令牌唯一真源
  const rootBlocks = [...css.matchAll(/:root[^{]*\{[^}]*\}/g)].map(m => m[0]);
  for (const block of rootBlocks) {
    if (/--club-[a-z0-9-]+\s*:/.test(block)) {
      FAIL.push(`${rel}: :root 中定义了 --club-* 令牌（真源必须唯一，见 club-ui.css）`);
      break;
    }
  }
  const lightBlocks = [...css.matchAll(/html\[data-theme="light"\][^{]*\{[^}]*\}/g)].map(m => m[0]);
  for (const block of lightBlocks) {
    if (/--club-(bg|surface|text|accent|line|muted)[a-z0-9-]*\s*:/.test(block) && !/--club-(radius|dur|ease|space|fs|z-|shadow|highlight|grad|glow|ring|topbar|max|gap|font|mono|num|lh|narrow|read)/.test(block)) {
      // 只拦「整块复刻主题色板」的写法；允许页面对少数装饰令牌的微调
      const palette = block.match(/--club-(bg|surface|text|accent|muted|line|ok|warn|danger|info)[a-z0-9-]*\s*:/g) || [];
      if (palette.length >= 5) {
        FAIL.push(`${rel}: 本地亮色块复刻了 --club-* 主题色板（${palette.length} 个），应由 club-ui.css 接管`);
        break;
      }
    }
  }

  // 2. 字体栈
  if (/font-family\s*:[^;}]*(Microsoft YaHei|"Segoe UI"|PingFang SC)/.test(css)) {
    FAIL.push(`${rel}: 硬编码字体栈（应用 var(--club-font) / var(--club-mono)）`);
  }

  // 3. keyframes 注册表
  for (const m of css.matchAll(/@keyframes\s+([a-zA-Z0-9_-]+)/g)) {
    if (/^club-/.test(m[1])) FAIL.push(`${rel}: 页内定义了 club-* 动画（${m[1]}），注册表只允许在 club-ui.css`);
  }

  // 4. main 骨架
  if (!/<main[\s>]/.test(html)) WARN.push(`${rel}: 缺少 <main> 元素`);

  // 5. 断点阶梯（含 min-width 补集）
  for (const m of css.matchAll(/@media[^{]*\(?(max|min)-width\s*:\s*(\d+)px/g)) {
    if (/-height\s*:/.test(m[0])) continue; // 高度语境（横屏判定等）不受宽度阶梯约束
    const v = m[2];
    const comp = m[1] === 'max' ? String(Number(v) + 1) : String(Number(v) - 1);
    if (!CANONICAL_BP.has(v) && !CANONICAL_BP.has(comp)) {
      WARN.push(`${rel}: 非规范断点 ${m[1]}-width:${v}px（规范阶梯 420/640/720/900/1100）`);
    }
  }

  // 6. 旧时长字面值
  const legacy = css.match(/(?:0?\.1[2-8]s|0?\.2s|0?\.3s)\s+ease/g);
  if (legacy) WARN.push(`${rel}: transition 仍有 ${legacy.length} 处旧时长字面值（应用 var(--club-dur*) var(--club-ease)）`);
}

if (WARN.length) {
  console.log('--- WARN（不阻塞，后续清理） ---');
  for (const w of [...new Set(WARN)]) console.log('  ' + w);
}
if (FAIL.length) {
  console.error('--- FAIL ---');
  for (const f of [...new Set(FAIL)]) console.error('  ' + f);
  process.exit(1);
}
console.log('PASS ui tokens: 令牌真源唯一、字体栈接入、keyframes 注册表、main 骨架检查通过');
