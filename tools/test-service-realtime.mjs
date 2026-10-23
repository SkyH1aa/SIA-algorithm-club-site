// Offline: node tools/test-service-realtime.mjs
// 服务开关实时化：总开关/单功能、跨标签同步、断线轮询兜底、自动恢复。
// 最重要的约束：广播只作信号，状态一律回源，伪造广播不能解锁任何功能。
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => readFile(path.join(root, name), 'utf8');

const gate = await read('public/service-gate.js');
const fn = await read('supabase/functions/club-drive/index.ts');
const sql = await read('supabase/site-service-control.sql');
const hub = await read('public/admin-hub.html');

// --- 1) 广播必须只是信号 ---
const bcStart = gate.indexOf('const REALTIME_CHANNEL');
const bcBlock = gate.slice(bcStart, bcStart + 1400);
assert.match(bcBlock, /channel\.on\('broadcast', \{ event: 'service-changed' \}, \(\) => \{ void refresh\('broadcast'\); \}\)/,
  'broadcast only triggers a refetch');
// 绝不能把 payload 当作状态应用。
assert.doesNotMatch(bcBlock, /applyState\(payload\)/, 'broadcast payload is never applied as state');
assert.doesNotMatch(bcBlock, /applyState\(event/, 'broadcast event is never applied as state');

// --- 2) 单一状态入口 ---
assert.match(gate, /function applyState\(state\)/);
assert.match(gate, /const reason = blockReason\(state\);\s*\n\s*if \(reason\) renderOverlay\(reason, state\); else teardownOverlay\(\);/,
  'applyState is the only place that blocks or unblocks');

// --- 3) 阻断判定：总开关优先，其次功能开关 ---
assert.match(gate, /if \(state\.enabled === false\) return \{ kind: 'site', feature: null \};/);
assert.match(gate, /if \(feature && feature\.enabled === false\) return \{ kind: 'feature', feature \};/);

// --- 4) 自动恢复：解除遮罩必须还原被禁用的元素 ---
assert.match(gate, /function teardownOverlay\(\)/);
assert.match(gate, /document\.body\.classList\.remove\('club-service-paused'\)/);
assert.match(gate, /restoreLocked\(\)/);
const restore = gate.slice(gate.indexOf('function restoreLocked'), gate.indexOf('function teardownOverlay'));
assert.match(restore, /removeAttribute\('disabled'\)/, 'blocked controls become usable again');
assert.match(restore, /hadDisabled/, 'pre-existing disabled state is preserved');

// --- 5) 轮询兜底：连通 60s 心跳，断开 5s ---
assert.match(gate, /connState === 'live' \? 60000 : 5000/, 'polling speeds up when realtime drops');
assert.match(gate, /const delay = Math\.min\(60000, 2000 \* Math\.pow\(2, Math\.min\(reconnects, 5\)\)\)/, 'reconnects back off');

// --- 6) 跨标签同步 ---
assert.match(gate, /window\.addEventListener\('storage'/, 'other tabs can push state');
assert.match(gate, /new BroadcastChannel\('club-site-service'\)/, 'BroadcastChannel is used when available');
assert.match(gate, /notifyChanged = \(\) =>/, 'admin can poke other tabs');
// poke 只发时间戳，不带状态。
const notify = gate.slice(gate.indexOf('notifyChanged = () =>'), gate.indexOf('notifyChanged = () =>') + 420);
assert.match(notify, /club-site-service-poke/);
assert.doesNotMatch(notify, /enabled/, 'the poke carries no state');

// --- 7) 连接状态可见 ---
assert.match(gate, /club-service-live-pill/, 'disconnected state is visible to the user');
assert.match(gate, /getConnection/, 'connection state is queryable');
assert.match(gate, /club:serviceconn/, 'connection changes are broadcast to the page');

// --- 8) 后端广播，且失败不影响保存 ---
assert.match(fn, /const SITE_SERVICE_CHANNEL = 'club-site-service-live-v1'/);
assert.match(fn, /async function broadcastServiceChange/, 'backend can push a change signal');
const saveTail = fn.slice(fn.indexOf("if (payload.action === 'admin_site_service_get'"), fn.indexOf("if (payload.action === 'admin_site_service_get'") + 1800);
assert.match(saveTail, /const broadcast = await broadcastServiceChange\(\);/, 'save broadcasts');
assert.match(saveTail, /broadcast \}\)/, 'broadcast result is reported');
// 频道名必须与前端一致。
const channelFront = /const REALTIME_CHANNEL = '([^']+)'/.exec(gate)[1];
const channelBack = /const SITE_SERVICE_CHANNEL = '([^']+)'/.exec(fn)[1];
assert.equal(channelFront, channelBack, 'frontend and backend use the same channel');

// --- 9) updated_at 必须有，否则无法判断是否变化 ---
assert.match(sql, /feature_settings jsonb, updated_at timestamptz\)/, 'status RPC exposes updated_at');
assert.match(gate, /String\(row\.updated_at \|\| ''\)/, 'client uses updated_at as the change signature');

// --- 10) 管理页保存后立即本地生效 ---
assert.match(hub, /ClubServiceGate\?\.notifyChanged\?\.\(\)/, 'admin hub pokes other tabs');
assert.match(hub, /removeItem\('club-site-service-last-state'\)/, 'admin hub drops the stale cache');
assert.match(hub, /siteServiceSavedNoBroadcast/, 'a failed broadcast is surfaced, not hidden');

// --- 11) 行为测试：真实入口驱动，验证遮罩加/撤 ---
{
  let state = { enabled: true, feature_settings: {}, updated_at: '2026-01-01T00:00:00Z' };
  const storageHandlers = [];
  const classes = new Set();
  const disabled = new Set();
  const makeEl = tag => {
    const el = {
      tagName: String(tag).toUpperCase(), children: [], style: {}, dataset: {}, hidden: false,
      attributes: {},
      classList: {
        add: c => classes.add(c),
        remove: c => classes.delete(c),
        toggle: (c, on) => { if (on === undefined ? !classes.has(c) : on) classes.add(c); else classes.delete(c); },
        contains: c => classes.has(c)
      },
      setAttribute(k, v) { this.attributes[k] = String(v); if (k === 'disabled') disabled.add(this); },
      getAttribute(k) { return this.attributes[k] ?? null; },
      hasAttribute(k) { return k in this.attributes; },
      removeAttribute(k) { delete this.attributes[k]; if (k === 'disabled') disabled.delete(this); },
      addEventListener() {}, removeEventListener() {},
      appendChild(child) { this.children.push(child); return child; },
      append(...nodes) { this.children.push(...nodes); },
      remove() { this.removed = true; },
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
  const html = makeEl('html');
  const context = vm.createContext({
    console,
    document: {
      documentElement: html,
      body,
      head: makeEl('head'),
      readyState: 'complete',
      createElement: makeEl,
      querySelectorAll: () => [],
      addEventListener() {},
      getElementById: () => null
    },
    location: { pathname: '/public/chat.html', search: '' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    window: {
      addEventListener(type, handler) { if (type === 'storage') storageHandlers.push(handler); },
      dispatchEvent() {},
      setTimeout: () => 0,
      clearTimeout() {},
      supabase: undefined
    },
    fetch: async () => ({ ok: true, json: async () => [state] }),
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    setTimeout: () => 0,
    clearTimeout() {},
    setInterval: () => 0,
    BroadcastChannel: undefined,
    Intl, Date, JSON, Math, String, Number, Array, Object, Error, RegExp, Promise
  });
  context.globalThis = context;
  vm.runInContext(gate, context, { filename: 'service-gate.js' });

  // check() 是异步的（await refresh），等一个微任务周期。
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(body.classList.contains('club-service-paused'), false, 'enabled site shows no overlay');

  // 另一标签页推送「已关闭」：storage 事件是真实的生产路径之一。
  assert.equal(storageHandlers.length, 1, 'the page subscribes to cross-tab storage events');
  storageHandlers[0]({
    key: 'club-site-service-last-state',
    newValue: JSON.stringify({ enabled: false, feature_settings: {}, updated_at: '2026-01-02T00:00:00Z' })
  });
  assert.equal(body.classList.contains('club-service-paused'), true, 'a closed site blocks an already-open page');

  // 再推送「已开启」：遮罩必须自动撤掉。
  storageHandlers[0]({
    key: 'club-site-service-last-state',
    newValue: JSON.stringify({ enabled: true, feature_settings: {}, updated_at: '2026-01-03T00:00:00Z' })
  });
  assert.equal(body.classList.contains('club-service-paused'), false, 'reopening restores the page automatically');

  // 单功能关闭：只有该功能的页面被拦。
  storageHandlers[0]({
    key: 'club-site-service-last-state',
    newValue: JSON.stringify({ enabled: true, feature_settings: { chat: { enabled: false } }, updated_at: '2026-01-04T00:00:00Z' })
  });
  assert.equal(body.classList.contains('club-service-paused'), true, 'a disabled feature blocks its own page');

  // 关闭的是别的功能：本页不受影响。
  storageHandlers[0]({
    key: 'club-site-service-last-state',
    newValue: JSON.stringify({ enabled: true, feature_settings: { gomoku: { enabled: false } }, updated_at: '2026-01-05T00:00:00Z' })
  });
  assert.equal(body.classList.contains('club-service-paused'), false, 'unrelated features do not block this page');
}
console.log('Service realtime: broadcast-is-signal-only, site/feature gating, auto-restore, 5s fallback polling, cross-tab sync, visible connection state, matching channel names, updated_at signature, open-page blocking passed.');
