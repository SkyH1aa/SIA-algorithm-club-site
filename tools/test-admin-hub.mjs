// Offline: node tools/test-admin-hub.mjs
//
// 回归保护：admin-hub.html 曾在超管账号下卡在「请先登录管理账号」。
//
// 根因是内联脚本在解析期直接调用 window.ClubStaffAccess.emptyPermissions()，
// 而 member-identity.js 是 defer 脚本，此时还没执行 → TypeError → 整个内联
// 脚本中断 → updateSession 从未运行 → 门禁永远不消失。
// 其他管理页不调用这套 API，所以只有管理员总览受影响。
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => readFile(path.join(root, name), 'utf8');

const page = await read('public/admin-hub.html');

// 1) The page must not call ClubStaffAccess at parse time without a guard.
assert.ok(!/let currentAccess = \{ isSuperAdmin: false, permissions: window\.ClubStaffAccess\.emptyPermissions\(\) \};/.test(page),
  'no unguarded ClubStaffAccess.emptyPermissions() at parse time');
assert.match(page, /const EMPTY_PERMISSIONS = \{/, 'a local permission fallback exists');
assert.match(page, /const emptyPermissions = \(\) =>/, 'permissions go through a guarded getter');

// 2) fetchStaffAccess must be awaited behind a readiness check.
assert.match(page, /whenStaffAccessReady\(\)/, 'updateSession waits for ClubStaffAccess');
assert.match(page, /function whenStaffAccessReady\(\)/, 'readiness helper exists');
const readyFn = page.slice(page.indexOf('function whenStaffAccessReady()')).slice(0, 600);
assert.match(readyFn, /window\.ClubStaffAccess/, 'waits for the global to appear');
assert.match(readyFn, /setTimeout\(tick, 25\)/, 'polls instead of assuming it is loaded');
assert.match(readyFn, /3000/, 'gives up after a bounded wait');
assert.match(page, /await whenStaffAccessReady\(\);\s*if \(revision !== sessionRevision\) return;\s*const access = await window\.ClubStaffAccess\.fetchStaffAccess\(session\);/,
  'the wait and stale-session check happen before fetchStaffAccess');

// 3) Behavioural: simulate the deferred-script ordering (ClubStaffAccess absent
//    during parse, present later) and make sure the page reaches the content.
const STUB = `
  const EMPTY_PERMISSIONS = { can_checkin: false, can_points: false, can_messages: false, can_invites: false, can_events: false, can_mall: false, can_members: false, can_join: false };
  const emptyPermissions = () => (window.ClubStaffAccess && typeof window.ClubStaffAccess.emptyPermissions === 'function')
    ? window.ClubStaffAccess.emptyPermissions()
    : { ...EMPTY_PERMISSIONS };
  let currentAccess = { isSuperAdmin: false, permissions: emptyPermissions() };
  function whenStaffAccessReady() {
    if (window.ClubStaffAccess) return Promise.resolve(true);
    return new Promise(resolve => {
      const started = Date.now();
      const tick = () => {
        if (window.ClubStaffAccess) return resolve(true);
        if (Date.now() - started > 3000) return resolve(false);
        setTimeout(tick, 25);
      };
      tick();
    });
  }
  globalThis.__probe = { currentAccess, whenStaffAccessReady, EMPTY_PERMISSIONS, emptyPermissions };
`;

// The snippet references EMPTY_PERMISSIONS before its declaration in source order,
// exactly like the real file (const hoisting is fine because it runs later).
const sandbox = vm.createContext({ window: {}, setTimeout, console, Date, Promise });
vm.runInContext(STUB, sandbox);
const probe = sandbox.__probe;

// At parse time, permissions fall back to all-false instead of throwing.
assert.equal(probe.currentAccess.isSuperAdmin, false);
assert.equal(probe.currentAccess.permissions.can_members, false);

// Later the deferred script defines the global; the waiter resolves.
sandbox.window.ClubStaffAccess = {
  emptyPermissions: () => ({ can_checkin: false, can_points: false, can_messages: false, can_invites: false, can_events: false, can_mall: false, can_members: false, can_join: false }),
  fetchStaffAccess: async () => ({ isSuperAdmin: true, permissions: {} })
};
assert.equal(await probe.whenStaffAccessReady(), true, 'waiter resolves once the global exists');

// 4) Parse the actual HTML in a browser and run the production tab/visibility
// functions against that DOM. External page scripts and network calls are not
// needed, so the fixture is served with scripts disabled and no dependencies.
const shell = await read('public/club-shell.js');
function sourceBetween(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `cannot locate ${start}`);
  return source.slice(from, to);
}
const setupTabsSource = sourceBetween(shell, '  function setupTabs(scope) {', '\n  // 外部可在数据加载完成后');
const visibilitySource = sourceBetween(page, '    function applySectionVisibility() {', '\n    // Supabase 网关');

// Harness tests execute the production inline script with a small DOM/auth facade.
// Every request is held until the test releases it, so races are deterministic.
const script = [...page.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]).find(source => source.includes('const SUPABASE_URL'));
assert.ok(script, 'admin inline script exists');
const nodes = new Map();
const nodeFor = id => {
  if (!nodes.has(id)) {
    const classes = new Set();
    nodes.set(id, { value: '', textContent: '', className: '', disabled: false, hidden: false, dataset: {},
      attributes: {}, listeners: {}, classList: { add: value => classes.add(value), remove: value => classes.delete(value),
        toggle: (value, force) => force ? classes.add(value) : classes.delete(value), contains: value => classes.has(value) },
      setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener(name, handler) { this.listeners[name] = handler; }, focus() {}, reset() {}, querySelector() { return null; } });
  }
  return nodes.get(id);
};
const auth = { onAuthStateChange() {}, getSession: () => new Promise(() => {}) };
const events = new Map();
const requests = [];
let lang = 'zh';
const fixtureWindow = {
  supabase: { createClient: () => ({ auth }) },
  ClubI18n: { t: key => `${lang}:${key}`, apply() {} },
  ClubStaffAccess: { emptyPermissions: () => ({}), hasStaffAccess: access => access.isSuperAdmin,
    fetchStaffAccess: async () => ({ isSuperAdmin: true, permissions: {} }) },
  addEventListener: (name, handler) => events.set(name, handler)
};
const fixture = vm.createContext({ window: fixtureWindow, ClubI18n: fixtureWindow.ClubI18n,
  document: { getElementById: nodeFor, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] },
  location: { protocol: 'https:', search: '' }, URL, URLSearchParams, console, Date, Promise,
  setTimeout() {}, fetch: async (_url, options) => {
    const body = JSON.parse(options.body);
    if (!['mingshen_harness_download_get', 'admin_mingshen_harness_download_set'].includes(body.action)) return { ok: true, json: async () => ({}) };
    return new Promise(resolve => requests.push({ body, resolve: payload => resolve({ ok: true, json: async () => payload }),
      reject: () => resolve({ ok: false, status: 500, json: async () => ({ error: 'backend detail' }) }) }));
  }
});
vm.runInContext(`${script}\nglobalThis.probe = { loadMingshenHarness, saveMingshenHarness, refreshMingshenHarness, resetMingshenHarness, isHarnessDownloadUrlValid, updateSession,
  state: harnessState, access(value) { currentAccess = { isSuperAdmin: value, permissions: {} }; },
  session(value) { currentSession = value; }, applySectionVisibility, refreshOverview };`, fixture);
const harness = fixture.probe;
const adminSession = { user: { id: 'super' }, access_token: 'token' };
const input = nodeFor('mingshenHarnessDownloadUrl');
const message = nodeFor('mingshenHarnessMessage');
const edit = value => { input.value = value; input.listeners.input(); };
harness.session(adminSession);
harness.access(true);
assert.match(page, /id="mingshenHarnessDownloadUrl"[^>]*maxlength="2048"/, 'URL input enforces agreed length');
assert.match(page, /https:\/\/github\.com\/SkyH1aa\/MingshenHarness/, 'fallback repository is visible');
for (const value of ['', ' https://example.org/a.zip?download=1&name=test#release ', `https://example.org/${'a'.repeat(2028)}`]) {
  assert.equal(harness.isHarnessDownloadUrlValid(value), true, `valid URL: ${value.slice(0, 80)}`);
}
for (const value of ['http://example.org/a.zip', '/a.zip', '//example.org/a.zip', 'https:example.org/a.zip', 'javascript:alert(1)',
  'https://name:password@example.org/a.zip', 'https://name@example.org/a.zip', 'https://@example.org/a.zip', 'https:///example.org/a.zip', 'https://example.org/a b', 'https://example.org/a\\b', 'https://example.org/a\nb', '\thttps://example.org/a', 'https://example.org/a\u0085b',
  `https://example.org/${'a'.repeat(2048)}`]) {
  assert.equal(harness.isHarnessDownloadUrlValid(value), false, `invalid URL: ${JSON.stringify(value.slice(0, 80))}`);
}
let work = harness.loadMingshenHarness();
assert.equal(requests.at(-1).body.action, 'mingshen_harness_download_get');
requests.at(-1).resolve({ downloadUrl: 'https://example.org/old.zip' });
await work;
assert.equal(input.value, 'https://example.org/old.zip');
work = harness.loadMingshenHarness();
edit('https://example.org/draft.zip?token=abc');
requests.at(-1).resolve({ downloadUrl: 'https://example.org/stale.zip' });
await work;
assert.equal(input.value, 'https://example.org/draft.zip?token=abc', 'late GET preserves draft');
const beforeLanguage = requests.length;
lang = 'en';
events.get('club:langchange')();
await Promise.resolve();
assert.equal(input.value, 'https://example.org/draft.zip?token=abc', 'language refresh preserves draft');
assert.equal(message.textContent, 'en:admin.harnessDraft', 'status is retranslated from its key');
assert.equal(requests.length, beforeLanguage, 'language overview does not fetch over dirty draft');
work = harness.saveMingshenHarness();
assert.deepEqual(JSON.parse(JSON.stringify(requests.at(-1).body)), { action: 'admin_mingshen_harness_download_set', downloadUrl: input.value });
assert.equal(nodeFor('mingshenHarnessSave').disabled, true, 'save is disabled while saving');
edit('https://example.org/newer.zip');
requests.at(-1).resolve({ downloadUrl: 'https://example.org/draft.zip?token=abc' });
await work;
assert.equal(input.value, 'https://example.org/newer.zip', 'save response preserves newer edits');
assert.equal(harness.state.dirty, true);
work = harness.saveMingshenHarness();
requests.at(-1).resolve({ downloadUrl: 'https://example.org/newer.zip' });
await work;
assert.equal(harness.state.dirty, false);
assert.equal(message.textContent, 'en:admin.harnessSaved');
work = harness.saveMingshenHarness(true);
assert.equal(requests.at(-1).body.downloadUrl, '', 'clear persists an empty config');
requests.at(-1).resolve({ downloadUrl: '' });
await work;
assert.equal(input.value, '');
assert.equal(message.textContent, 'en:admin.harnessCleared');
edit('http://example.org/insecure.zip');
const beforeInvalid = requests.length;
await harness.saveMingshenHarness();
assert.equal(requests.length, beforeInvalid, 'invalid input never reaches backend');
assert.equal(input.attributes['aria-invalid'], 'true');
edit('https://example.org/retry.zip');
work = harness.saveMingshenHarness();
requests.at(-1).reject();
await work;
assert.equal(input.value, 'https://example.org/retry.zip', 'failed save preserves edits');
lang = 'zh';
harness.refreshMingshenHarness();
assert.equal(message.textContent, 'zh:admin.harnessSaveFailed', 'failure status also retranslates');
// P2: a real same-account token refresh must not unlock write A. Otherwise B
// can commit first and A can later overwrite it while the UI claims B is saved.
edit('https://example.org/write-a.zip');
const writeA = harness.saveMingshenHarness();
const requestA = requests.at(-1);
const tokenA = harness.state.writeToken;
assert.ok(tokenA, 'write A owns an independent lock');
await harness.updateSession({ ...adminSession, access_token: 'refreshed-token' });
assert.equal(harness.state.writeToken, tokenA, 'same-account refresh retains write lock');
assert.equal(nodeFor('mingshenHarnessSave').disabled, true);
assert.equal(nodeFor('mingshenHarnessClear').disabled, true);
assert.equal(input.disabled, false, 'draft stays editable during old write');
edit('https://example.org/write-b.zip');
const duringA = requests.length;
await harness.saveMingshenHarness();
await harness.saveMingshenHarness(true);
assert.equal(requests.length, duringA, 'neither B nor clear can overtake in-flight A after token refresh');
assert.equal(input.value, 'https://example.org/write-b.zip', 'blocked clear does not discard draft B');
let databaseUrl = requestA.body.downloadUrl;
requestA.resolve({ downloadUrl: databaseUrl });
await writeA;
assert.equal(harness.state.writeToken, null, 'stale A response still releases its own lock');
assert.equal(nodeFor('mingshenHarnessSave').disabled, false);
assert.equal(nodeFor('mingshenHarnessForm').attributes['aria-busy'], 'false');
assert.equal(input.value, 'https://example.org/write-b.zip', 'stale A response leaves draft B intact');
const writeB = harness.saveMingshenHarness();
const requestB = requests.at(-1);
assert.equal(requestB.body.downloadUrl, 'https://example.org/write-b.zip');
databaseUrl = requestB.body.downloadUrl;
requestB.resolve({ downloadUrl: databaseUrl });
await writeB;
assert.equal(input.value, databaseUrl, 'serialized last commit matches displayed saved URL');
assert.equal(message.textContent, 'zh:admin.harnessSaved');
// Signout and a different account must also retain the old request's lock.
edit('https://example.org/previous-account.zip');
const previousWork = harness.saveMingshenHarness();
const previousRequest = requests.at(-1);
const previousToken = harness.state.writeToken;
await harness.updateSession(null);
assert.equal(harness.state.writeToken, previousToken, 'signout retains in-flight write lock');
await harness.updateSession({ user: { id: 'other-super' }, access_token: 'other-token' });
assert.equal(harness.state.writeToken, previousToken, 'account switch retains in-flight write lock');
assert.equal(nodeFor('mingshenHarnessSave').disabled, true);
assert.equal(input.disabled, false);
edit('https://example.org/other-account.zip');
const duringPrevious = requests.length;
await harness.saveMingshenHarness();
assert.equal(requests.length, duringPrevious, 'new account cannot overtake previous account write');
previousRequest.reject();
await previousWork;
assert.equal(harness.state.writeToken, null, 'failed stale write also releases its lock');
assert.equal(input.value, 'https://example.org/other-account.zip');
assert.equal(message.textContent, 'zh:admin.harnessDraft', 'old account failure does not replace new account status');
const otherWork = harness.saveMingshenHarness();
const otherToken = harness.state.writeToken;
assert.ok(otherToken && otherToken !== previousToken, 'new request owns a distinct lock');
assert.equal(nodeFor('mingshenHarnessSave').disabled, true, 'new write stays locked until its own settlement');
requests.at(-1).resolve({ downloadUrl: 'https://example.org/other-account.zip' });
await otherWork;
assert.equal(harness.state.writeToken, null);
work = harness.saveMingshenHarness();
const oldWrite = requests.at(-1);
await harness.updateSession(null);
oldWrite.resolve({ downloadUrl: 'https://example.org/retry.zip' });
await work;
assert.equal(input.value, '', 'late save cannot refill signed-out form');
assert.equal(message.textContent, '', 'late save cannot repopulate signed-out status');
assert.equal(input.disabled, true);
harness.session(adminSession);
harness.access(true);
work = harness.loadMingshenHarness();
const oldRead = requests.at(-1);
harness.access(false);
harness.applySectionVisibility();
oldRead.resolve({ downloadUrl: 'https://example.org/private.zip' });
await work;
assert.equal(input.value, '', 'permission loss clears and invalidates read');
const beforeDenied = requests.length;
await harness.saveMingshenHarness();
assert.equal(requests.length, beforeDenied, 'non-super-admin cannot save');
assert.equal(message.textContent, 'zh:admin.harnessPermissionRequired');
harness.access(true);
work = harness.loadMingshenHarness();
requests.at(-1).reject();
await work;
assert.equal(message.textContent, 'zh:admin.harnessLoadFailed');
lang = 'en';
harness.refreshMingshenHarness();
assert.equal(message.textContent, 'en:admin.harnessLoadFailed');
// A pending staff-access lookup must not resurrect super-admin UI after signout.
let grantAccess;
fixtureWindow.ClubStaffAccess.fetchStaffAccess = () => new Promise(resolve => { grantAccess = resolve; });
work = harness.updateSession(adminSession);
await new Promise(resolve => setImmediate(resolve));
assert.equal(typeof grantAccess, 'function');
await harness.updateSession(null);
grantAccess({ isSuperAdmin: true, permissions: {} });
await work;
assert.equal(nodeFor('content').classList.contains('hidden'), true, 'stale login cannot reopen signed-out content');
assert.equal(input.disabled, true, 'stale permissions cannot re-enable Harness form');
console.log('Admin Harness: validation, GET/save/clear, translated states, draft races, cross-session write serialization, signout and permission loss passed.');

const browser = [process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
  path.join(process.env.LOCALAPPDATA || '', 'Microsoft/Edge/Application/msedge.exe'),
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].filter(Boolean).find(existsSync);
assert.ok(browser, 'Chrome or Edge is required for the admin tab regression; set CHROME_PATH');
assert.equal(typeof WebSocket, 'function', 'Node must provide WebSocket (Node 22 or later)');
const profile = await mkdtemp(path.join(os.tmpdir(), 'admin-hub-test-'));
const server = http.createServer((request, response) => {
  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': "default-src 'none'; style-src 'none'"
  });
  response.end(page);
});
let chrome;
let socket;
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  chrome = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  let endpoint;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (chrome.exitCode !== null) throw new Error(`browser exited with code ${chrome.exitCode}`);
    try {
      const port = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0];
      endpoint = `http://127.0.0.1:${port}`;
      break;
    } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  assert.ok(endpoint, 'browser DevTools did not start');
  const targets = await (await fetch(`${endpoint}/json`)).json();
  const target = targets.find(item => item.type === 'page');
  assert.ok(target, 'browser page target exists');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
    else waiter.resolve(message.result);
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  await call('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate("document.readyState === 'complete' && location.hostname === '127.0.0.1'")) break;
    if (attempt === 99) throw new Error('admin fixture did not load');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const test = function (setupSource, visibilitySource) {
    function check(condition, message) { if (!condition) throw new Error(message); }
    const roots = document.querySelectorAll('#superToolsSection');
    check(roots.length === 1, 'superToolsSection must exist exactly once');
    const root = roots[0];
    const tablists = root.querySelectorAll('[data-club-tabs]');
    check(tablists.length === 1, 'super tools must have exactly one tab list');
    const tabs = tablists[0];
    const buttons = [...tabs.querySelectorAll('[role="tab"], button[data-tab-target]')];
    const panels = [...root.children].filter(node => node.matches('section.panel'));
    check(buttons.length > 0 && panels.length > 0, 'super tool tabs and panels must exist');
    check(buttons.filter(button => button.getAttribute('aria-selected') === 'true').length === 1, 'exactly one tab must start selected');
    const ids = buttons.map(button => {
      const id = button.dataset.tabTarget;
      check(Boolean(id), 'every tab must specify a target');
      check(button.getAttribute('aria-controls') === id, `aria-controls differs from target ${id}`);
      const matches = [...document.querySelectorAll('[id]')].filter(node => node.id === id);
      check(matches.length === 1, `target ${id} must occur exactly once in the document`);
      check(matches[0].parentElement === root && matches[0].matches('section.panel'), `target ${id} must be a direct super tool panel`);
      return id;
    });
    check(new Set(ids).size === ids.length, 'tab targets must be unique');
    check(panels.length === buttons.length && panels.every(panel => ids.includes(panel.id)), 'every super tool panel must have exactly one tab');

    // Compile the real functions unchanged; only their surrounding page globals
    // are supplied here. This keeps the regression independent of login/backend.
    const setupTabs = new Function(`${setupSource}\nreturn setupTabs;`)();
    const access = { isSuperAdmin: true };
    const makeVisibility = new Function('currentAccess', '$', 'permOn', 'renderEntries', 'resetMingshenHarness', 'refreshMingshenHarness',
      `let adminTabsReady = false;\n${visibilitySource}\nreturn applySectionVisibility;`);
    const applyVisibility = makeVisibility(access, id => document.getElementById(id), () => false, () => {}, () => {}, () => {});
    const assertActive = (button, context) => {
      const target = button.dataset.tabTarget;
      check(tabs.dataset.activeTab === target, `${context}: active target`);
      for (const candidate of buttons) {
        const selected = candidate === button;
        const panel = document.getElementById(candidate.dataset.tabTarget);
        check(panel.hidden === !selected, `${context}: incorrect hidden state for ${panel.id}`);
        check(candidate.getAttribute('aria-selected') === String(selected), `${context}: aria-selected for ${panel.id}`);
        check(candidate.tabIndex === (selected ? 0 : -1), `${context}: tabindex for ${panel.id}`);
      }
    };
    setupTabs(document);
    const initial = buttons.find(button => button.getAttribute('aria-selected') === 'true');
    assertActive(initial, 'initialization');
    for (const panel of panels) check(panel.hasAttribute('data-club-tabpanel'), `${panel.id} must be managed by setupTabs`);
    for (const button of buttons) {
      button.click();
      assertActive(button, `click ${button.dataset.tabTarget}`);
      // Simulate stray state from an asynchronous permission refresh.
      for (const panel of panels) { panel.hidden = false; panel.classList.add('hidden'); }
      applyVisibility();
      check(!root.classList.contains('hidden'), 'super admin root must be visible');
      check(panels.every(panel => !panel.classList.contains('hidden')), 'visibility refresh must clear legacy hidden classes on all panels');
      assertActive(button, `super-admin refresh ${button.dataset.tabTarget}`);
      access.isSuperAdmin = false;
      applyVisibility();
      check(root.classList.contains('hidden'), 'non-super-admin root must be hidden');
      check(panels.every(panel => panel.hidden), 'non-super-admin refresh must hide every panel');
      access.isSuperAdmin = true;
      applyVisibility();
      check(!root.classList.contains('hidden'), 'super admin root must return');
      assertActive(button, `permission restoration ${button.dataset.tabTarget}`);
    }
    const first = buttons[0];
    first.click();
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    assertActive(buttons.at(-1), 'ArrowLeft wraps');
    check(document.activeElement === buttons.at(-1), 'keyboard navigation moves focus');
    buttons.at(-1).dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    assertActive(first, 'Home');
    return { panels: panels.length, targets: ids };
  };
  const result = await evaluate(`(${test.toString()})(${JSON.stringify(setupTabsSource)}, ${JSON.stringify(visibilitySource)})`);
  console.log(`Admin hub: guarded login and ${result.panels} real HTML panels; tab switching and permission refresh passed (${result.targets.join(', ')}).`);
} finally {
  socket?.close();
  if (chrome && chrome.exitCode === null) {
    const closed = new Promise(resolve => chrome.once('exit', resolve));
    chrome.kill();
    await Promise.race([closed, new Promise(resolve => setTimeout(resolve, 3000))]);
  }
  await new Promise(resolve => server.close(resolve));
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
