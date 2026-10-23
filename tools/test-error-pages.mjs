// Offline: node tools/test-error-pages.mjs
// 502 / 503 / 404 故障页 + 展示方式（遮罩 / 路由）+ 遮罩时清空页面。
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => readFile(path.join(root, name), 'utf8');
const exists = async name => { try { await readFile(path.join(root, name)); return true; } catch { return false; } };

// --- 1) 文件必须放在仓库根目录（GitHub Pages 只认根目录） ---
// 故障页文件名：404 保持原名；502/503 必须避开 GitHub Pages 的保留路径。
// GitHub Pages 会把 /503.html 解析成它自己的错误页，覆盖仓库里的同名文件。
const FILES = { '404': '404.html', '502': 'bad-gateway.html', '503': 'service-unavailable.html' };
for (const file of Object.values(FILES)) {
  assert.ok(await exists(file), `${file} exists at the repository root`);
  assert.ok(!(await exists(`public/${file}`)), `${file} is not under public/`);
}
assert.ok(!(await exists('503.html')), '503.html must not exist: GitHub Pages reserves that path');
assert.ok(!(await exists('502.html')), '502.html must not exist either');

const page502 = await read(FILES['502']);
const page503 = await read(FILES['503']);
const page404 = await read(FILES['404']);
const errorJs = await read('public/error-page.js');
const gate = await read('public/service-gate.js');
const sql = await read('supabase/club-error-pages-schema.sql');
const serviceSql = await read('supabase/site-service-control.sql');
const fn = await read('supabase/functions/club-drive/index.ts');
const hub = await read('public/admin-hub.html');

// --- 2) 三页都基于站点根解析相对链接 ---
for (const [name, html] of [['502', page502], ['503', page503], ['404', page404]]) {
  assert.match(html, /var REPO = 'SIA-algorithm-club-site';/, `${name} resolves the project root`);
  assert.match(html, /document\.write\('<base href="' \+ base \+ '">'\)/, `${name} sets a base href`);
  assert.match(html, /club-error-pages|error-page\.js/, `${name} loads the shared renderer`);
}
assert.match(page502, /mount\(502\)/);
assert.match(page503, /mount\(503\)/);
assert.match(page404, /mount\(404\)/, '404 also uses the editable content');

// --- 3) 超管只能编辑结构化字段，不能注入 HTML ---
assert.match(errorJs, /function renderMarkdown/, 'body is Markdown-rendered, not injected raw');
// 只允许把「经 renderMarkdown 处理后的结果」写进 innerHTML。
assert.ok(!/innerHTML\s*=\s*customBody\s*[;,)]/.test(errorJs), 'raw body is never assigned to innerHTML');
assert.match(errorJs, /innerHTML = customBody \? renderMarkdown\(customBody\) : ''/, 'body goes through renderMarkdown first');
assert.match(errorJs, /function safeHref/, 'button links are validated');
assert.match(errorJs, /if \(!value\) return '';/, 'empty href is allowed (falls back to default)');
assert.match(errorJs, /\^https\?:\\\/\\\//, 'only http(s) absolute URLs pass');
// 渲染前先转义。
assert.match(errorJs, /const esc = text => String\(text == null \? '' : text\)\.replace\(\/\[&<>"'\]\/g/, 'text is escaped');

// --- 4) SQL：三页默认模板 + 只允许这三个状态码 ---
for (const code of [404, 502, 503]) {
  assert.match(sql, new RegExp(`\\(${code},`), `${code} has a seeded default template`);
}
assert.match(sql, /constraint club_error_pages_code_check check \(code in \(502, 503, 404\)\)/);
assert.match(sql, /enable row level security/);
assert.doesNotMatch(sql, /grant [^;]*to anon[^;]*club_error_pages[^;]*;/i, 'table itself is not granted to anon');
// 公开读只通过 RPC，且只返回这三页。
assert.match(sql, /create or replace function public\.club_error_pages_get\(\)/);
assert.match(sql, /grant execute on function public\.club_error_pages_get\(\) to anon, authenticated/);
assert.doesNotMatch(sql, /drop table/i, 'never drops a table');

// --- 5) 展示方式：站点级 + 功能级 ---
assert.match(sql, /display_mode text not null default 'overlay'/, 'site-level display mode, default overlay');
assert.match(sql, /check \(display_mode in \('overlay', '502', '503', '404'\)\)/);
assert.match(serviceSql, /coalesce\(nullif\(display_mode, ''\), 'overlay'\)/, 'status RPC exposes display_mode');
assert.match(gate, /function resolveDisplay\(reason, state\)/, 'display mode is resolved per block reason');
assert.match(gate, /const raw = reason\.kind === 'site'\s*\n\s*\? state\.display_mode\s*\n\s*: \(reason\.feature && reason\.feature\.display_mode\);/,
  'site close uses the site mode; feature close uses the feature mode');
assert.match(gate, /return \['502', '503', '404'\]\.includes\(mode\) \? mode : 'overlay';/, 'unknown modes fall back to overlay');
assert.match(hub, /id="siteDisplayMode"/, 'admin can pick the site-level mode');
assert.match(hub, /data-display-mode/, 'each feature has its own mode selector');
assert.match(hub, /display_mode: display \? display\.value : 'overlay'/, 'feature modes are saved');

// --- 6) 路由防循环 ---
assert.match(gate, /const isErrorPage = \/\(\?:\^\|\\\/\)\(\?:404\|bad-gateway\|service-unavailable\)\\\.html\$\/i\.test\(location\.pathname\)/,
  'error pages are detected by their real filenames');
assert.match(gate, /if \(isAdminHub \|\| isTemporaryLogin \|\| isErrorPage\) return;/, 'the gate never runs on an error page');
assert.match(gate, /function routeToErrorPage\(code\)/, 'routing helper exists');
assert.match(gate, /if \(redirected\) return;/, 'a redirect happens at most once per page load');
assert.match(gate, /const ERROR_PAGE_FILES = \{ '502': 'bad-gateway\.html', '503': 'service-unavailable\.html', '404': '404\.html' \}/,
  'display modes map to the real filenames');
assert.match(gate, /location\.replace\(siteRoot\(\) \+ \(ERROR_PAGE_FILES\[code\] \|\| '404\.html'\)\)/, 'routing uses replace so Back does not return to a closed page');

// --- 7) 遮罩时清空页面 DOM ---
assert.match(gate, /function detachPageContent\(\)/, 'page content is detached, not merely hidden');
assert.match(gate, /detachedNodes\.push\(\{ node, next: node\.nextSibling \}\)/, 'detached nodes keep their position');
assert.match(gate, /node\.id === 'club-service-overlay' \|\| node\.id === 'club-service-live-pill'/, 'the overlay itself is never detached');
assert.match(gate, /function reattachPageContent\(\)/, 'content is restored on unblock');
assert.match(gate, /detachPageContent\(\);/);
assert.match(gate, /reattachPageContent\(\);/);
// 顺序必须是「挂上遮罩 -> 摘除内容」，不能反过来（否则遮罩也一起消失）。
const mountIndex = gate.indexOf('document.body.appendChild(overlay);');
const detachIndex = gate.indexOf('detachPageContent();');
assert.ok(mountIndex > 0 && detachIndex > mountIndex, 'the overlay is attached before content is detached');

// --- 8) 后端 ---
for (const action of ['admin_error_pages_get', 'admin_error_pages_set', 'admin_error_pages_reset']) {
  const start = fn.indexOf(`payload.action === '${action}'`);
  assert.ok(start > 0, `${action} exists`);
  assert.match(fn.slice(start, start + 400), /requireSuperAdmin\(user\)/, `${action} is super-admin only`);
}
assert.match(fn, /p_display_mode: payload\.displayMode \|\| null/, 'site display mode is persisted');
assert.match(fn, /code in \(502, 503, 404\)|\[502, 503, 404\]\.includes\(code\)/, 'backend rejects other codes');

// --- 9) 行为：safeHref 与 Markdown 渲染 ---
{
  const ctx = { window: {}, localStorage: { getItem: () => null }, document: { getElementById: () => null }, fetch: async () => ({ ok: false }), CustomEvent: class {} };
  vm.createContext(ctx);
  vm.runInContext(errorJs, ctx);
  const api = ctx.window.ClubErrorPage;
  assert.ok(api, 'ClubErrorPage is exposed');

  // 合法链接
  for (const href of ['index.html', 'public/chat.html', '/SIA-algorithm-club-site/index.html', 'https://example.com/x', '']) {
    assert.equal(api.safeHref(href), href, `safeHref allows ${JSON.stringify(href)}`);
  }
  // 危险链接
  for (const href of ['javascript:alert(1)', 'data:text/html,x', 'vbscript:x', 'java\nscript:alert(1)']) {
    assert.equal(api.safeHref(href), '', `safeHref rejects ${JSON.stringify(href)}`);
  }

  // Markdown：HTML 必须被转义，不能形成标签。
  const html = api.renderMarkdown('<img src=x onerror=alert(1)>');
  assert.ok(!/<img/i.test(html), 'raw HTML in Markdown is escaped');
  assert.ok(/&lt;img/.test(html), 'HTML is shown as text');

  // 正常 Markdown 仍然生效。
  const rich = api.renderMarkdown('## 标题\n\n- 一项\n- 另一项\n\n[链接](https://example.com)');
  assert.match(rich, /<h2>标题<\/h2>/);
  assert.match(rich, /<div class="report-item">一项<\/div>/);
  assert.match(rich, /<a href="https:\/\/example\.com" target="_blank" rel="noopener noreferrer">链接<\/a>/);

  // javascript: 链接不会被渲染成可点击的 a。
  const bad = api.renderMarkdown('[点我](javascript:alert(1))');
  assert.ok(!/href="javascript:/i.test(bad), 'javascript: markdown links are not emitted');
}

// --- 10) 遮罩清空的真实行为 ---
{
  const storageHandlers = [];
  const classes = new Set();
  const appended = [];
  const makeEl = tag => {
    const el = {
      tagName: String(tag).toUpperCase(), children: [], style: {}, dataset: {}, hidden: false,
      attributes: {}, id: '', parentNode: null,
      classList: {
        add: c => classes.add(c), remove: c => classes.delete(c),
        toggle: (c, on) => { if (on === undefined ? !classes.has(c) : on) classes.add(c); else classes.delete(c); },
        contains: c => classes.has(c)
      },
      setAttribute(k, v) { this.attributes[k] = String(v); },
      getAttribute(k) { return this.attributes[k] ?? null; },
      hasAttribute(k) { return k in this.attributes; },
      removeAttribute(k) { delete this.attributes[k]; },
      addEventListener() {}, removeEventListener() {},
      appendChild(child) { child.parentNode = this; this.children.push(child); appended.push(child); return child; },
      insertBefore(child) { child.parentNode = this; this.children.push(child); return child; },
      append(...nodes) { for (const n of nodes) { n.parentNode = this; this.children.push(n); } },
      remove() { this.removed = true; if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(c => c !== this); },
      contains() { return false; },
      querySelector() { return makeEl('div'); },
      querySelectorAll() { return []; }
    };
    let html = '', text = '';
    Object.defineProperty(el, 'innerHTML', { get: () => html, set: v => { html = String(v); } });
    Object.defineProperty(el, 'textContent', { get: () => text, set: v => { text = String(v); } });
    return el;
  };
  const body = makeEl('body');
  const pageHeader = makeEl('header'); pageHeader.id = 'page-header';
  const pageMain = makeEl('main'); pageMain.id = 'page-main';
  body.children.push(pageHeader, pageMain);
  pageHeader.parentNode = body; pageMain.parentNode = body;
  const docEl = makeEl('html');
  const ctx = vm.createContext({
    console,
    document: {
      documentElement: docEl, body, head: makeEl('head'), readyState: 'complete',
      createElement: makeEl, querySelectorAll: () => [], addEventListener() {},
      getElementById: () => null, visibilityState: 'visible'
    },
    location: { pathname: '/public/chat.html', search: '', protocol: 'https:', hostname: 'skyh1aa.github.io', replace() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    window: {
      addEventListener(type, handler) { if (type === 'storage') storageHandlers.push(handler); },
      dispatchEvent() {}, setTimeout: () => 0, clearTimeout() {}, supabase: undefined
    },
    fetch: async () => ({ ok: true, json: async () => [{ enabled: true, feature_settings: {}, updated_at: 'x' }] }),
    CustomEvent: class { constructor(t, i) { this.type = t; this.detail = i?.detail; } },
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0,
    BroadcastChannel: undefined, Intl, Date, JSON, Math, String, Number, Array, Object, Error, RegExp, Promise
  });
  ctx.globalThis = ctx;
  vm.runInContext(gate, ctx, { filename: 'service-gate.js' });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(body.children.includes(pageHeader), true, 'content is present while the site is open');

  // 关闭（遮罩模式）——页面主体必须从 DOM 中移除。
  storageHandlers[0]({ key: 'club-site-service-last-state', newValue: JSON.stringify({ enabled: false, display_mode: 'overlay', feature_settings: {}, updated_at: 'a' }) });
  assert.equal(body.children.includes(pageHeader), false, 'header is detached while blocked');
  assert.equal(body.children.includes(pageMain), false, 'main is detached while blocked');
  assert.equal(body.children.some(child => child.id === 'club-service-overlay'), true, 'the overlay stays in the DOM');
  assert.equal(classes.has('club-service-paused'), true);

  // 恢复——页面主体必须回到 DOM。
  storageHandlers[0]({ key: 'club-site-service-last-state', newValue: JSON.stringify({ enabled: true, display_mode: 'overlay', feature_settings: {}, updated_at: 'b' }) });
  assert.equal(body.children.includes(pageHeader), true, 'header is restored');
  assert.equal(body.children.includes(pageMain), true, 'main is restored');
  assert.equal(classes.has('club-service-paused'), false);
}

console.log('Error pages: 404.html + bad-gateway.html + service-unavailable.html at repo root (503.html is reserved by GitHub Pages), editable structured fields with escaped Markdown + safe links, per-site & per-feature display modes, no redirect loop, DOM cleared under the overlay and restored on reopen.');
