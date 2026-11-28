// Offline: node tools/test-wordlab-integration.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const read = file => readFile(new URL(file, root), 'utf8');
const page = await read('public/member-works/wordlab/WordLab.html');
const features = await read('public/club-features.html');
const manifest = JSON.parse(await read('public/member-works/wordlab/manifest.webmanifest'));
assert.match(features, /href="member-works\/wordlab\/WordLab\.html"/);
// Never pass the page or credential-bearing values to assertions: failures must not print them.
assert.ok(/href="\.\.\/\.\.\/\.\.\/index\.html"[^>]*>← 返回社团主页<\/a>/.test(page));
assert.ok(!/<(?:script|link)\b[^>]*(?:src|href)="[^"\n]*(?:club-shell|club-ui|theme\.js|i18n\.js)/.test(page));
assert.ok(page.includes('body.wl-role-teacher #quickbar a[href="../../../index.html"]{display:inline-flex!important}'), 'teacher role restrictions retain the club homepage link');
assert.ok(!/var KEYB = '[A-Za-z0-9+/=]{20,}'/.test(page));
assert.equal(manifest.start_url, './WordLab.html');
assert.equal(manifest.scope, './');
for (const icon of manifest.icons) {
  assert.ok((await readFile(new URL(`public/member-works/wordlab/${icon.src}`, root))).length > 0);
}
let scripts = 0;
for (const match of page.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
  if (/\bsrc=/.test(match[1])) continue;
  try {
    new vm.Script(match[2], { filename: `WordLab-inline-${++scripts}` });
  } catch {
    throw new Error(`WordLab inline script ${scripts} failed to compile`);
  }
}
assert.ok(scripts >= 2, 'compile the original inline application without executing it');

const defaultsSource = page.slice(page.indexOf('/* ===== ng-defaults.js ===== */'), page.indexOf('/* ===== ng-sitecfg.js ===== */'));
assert.ok(defaultsSource.length > 0, 'updated member defaults are present');
assert.ok(/<meta name="wordlab-source" content="1128-3f7162c9f237caf4">/.test(page));
assert.ok(!/(?:["']wordlab_aiKey["']|\bwordlab_aiKey)\s*:\s*["'][^"']+/.test(defaultsSource), 'factory settings contain no default AI key');
function defaults(initial = {}, session = new Map()) {
  const data = new Map(Object.entries(initial)), reloads = [];
  const storage = map => ({
    get length() { return map.size; },
    key: i => [...map.keys()][i] ?? null,
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: key => map.delete(key),
    clear: () => map.clear()
  });
  const window = { localStorage: storage(data) };
  vm.runInNewContext(defaultsSource, {
    window, sessionStorage: storage(session),
    location: { href: 'https://example.test/club/public/member-works/wordlab/WordLab.html', replace: url => reloads.push(url) }
  });
  return { data, session, reloads, window, get storage() { return window.localStorage; } };
}
const fresh = defaults();
const bundledWords = JSON.parse(fresh.data.get('wordlab_v1'));
assert.equal(bundledWords.length, 1269, 'new member vocabulary is seeded');
assert.equal(fresh.reloads.length, 1, 'one reload makes defaults available to the original app');
assert.ok(fresh.storage.getItem('wordlab_aiKey') === null);
assert.equal(fresh.window.DEFAULTS.isLocked('wordlab_aiKey'), false);
assert.equal(fresh.window.DEFAULTS.isLocked('wordlab_aiUrl'), false);
assert.equal(fresh.storage.getItem('wordlab_aiUrl'), 'https://api.deepseek.com/chat/completions');
assert.equal(fresh.window.DEFAULTS.isLocked('wordlab_perf'), true, 'retain original non-AI setting defaults');

const learned = { ...bundledWords[0], m: '个人释义', box: 4, c: 12, wrong: 2 };
const custom = { w: 'my-own-word', lang: 'en', unit: '我的单元', box: 3, c: 8 };
const prior = {
  wordlab_v1: JSON.stringify([learned, custom]),
  wordlab_log: '[{"n":8}]', wordlab_streak: '7',
  wordlab_aiKey: 'personal-test-value',
  wordlab_aiUrl: 'https://personal.example.test/v1/chat/completions',
  wordlab_aiModel: 'personal-model', wordlab_aiVision: 'vision',
  wordlab_sitecfg_cache: JSON.stringify({
    settings: { wordlab_aiKey: 'discard-settings-value', wordlab_perf: 'full' },
    ai: { key: 'discard-cached-value', url: 'https://site.example.test/v1/chat/completions', model: 'site-model' }
  })
};
const migrated = defaults(prior);
const mergedWords = JSON.parse(migrated.data.get('wordlab_v1'));
assert.equal(mergedWords.length, bundledWords.length + 1);
assert.deepEqual(mergedWords.find(w => w.w === learned.w && w.unit === learned.unit), learned, 'keep learned entry, meaning and progress');
assert.deepEqual(mergedWords.find(w => w.w === custom.w), custom, 'keep personal vocabulary');
assert.equal(migrated.data.get('wordlab_log'), prior.wordlab_log);
assert.equal(migrated.data.get('wordlab_streak'), prior.wordlab_streak);
for (const key of ['wordlab_aiKey', 'wordlab_aiUrl', 'wordlab_aiModel', 'wordlab_aiVision']) {
  assert.ok(migrated.storage.getItem(key) === prior[key], 'cached site defaults do not override personal AI settings');
  migrated.storage.setItem(key, 'saved-personal-value');
  assert.ok(migrated.storage.getItem(key) === 'saved-personal-value', 'personal AI settings remain writable');
}
migrated.storage.removeItem('wordlab_aiKey');
assert.ok(migrated.storage.getItem('wordlab_aiKey') === null, 'clear key remains effective');
migrated.window.DEFAULTS.applyRemote({ settings: { wordlab_aiKey: 'discard-remote-value' }, ai: { key: 'discard-ai-value', model: 'new-site-model' } });
assert.ok(migrated.storage.getItem('wordlab_aiKey') === null, 'remote config cannot insert a default key');
const sanitized = JSON.parse(migrated.data.get('wordlab_sitecfg_cache'));
assert.equal(Object.hasOwn(sanitized.settings, 'wordlab_aiKey'), false);
assert.equal(Object.hasOwn(sanitized.ai, 'key'), false, 'remote credentials are not cached');
const restored = defaults(Object.fromEntries(migrated.data), migrated.session);
assert.equal(restored.data.get('wordlab_v1'), migrated.data.get('wordlab_v1'), 'reload does not duplicate vocabulary');
assert.equal(restored.reloads.length, 0, 'completed migration does not reload again');
const updated = defaults({
  ...Object.fromEntries(migrated.data), wordlab_pwdhash: 'existing-password-hash'
});
assert.equal(updated.data.get('wordlab_v1'), migrated.data.get('wordlab_v1'), '1128 retains the existing vocabulary migration marker');
assert.equal(updated.data.get('wordlab_pwdhash'), 'existing-password-hash', '1128 does not repeat factory password clearing');
assert.equal(updated.reloads.length, 0, '1128 does not require a new defaults reload');
const corrupt = defaults({ wordlab_v1: '{incomplete', wordlab_log: prior.wordlab_log });
assert.equal(corrupt.data.get('wordlab_v1'), '{incomplete', 'invalid existing vocabulary remains recoverable');
assert.equal(corrupt.data.get('wordlab_log'), prior.wordlab_log);
const noKeyCache = defaults({ wordlab_sitecfg_cache: prior.wordlab_sitecfg_cache });
assert.ok(noKeyCache.storage.getItem('wordlab_aiKey') === null, 'cached default key is ignored without a personal key');
assert.equal(noKeyCache.storage.getItem('wordlab_aiUrl'), 'https://site.example.test/v1/chat/completions', 'credential-free remote AI defaults still apply');

// Execute only the isolated configuration module and the two native AI panels.
// The fake fetch never performs network I/O and captured credentials are checked only as booleans.
function between(start, end) {
  const a = page.indexOf(start), b = page.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, 'required WordLab AI section exists');
  return page.slice(a, b);
}
const configSource = between('/* ===== wordlab-ai-config.js ===== */', '/* ===== wordlab-ai-config-end ===== */');
const mainAISource = between('function aiCfgGet()', 'function aiImgPick(');
const panelSource = between('/* ===== ng-ai.js ===== */', '/* ===== ng-chat.js ===== */');
function aiHarness(initial = {}) {
  const data = new Map(Object.entries(initial)), elements = new Map(), listeners = new Map(), requests = [];
  const localStorage = {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: key => data.delete(key)
  };
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      id, value: '', textContent: '', innerHTML: '', placeholder: '', style: {}, disabled: false,
      classList: { contains: () => false, toggle() {}, remove() {}, add() {} },
      appendChild(node) { if (node.id) elements.set(node.id, node); },
      insertBefore() {}, querySelector() { return null; }, focus() {}
    });
    return elements.get(id);
  }
  const document = {
    readyState: 'loading',
    getElementById(id) { return id === 'aiCard' && !elements.has(id) ? null : element(id); },
    createElement() { return element(`created-${elements.size}`); },
    querySelector() { return null; }, addEventListener() {}
  };
  const context = {
    localStorage, document, URL, AbortController,
    setTimeout() { return 1; }, clearTimeout() {}, setInterval() { return 1; },
    Event: class Event { constructor(type) { this.type = type; } },
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); },
    dispatchEvent(event) { for (const fn of listeners.get(event.type) || []) fn(event); },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: 'ok' } }] }) };
    },
    $: element, toast() {}, esc: value => String(value)
  };
  context.window = context;
  vm.createContext(context);
  try {
    vm.runInContext(configSource, context, { filename: 'WordLab-ai-config' });
    vm.runInContext(mainAISource, context, { filename: 'WordLab-main-ai' });
    vm.runInContext(panelSource, context, { filename: 'WordLab-ai-panel' });
  } catch {
    throw new Error('WordLab AI test fixture failed to initialize');
  }
  return { data, element, requests, context, ai: context.WordLabAI };
}

const defaultURL = 'https://api.deepseek.com/chat/completions', defaultModel = 'deepseek-chat';
const legacyURL = 'https://legacy.example.test/v1/chat/completions';
const aiTest = aiHarness({ wordlab_aiUrl: legacyURL, wordlab_aiModel: 'legacy-model', wordlab_aiVision: 'vision' });
const initialAI = aiTest.ai.cfg();
assert.ok(initialAI.url === defaultURL, 'old URL without a personal key cannot receive the default credential');
assert.ok(initialAI.model === defaultModel);
assert.ok(initialAI.vision === 'auto');
assert.ok(initialAI.builtin && typeof initialAI.key === 'string' && initialAI.key.trim().length > 0, 'default credential exists');
assert.ok(!aiTest.data.has('wordlab_aiKey'), 'default credential is never seeded to storage');
assert.ok(aiTest.context.aiCfgGet().key === initialAI.key && aiTest.context.AIP.cfg().key === initialAI.key, 'both panels resolve the same default key');
assert.ok(aiTest.context.aiCfgGet().url === initialAI.url && aiTest.context.aiCfgGet().model === initialAI.model);
assert.ok(aiTest.context.AIP.cfg().url === initialAI.url && aiTest.context.AIP.cfg().model === initialAI.model);
aiTest.context.aiCfgFields();
assert.ok(aiTest.element('aiKey').value === '', 'main panel does not reveal the default key');
await aiTest.context.aiCfgTest();
await aiTest.context.AIP.call([{ role: 'user', content: 'test' }]);
assert.equal(aiTest.requests.length, 2);
for (const request of aiTest.requests) {
  assert.ok(request.url === defaultURL);
  assert.ok(JSON.parse(request.options.body).model === defaultModel);
  assert.ok(request.options.headers.Authorization === `Bearer ${initialAI.key}`, 'request uses the paired default key');
}
for (const [url, model, key] of [[legacyURL, defaultModel, ''], [defaultURL, 'other-model', ''], [legacyURL, defaultModel, initialAI.key]]) {
  const before = JSON.stringify([...aiTest.data]);
  let rejected = false;
  try { aiTest.ai.setCfg(url, key, model); } catch { rejected = true; }
  assert.ok(rejected, 'incompatible default-key pairing is rejected');
  assert.ok(JSON.stringify([...aiTest.data]) === before, 'rejected settings do not write anything');
}

const personalKey = 'personal-local-test-value';
aiTest.ai.setCfg('https://personal.example.test/v1', personalKey, 'personal-model');
let currentAI = aiTest.ai.cfg();
assert.ok(currentAI.url === 'https://personal.example.test/v1/chat/completions');
assert.ok(currentAI.model === 'personal-model');
assert.ok(currentAI.vision === 'vision');
assert.ok(!currentAI.builtin && currentAI.key === personalKey && aiTest.data.get('wordlab_aiKey') === personalKey, 'personal key wins');
assert.ok(aiTest.context.aiCfgGet().key === personalKey && aiTest.context.AIP.cfg().key === personalKey, 'both panels use personal key');
await aiTest.context.AIP.call([{ role: 'user', content: 'test' }]);
assert.ok(aiTest.requests[2].url === currentAI.url);
assert.ok(aiTest.requests[2].options.headers.Authorization === `Bearer ${personalKey}`);

// Exercise the real card handlers with a minimal DOM, including masked saves.
aiTest.context.AIP.card();
const panelKey = aiTest.element('aiCkey');
assert.ok(panelKey.value !== personalKey && panelKey.value.length > 0, 'personal key is masked');
aiTest.element('aiSave').onclick();
assert.ok(aiTest.data.get('wordlab_aiKey') === personalKey, 'saving a hidden key keeps the personal key');
aiTest.element('aiDefault').onclick();
assert.ok(aiTest.data.get('wordlab_aiKey') === personalKey, 'DeepSeek default button does not store the mask');
assert.equal(aiTest.ai.cfg().url, defaultURL);
assert.equal(aiTest.ai.cfg().model, defaultModel);
aiTest.element('aiReset').onclick();
currentAI = aiTest.ai.cfg();
assert.ok(currentAI.builtin && currentAI.key === initialAI.key && !aiTest.data.has('wordlab_aiKey'), 'reset restores default without persisting it');
assert.ok(aiTest.context.aiCfgGet().key === initialAI.key && aiTest.context.AIP.cfg().key === initialAI.key);
assert.ok(aiTest.element('aiKey').value === '' && aiTest.element('aiCkey').value === '', 'both panels hide the default key');
aiTest.element('aiSave').onclick();
assert.ok(!aiTest.data.has('wordlab_aiKey'), 'saving defaults does not store their key');

function worker(source, scope, cacheNames, offline = false) {
  const handlers = new Map(), deleted = [], stored = [], fetched = [];
  const fallback = new Response('cached WordLab');
  const cache = {
    addAll: async () => {},
    put: async (request, response) => { stored.push(request.url); },
    match: async () => fallback
  };
  const context = {
    URL, Response,
    caches: {
      keys: async () => cacheNames,
      delete: async key => { deleted.push(key); return true; },
      open: async () => cache,
      match: async () => fallback
    },
    fetch: async request => {
      fetched.push(request.url);
      if (offline) throw new Error('offline');
      return new Response('online');
    },
    self: {
      registration: { scope },
      location: { origin: new URL(scope).origin },
      addEventListener: (type, listener) => handlers.set(type, listener),
      skipWaiting: async () => {},
      clients: { claim: async () => {} }
    }
  };
  vm.runInNewContext(source, context);
  return {
    deleted, stored, fetched, fallback,
    async activate() {
      let pending;
      handlers.get('activate')({ waitUntil: promise => { pending = promise; } });
      await pending;
    },
    async request(url, options) {
      const tasks = [];
      let response;
      handlers.get('fetch')({
        request: new Request(url, options),
        waitUntil: promise => tasks.push(promise),
        respondWith: promise => { response = promise; }
      });
      const result = await response;
      await Promise.all(tasks);
      return result;
    }
  };
}

// Use a project-site prefix: navigation and cache isolation must not assume a domain root.
const scope = 'https://example.test/SIA-algorithm-club-site/public/member-works/wordlab/';
const prefix = `wordlab-${scope}-`;
const wordlabSource = await read('public/member-works/wordlab/sw.js');
const cacheNames = ['club-shell-old', 'club-runtime-old', 'unrelated-app', 'wordlab-v2', `${prefix}v1`, `${prefix}v2`, `${prefix}v3`, `${prefix}v4`, `${prefix}v5`, `${prefix}v6`];
const app = worker(wordlabSource, scope, cacheNames);
await app.activate();
assert.deepEqual(app.deleted, [`${prefix}v1`, `${prefix}v2`, `${prefix}v3`, `${prefix}v4`, `${prefix}v5`], 'WordLab deletes only its own obsolete caches');
for (const file of ['WordLab.html', 'manifest.webmanifest', 'pwa/icon-192.png', 'pwa/icon-512.png']) {
  assert.equal(await (await app.request(scope + file)).text(), 'online');
}
assert.equal(app.stored.length, 4);
for (const [url, options] of [
  [new URL('../../../index.html', scope).href],
  [scope + 'api/private.json'],
  [scope + 'WordLab.html?token=private'],
  [scope + 'WordLab.html', { headers: { authorization: 'Bearer test' } }],
  [scope + 'WordLab.html', { method: 'POST' }],
  ['https://api.example.test/chat/completions']
]) {
  assert.equal(await app.request(url, options), undefined, 'non-shell/private requests bypass the worker');
}
assert.equal(app.fetched.length, 4, 'bypassed requests were not fetched or cached by WordLab');
const offline = worker(wordlabSource, scope, cacheNames, true);
assert.equal(await (await offline.request(scope + 'WordLab.html')).text(), 'cached WordLab');

const clubSource = await read('public/sw.js');
const version = clubSource.match(/const VERSION = '([^']+)'/)[1];
const club = worker(clubSource, 'https://example.test/SIA-algorithm-club-site/', [
  ...cacheNames, `club-shell-${version}`, `club-runtime-${version}`
]);
await club.activate();
assert.deepEqual(club.deleted, ['club-shell-old', 'club-runtime-old'], 'club updates retain member-work caches');

// The portal is followed by the 1128 admin and log modules. Execute only its own IIFE
// in a fake browser with a fake fetch: no network, credentials or real storage.
const portalStart = page.indexOf('/* ===== ng-portal.js ===== */');
const portalEnd = page.indexOf('/* ===== ng-admin.js ===== */', portalStart);
assert.ok(portalStart >= 0 && portalEnd > portalStart, 'WordLab 1128 portal and admin module boundaries are present');
const portalSource = page.slice(portalStart, portalEnd);
assert.ok(/function cloudGet\(\)/.test(portalSource) && /function cloudPut\(state\)/.test(portalSource), 'portal cloud helpers are present');
assert.ok(!/api\.cloudflare\.com|\/accounts\/|\/namespaces?\/|\/tokens?\b/i.test(portalSource), 'portal has no Cloudflare account/namespace/token endpoint');
const portalClose = portalSource.lastIndexOf('})();');
assert.ok(portalClose > 0 && portalSource.slice(portalClose).trim() === '})();', 'portal IIFE boundary is present at the end of the module');
const portalSeam = [
  '  window.__wordlabPortalTest = {',
  '    cloudGet: cloudGet, cloudPut: cloudPut, loadState: loadState, saveAll: saveAll,',
  '    parseWords: parseWords, state: function () { return STATE; },',
  '    setState: function (s) { STATE = s; }, setSession: function (s) { SESSION = s; },',
  '    setCurrent: function (node) { CUR = node; }, canDrop: canDrop, doMove: doMove,',
  '    subWords: subWords, subWordsRaw: subWordsRaw, guardGo: guardGo,',
  '    toStudent: toStudent, toTeacher: toTeacher, importToTarget: importToTarget, aiTarget: aiTargetNode',
  '  };'
].join('\n');
const portalExecutable = `${portalSource.slice(0, portalClose)}${portalSeam}\n${portalSource.slice(portalClose)}`;
const portalRequests = [];
const isPut = request => Boolean(request.options && request.options.method === 'PUT');
function portalHarness(initial = {}) {
  const data = new Map(Object.entries(initial)), session = new Map();
  const requests = [], toasts = [], timers = new Map(), cleared = [], routes = [];
  let nextTimer = 0;
  let respond = () => Promise.resolve({ ok: true, json: async () => null });
  const storage = map => ({
    get length() { return map.size; },
    key: index => [...map.keys()][index] ?? null,
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: key => map.delete(key),
    clear: () => map.clear()
  });
  const classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
  const document = {
    readyState: 'loading',
    addEventListener() {},
    getElementById() { return null; },
    querySelector() { return null; },
    createElement() { return { style: {}, classList, appendChild() {} }; },
    body: { classList, appendChild() {} },
    head: { appendChild() {} }
  };
  const context = {
    localStorage: storage(data), sessionStorage: storage(session), document,
    AbortController, console: { log() {}, warn() {}, error() {} },
    location: { href: 'https://example.test/club/public/member-works/wordlab/WordLab.html', reload() {} },
    fetch(url, options) {
      const request = { url, options };
      requests.push(request);
      portalRequests.push(request);
      return respond(request);
    },
    setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, { id, fn, delay }); return id; },
    clearTimeout(id) { cleared.push(id); timers.delete(id); },
    toast(message) { toasts.push(String(message)); },
    go(page) { routes.push(page); return page; },
    esc(value) { return String(value); }
  };
  context.window = context;
  vm.createContext(context);
  try {
    vm.runInContext(portalExecutable, context, { filename: 'WordLab-portal' });
  } catch {
    throw new Error('WordLab portal test fixture failed to initialize');
  }
  const test = context.__wordlabPortalTest;
  assert.ok(test && typeof test.cloudGet === 'function' && typeof test.saveAll === 'function', 'portal test seam is available');
  return {
    data, requests, toasts, timers, cleared, routes, test, context,
    respond(fn) { respond = fn; },
    cached() {
      const value = data.get('wordlab_cloud_cache');
      return value == null ? null : JSON.parse(value);
    },
    state() { return JSON.parse(JSON.stringify(test.state())); }
  };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const okJSON = value => ({ ok: true, json: async () => value });
const cloudCourse = {
  v: 2, updated: '2026-01-02T03:04:05Z', auth: { t: '1111', s: '2222' },
  tree: [{ n: '英语', children: [{ n: '高一', children: [{ n: '上学期', children: [
    { n: '第1课', words: [{ w: 'cloud', ph: '', pos: 'n.', m: '云', ex: '', exZh: '' }] }
  ] }] }] }]
};

// Reads: 8 second abort, no-store, failure tolerated as empty.
const cloudRead = portalHarness();
const readDeferred = deferred();
cloudRead.respond(() => readDeferred.promise);
const readPromise = cloudRead.test.cloudGet();
assert.equal(cloudRead.requests.length, 1, 'cloud read issues one GET');
const readRequest = cloudRead.requests[0];
assert.ok(readRequest.url.startsWith('https://wordlab-api.pages.dev/api/state?t='), 'cloud read uses the course API');
assert.ok(!readRequest.options.method || readRequest.options.method === 'GET');
assert.equal(readRequest.options.cache, 'no-store');
const readTimer = [...cloudRead.timers.values()].find(timer => timer.delay === 8000);
assert.ok(readTimer, 'cloud read uses an 8s abort timer');
assert.equal(readRequest.options.signal.aborted, false);
readTimer.fn();
assert.equal(readRequest.options.signal.aborted, true, 'cloud read aborts at 8s');
readDeferred.resolve(okJSON(cloudCourse));
assert.equal((await readPromise).tree[0].n, '英语');
assert.ok(cloudRead.cleared.includes(readTimer.id), 'cloud read clears its abort timer');
const readFailure = portalHarness();
readFailure.respond(() => Promise.reject(new Error('offline')));
const readFailurePromise = readFailure.test.cloudGet();
const readFailureTimer = [...readFailure.timers.values()].find(timer => timer.delay === 8000);
assert.ok(readFailureTimer, 'failed cloud read starts an 8s abort timer');
assert.equal(await readFailurePromise, null, 'cloud read failure resolves empty');
assert.ok(readFailure.cleared.includes(readFailureTimer.id), 'failed cloud read clears its abort timer');
const readHTTPError = portalHarness();
readHTTPError.respond(() => Promise.resolve({ ok: false }));
assert.equal(await readHTTPError.test.cloudGet(), null, 'cloud read HTTP error resolves empty');

// Writes: 15 second abort and a plain-text JSON body.
const cloudWrite = portalHarness();
const writeDeferred = deferred();
cloudWrite.respond(() => writeDeferred.promise);
const writePromise = cloudWrite.test.cloudPut({ v: 2, auth: { t: '0000', s: '0000' }, tree: [] });
const writeRequest = cloudWrite.requests[0];
assert.equal(writeRequest.options.method, 'PUT');
assert.equal(writeRequest.options.headers['content-type'], 'text/plain');
assert.equal(JSON.parse(writeRequest.options.body).v, 2);
const writeTimer = [...cloudWrite.timers.values()].find(timer => timer.delay === 15000);
assert.ok(writeTimer, 'cloud write uses a 15s abort timer');
writeTimer.fn();
assert.equal(writeRequest.options.signal.aborted, true, 'cloud write aborts at 15s');
writeDeferred.resolve({ ok: true });
assert.equal(await writePromise, true);
assert.ok(cloudWrite.cleared.includes(writeTimer.id), 'cloud write clears its abort timer');

// Startup: valid cloud state loads; failure or empty cloud prefers cached courses; no cache
// migrates the local vocabulary; a teacher startup still never writes.
const cloudLoad = portalHarness();
cloudLoad.test.setSession({ role: 'teacher', user: 'teacher' });
cloudLoad.respond(() => Promise.resolve(okJSON(cloudCourse)));
await cloudLoad.test.loadState();
assert.deepEqual(cloudLoad.state(), cloudCourse, 'valid cloud courses load unchanged');
assert.deepEqual(cloudLoad.cached(), cloudCourse, 'loaded cloud courses are cached locally');
assert.equal(cloudLoad.requests.filter(isPut).length, 0, 'teacher startup reads but never writes the cloud');

const cachedCourses = {
  v: 2, updated: '2025-12-31T00:00:00Z', auth: { t: 'aaaa', s: 'bbbb' },
  tree: [{ n: '英语', children: [{ n: '高二', children: [{ n: '下学期', children: [
    { n: '缓存课', words: [{ w: 'cached', ph: '', pos: '', m: '缓存', ex: '', exZh: '' }] }
  ] }] }] }]
};
const cacheFallback = portalHarness({ wordlab_cloud_cache: JSON.stringify(cachedCourses) });
cacheFallback.respond(() => Promise.reject(new Error('offline')));
await cacheFallback.test.loadState();
assert.deepEqual(cacheFallback.state(), cachedCourses, 'cloud read failure prefers cached courses');
assert.equal(cacheFallback.requests.filter(isPut).length, 0, 'cached fallback never uploads on startup');
const emptyFallback = portalHarness({ wordlab_cloud_cache: JSON.stringify(cachedCourses) });
emptyFallback.respond(() => Promise.resolve(okJSON(null)));
await emptyFallback.test.loadState();
assert.deepEqual(emptyFallback.state(), cachedCourses, 'empty cloud state prefers cached courses');
assert.equal(emptyFallback.requests.filter(isPut).length, 0, 'empty fallback never uploads on startup');

const localWords = [
  { w: 'apple', ph: '/a/', pos: 'n.', m: '苹果', ex: 'An apple.', exZh: '一个苹果。', unit: 'Unit 1', box: 4 },
  { w: 'banana', ph: '', pos: 'n.', m: '香蕉', unit: 'Unit 1' },
  { w: 'cherry', m: '樱桃' }
];
const migrate = portalHarness({ wordlab_v1: JSON.stringify(localWords) });
migrate.respond(() => Promise.reject(new Error('offline')));
await migrate.test.loadState();
const migratedCourses = migrate.state();
assert.equal(migratedCourses.v, 2);
const migratedUnits = migratedCourses.tree[0].children[0].children[0].children;
assert.deepEqual(migratedUnits.map(unit => unit.n).sort(), ['Unit 1', '未分类']);
assert.deepEqual(migratedUnits.find(unit => unit.n === 'Unit 1').words, [
  { w: 'apple', ph: '/a/', pos: 'n.', m: '苹果', ex: 'An apple.', exZh: '一个苹果。' },
  { w: 'banana', ph: '', pos: 'n.', m: '香蕉', ex: '', exZh: '' }
]);
assert.deepEqual(migratedUnits.find(unit => unit.n === '未分类').words, [
  { w: 'cherry', ph: '', pos: '', m: '樱桃', ex: '', exZh: '' }
]);
assert.deepEqual(migrate.cached(), migratedCourses, 'local migration is cached for offline use');
assert.equal(migrate.data.get('wordlab_v1'), JSON.stringify(localWords), 'migration does not rewrite the practice vocabulary');
assert.equal(migrate.requests.filter(isPut).length, 0, 'local migration never uploads on startup');

// Saving: students cannot write; teachers explicitly save. HTTP and network failures must
// return false, show a failure toast, never a success toast, and keep the local cache.
const student = portalHarness();
student.test.setState({ v: 2, updated: '2026-01-01T00:00:00Z', auth: { t: '0000', s: '0000' }, tree: [{ n: '英语', children: [] }] });
student.test.setSession({ role: 'student', user: 'student' });
const studentBefore = student.requests.length;
assert.equal(await student.test.saveAll(), undefined, 'students cannot save');
assert.equal(student.requests.length, studentBefore, 'student save makes no request');
assert.deepEqual(student.toasts, [], 'student save shows no toast');

const teacherState = {
  v: 2, updated: '2026-01-01T00:00:00Z', auth: { t: 'teacher-pass', s: 'student-pass' },
  tree: [{ n: '英语', children: [{ n: '高一', children: [{ n: '上学期', children: [
    { n: '第1课', words: [{ w: 'one', ph: '', pos: '', m: '一', ex: '', exZh: '' }] }
  ] }] }] }]
};
const teacherUpload = JSON.parse(JSON.stringify(teacherState));
const teacher = portalHarness();
teacher.test.setState(teacherState);
teacher.test.setSession({ role: 'teacher', user: 'teacher' });
teacher.respond(request => {
  assert.equal(request.options.method, 'PUT');
  return Promise.resolve({ ok: true });
});
const teacherBefore = teacher.requests.length;
const teacherSave = teacher.test.saveAll();
const teacherTimer = [...teacher.timers.values()].find(timer => timer.delay === 15000);
assert.ok(teacherTimer, 'teacher save uses a 15s write timer');
assert.equal(await teacherSave, true, 'teacher explicit save succeeds');
assert.equal(teacher.requests.length, teacherBefore + 1);
const teacherRequest = teacher.requests[teacherBefore];
assert.equal(teacherRequest.options.method, 'PUT');
const teacherBody = JSON.parse(teacherRequest.options.body);
assert.deepEqual(teacherBody.tree, teacherUpload.tree, 'save uploads the current course tree');
assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(teacherBody.updated), 'save updates the timestamp');
assert.deepEqual(teacher.cached(), teacherBody, 'successful save caches the uploaded courses');
assert.ok(teacher.toasts.some(message => message.includes('已保存到云端')), 'successful save shows the success toast');
assert.ok(!teacher.toasts.some(message => message.includes('云端保存失败')), 'successful save has no failure toast');
assert.ok(teacher.cleared.includes(teacherTimer.id), 'teacher save clears its write timer');

function teacherSaveFailure(respond) {
  const harness = portalHarness();
  harness.test.setState({
    v: 2, updated: '2026-01-01T00:00:00Z', auth: { t: '0000', s: '0000' },
    tree: [{ n: '英语', children: [{ n: '高一', children: [{ n: '上学期', children: [
      { n: '第1课', words: [{ w: 'kept' }] }
    ] }] }] }]
  });
  harness.test.setSession({ role: 'teacher', user: 'teacher' });
  harness.respond(respond);
  return harness;
}
const rejectedSave = teacherSaveFailure(() => Promise.resolve({ ok: false }));
assert.equal(await rejectedSave.test.saveAll(), false, 'HTTP failure is reported as failure');
assert.ok(rejectedSave.toasts.some(message => message.includes('云端保存失败')), 'HTTP failure shows the failure toast');
assert.ok(!rejectedSave.toasts.some(message => message.includes('已保存到云端')), 'HTTP failure shows no success toast');
assert.deepEqual(rejectedSave.cached(), rejectedSave.state(), 'HTTP failure keeps the current courses cached');
const offlineSave = teacherSaveFailure(() => Promise.reject(new Error('offline')));
assert.equal(await offlineSave.test.saveAll(), false, 'network failure is reported as failure');
assert.ok(offlineSave.toasts.some(message => message.includes('云端保存失败')), 'network failure shows the failure toast');
assert.ok(!offlineSave.toasts.some(message => message.includes('已保存到云端')), 'network failure shows no success toast');
assert.deepEqual(offlineSave.cached(), offlineSave.state(), 'network failure keeps the current courses cached');

// All portal traffic stays on the course API; no Cloudflare account/namespace/token request.
assert.ok(portalRequests.length >= 8, 'portal cloud requests were exercised');
for (const request of portalRequests) {
  const url = new URL(request.url);
  assert.equal(url.origin, 'https://wordlab-api.pages.dev', 'portal stays on the course API host');
  assert.equal(url.pathname, '/api/state', 'portal stays on the course API path');
  const queryKeys = [...url.searchParams.keys()];
  assert.ok(!queryKeys.length || (queryKeys.length === 1 && queryKeys[0] === 't'), 'only the cache-busting timestamp query is used');
  assert.ok(!/cloudflare|account|namespace|token/i.test(request.url), 'no Cloudflare account/namespace/token request');
  const headers = request.options.headers || {};
  assert.ok(Object.keys(headers).every(key => key.toLowerCase() === 'content-type'), 'writes carry only a content type');
}

// The portal accepts the existing wordlab_v1 JSON and the author's wrapped word array.
const parseHarness = portalHarness();
const existingWord = { w: 'apple', ph: '/ˈæpəl/', pos: 'n.', m: '苹果', ex: 'An apple.', exZh: '一个苹果。' };
const parsedExisting = JSON.parse(JSON.stringify(parseHarness.test.parseWords(JSON.stringify([existingWord]))));
assert.deepEqual(parsedExisting, [existingWord], 'portal parseWords accepts the existing wordlab_v1 JSON array');
const parsedWrapped = JSON.parse(JSON.stringify(parseHarness.test.parseWords(JSON.stringify({ words: [{ word: 'banana', phonetic: '/b/', mean: '香蕉' }] }))));
assert.deepEqual(parsedWrapped, [{ w: 'banana', ph: '/b/', pos: '', m: '香蕉', ex: '', exZh: '' }], 'portal parseWords accepts a wrapped words array');
const [parsedBundled] = JSON.parse(JSON.stringify(parseHarness.test.parseWords(JSON.stringify([bundledWords[0]]))));
assert.equal(parsedBundled.w, bundledWords[0].w, 'existing bundled vocabulary parses through the portal');
assert.equal(parsedBundled.m, bundledWords[0].m || '', 'bundled vocabulary meanings are retained');

// An empty/malformed tree never authorizes a startup upload or replaces usable cached courses.
for (const tree of [[], {}, 'invalid']) {
  const fallback = portalHarness({ wordlab_cloud_cache: JSON.stringify(cachedCourses) });
  fallback.respond(() => Promise.resolve(okJSON({ tree })));
  await fallback.test.loadState();
  assert.deepEqual(fallback.state(), cachedCourses, 'invalid or empty cloud tree retains cached courses');
  assert.deepEqual(fallback.cached(), cachedCourses);
  assert.equal(fallback.requests.filter(isPut).length, 0, 'empty cloud tree never triggers an automatic seed upload');
}

// 1128: AI imports target only a selected teacher course, deduplicate case-insensitively,
// leave the practice vocabulary untouched, and remain local until an explicit save.
const courseImport = portalHarness({ wordlab_v1: JSON.stringify(localWords) });
const importState = JSON.parse(JSON.stringify(teacherState));
const targetCourse = importState.tree[0].children[0].children[0].children[0];
courseImport.test.setState(importState);
courseImport.test.setCurrent(targetCourse);
courseImport.test.setSession({ role: 'student', user: 'student' });
assert.equal(courseImport.test.aiTarget(), null, 'students have no teacher AI import target');
assert.equal(courseImport.test.importToTarget([{ w: 'two' }]).ok, false);
courseImport.test.setSession({ role: 'teacher', user: 'teacher' });
assert.equal(courseImport.test.aiTarget(), targetCourse);
const imported = JSON.parse(JSON.stringify(courseImport.test.importToTarget([
  { w: 'ONE', m: '重复' }, { w: 'two', m: '二', ex: 'Two words.', lang: 'en' },
  { w: 'TWO', m: '重复' }, { w: 'constructor', m: '构造者' }, null, { m: '无词形' }
])));
assert.equal(imported.ok, true);
assert.equal(imported.add, 2);
assert.equal(imported.skip, 2);
assert.equal(imported.name, targetCourse.n);
assert.equal(imported.path, '英语 / 高一 / 上学期 / 第1课');
assert.deepEqual(targetCourse.words.map(word => word.w), ['one', 'two', 'constructor']);
assert.equal(targetCourse.words[1].m, '二');
assert.equal(targetCourse.words[1].ex, 'Two words.');
assert.equal(courseImport.data.get('wordlab_v1'), JSON.stringify(localWords), 'course import does not replace existing practice progress');
assert.equal(courseImport.requests.length, 0, 'course import does not write to the cloud');
courseImport.test.setCurrent(importState.tree[0]);
assert.equal(courseImport.test.aiTarget(), null, 'a subject cannot be used as a leaf course target');
courseImport.test.setCurrent(null);
assert.equal(courseImport.test.importToTarget([{ w: 'three' }]).ok, false, 'no selected course means no teacher import');

// Role restrictions and quick switching never write courses or replace learning data.
const roles = portalHarness({ wordlab_v1: JSON.stringify(localWords) });
roles.test.setState(JSON.parse(JSON.stringify(teacherState)));
roles.test.guardGo();
roles.test.setSession({ role: 'student', user: 'learner' });
assert.equal(roles.context.go('bank'), 'home', 'student navigation cannot open the teacher bank');
assert.equal(roles.context.go('flash'), 'flash', 'student practice remains accessible');
roles.test.setSession({ role: 'teacher', user: 'teacher' });
assert.equal(roles.context.go('flash'), 'bank', 'teacher navigation stays in the course editor');
assert.equal(roles.context.go('acct'), 'acct', 'teacher account route is retained');
roles.test.toStudent();
assert.equal(roles.context.PORTAL.session().role, 'student');
assert.equal(roles.routes.at(-1), 'home');
roles.test.toTeacher();
assert.equal(roles.context.PORTAL.session().role, 'teacher');
assert.equal(roles.routes.at(-1), 'bank');
assert.equal(roles.data.get('wordlab_v1'), JSON.stringify(localWords), 'role switching retains the active vocabulary');
assert.equal(roles.requests.length, 0, 'role switching is local');

// Point-and-click moves share the drag operation, preserve the four-level hierarchy,
// refuse cycles/same-depth destinations, and never silently persist remotely.
const moving = portalHarness();
const movedLesson = { n: '待移动课程', words: [{ w: 'shared', m: '相同' }, { w: 'shared', m: '相同' }] };
const retainedLesson = { n: '保留课程', words: [{ w: 'other', m: '其它' }] };
const movingState = { tree: [
  { n: '原学科', children: [{ n: '原年级', children: [{ n: '原学期', children: [movedLesson, retainedLesson] }] }] },
  { n: '目标学科', children: [] }
] };
(function stamp(nodes, depth) {
  for (const node of nodes) { node.__d = depth; stamp(node.children || [], depth + 1); }
})(movingState.tree, 0);
moving.test.setState(movingState);
const sourceSubject = movingState.tree[0], destination = movingState.tree[1];
assert.equal(moving.test.subWordsRaw(sourceSubject), 3, 'tree labels retain the raw word count');
assert.equal(moving.test.subWords(sourceSubject).length, 2, 'practice can still deduplicate identical words');
assert.equal(moving.test.canDrop(sourceSubject, sourceSubject), false);
assert.equal(moving.test.canDrop(movedLesson, sourceSubject), false, 'cannot move an ancestor into its descendant');
assert.equal(moving.test.canDrop(retainedLesson, movedLesson), false, 'a course cannot contain another course');
assert.equal(moving.test.canDrop(destination, sourceSubject), false, 'subjects cannot be nested');
assert.equal(moving.test.canDrop(destination, movedLesson), true);
assert.equal(moving.test.doMove(movedLesson, destination), true);
assert.deepEqual(sourceSubject.children[0].children[0].children, [retainedLesson]);
assert.equal(destination.children[0].children[0].children[0], movedLesson, 'moving across subjects fills missing grade/term levels');
assert.equal(moving.test.subWordsRaw(destination), 2);
assert.equal(moving.requests.length, 0, 'moving courses requires a separate explicit cloud save');

// 1128 admin/log regression: all network operations stay inside this offline VM.
const adminSource = between('/* ===== ng-admin.js ===== */', '/* ===== ng-log.js ===== */');
const logSource = page.slice(page.indexOf('/* ===== ng-log.js ===== */'), page.lastIndexOf('</script>'));
assert.ok(!/\/api\/balance|function aiKey\(|getItem\(['"]wordlab_aiKey/.test(adminSource), 'admin never forwards API credentials to the course service');
assert.ok(!/API \+ '\/api\/log/.test(adminSource), 'admin log URLs are not nested under the state endpoint');
assert.ok(/var API_LOG = 'https:\/\/wordlab-api\.pages\.dev\/api\/log'/.test(adminSource));
const adminClose = adminSource.lastIndexOf('})();');
const adminSeam = 'window.__adminTest = { pullCfg: pullCfg, pushCfg: pushCfg, hookCloudSave: hookCloudSave, countTree: countTree };\n';
function adminLogHarness(initial = {}) {
  class Storage {
    constructor(values = {}) { this.data = new Map(Object.entries(values)); }
    getItem(key) { return this.data.get(key) ?? null; }
    setItem(key, value) { this.data.set(key, String(value)); }
    removeItem(key) { this.data.delete(key); }
  }
  const localStorage = new Storage(initial), sessionStorage = new Storage();
  const requests = [], beacons = [], intervals = [], timeouts = [], routes = [];
  const events = new Map(), docEvents = new Map();
  let respond = () => Promise.resolve(okJSON(null));
  let saveResult = true;
  const listen = (map, name, fn) => map.set(name, [...(map.get(name) || []), fn]);
  const context = {
    Storage, localStorage, sessionStorage, Blob, console: { log() {}, warn() {}, error() {} },
    document: {
      readyState: 'loading', visibilityState: 'visible', hidden: false,
      getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; },
      addEventListener(name, fn) { listen(docEvents, name, fn); }
    },
    navigator: {
      userAgent: 'SyntheticBrowser', platform: 'SyntheticOS', language: 'zh-CN',
      onLine: true, hardwareConcurrency: 2, connection: { effectiveType: '4g', downlink: 1, rtt: 20 },
      sendBeacon(url, body) { beacons.push({ url, body }); return true; }
    },
    screen: { width: 1280, height: 720 }, devicePixelRatio: 1,
    location: { pathname: '/club/public/member-works/wordlab/WordLab.html' },
    matchMedia() { return { matches: false }; },
    go(route) { routes.push(route); return route; },
    addEventListener(name, fn) { listen(events, name, fn); },
    setInterval(fn, delay) { intervals.push({ fn, delay }); return intervals.length; },
    clearInterval() {}, setTimeout(fn, delay) { timeouts.push({ fn, delay }); return timeouts.length; }, clearTimeout() {},
    fetch(url, options = {}) { const request = { url, options }; requests.push(request); return respond(request); },
    PORTAL: { state: () => teacherState, save: () => saveResult === undefined ? undefined : Promise.resolve(saveResult), importToTarget: () => ({ ok: true, name: '课', path: '学科 / 年级 / 学期 / 课', add: 1, skip: 0 }) }
  };
  context.window = context;
  vm.createContext(context);
  try {
    vm.runInContext(adminSource.slice(0, adminClose) + adminSeam + adminSource.slice(adminClose), context, { filename: 'WordLab-admin' });
    vm.runInContext(logSource, context, { filename: 'WordLab-log' });
  } catch {
    throw new Error('WordLab admin/log fixture failed to initialize');
  }
  return {
    context, requests, beacons, intervals, timeouts, routes, storage: localStorage,
    log: context.WLLOG, admin: context.__adminTest,
    respond(fn) { respond = fn; }, setSaveResult(value) { saveResult = value; },
    boot() { for (const fn of docEvents.get('DOMContentLoaded') || []) fn(); },
    emit(name) { for (const fn of events.get(name) || []) fn(); },
    hide() { context.document.hidden = true; context.document.visibilityState = 'hidden'; for (const fn of docEvents.get('visibilitychange') || []) fn(); }
  };
}
const queuedPrivate = JSON.stringify([{ t: 1, k: 'ai', n: 'synthetic-private-message' }]);
const logs = adminLogHarness({ wordlab_logq: queuedPrivate, wordlab_aiHist: '[{"role":"user","text":"synthetic-private-history"}]' });
logs.boot();
assert.equal(logs.log.cfg().on, false, 'new logs are disabled by default');
assert.equal(logs.storage.getItem('wordlab_device'), null, 'disabled logging does not create a device identifier');
assert.equal(logs.storage.getItem('wordlab_logq'), queuedPrivate, 'disabled startup preserves but does not send a pending queue');
assert.equal(logs.log.add('ai', 'not collected'), false);
assert.equal(await logs.log.flush(true), false);
assert.equal(logs.log.beacon(), false);
logs.hide(); logs.emit('pagehide');
for (const timer of logs.timeouts.filter(timer => timer.delay === 8000)) await timer.fn();
for (const timer of logs.intervals.filter(timer => timer.delay === 60000)) await timer.fn();
assert.equal(logs.beacons.length, 0, 'disabled logs never send a beacon on exit');
assert.equal(logs.requests.filter(request => request.options.method && request.options.method !== 'GET').length, 0, 'disabled startup and timers never write remotely');

// A cloud recording switch cannot provide local consent.
logs.respond(() => Promise.resolve(okJSON({ pwd: 'a'.repeat(64), t: Date.now() + 10000, disabled: [], log: { on: true, items: { ai: true } } })));
await logs.admin.pullCfg();
assert.equal(logs.log.cfg().on, false, 'remote configuration cannot opt this device in');
assert.equal(await logs.log.flush(true), false);
assert.equal(logs.storage.getItem('wordlab_log_consent_v1'), null);

// A deliberate local opt-in permits selected summaries, not disabled AI/device/network fields.
logs.log.setCfg({ on: true, items: { ai: false, device: false, net: false } });
assert.equal(logs.log.cfg().on, true);
assert.equal(logs.storage.getItem('wordlab_log_consent_v1'), 'yes');
assert.equal(logs.log.add('ai', 'synthetic-private-message'), false);
assert.equal(logs.log.add('word', 'synthetic course import', { add: 1 }), true);
logs.respond(() => Promise.resolve(okJSON({ ok: true })));
assert.equal(await logs.log.flush(true), true);
const logPost = logs.requests.find(request => request.options.method === 'POST');
assert.ok(logPost && logPost.url === 'https://wordlab-api.pages.dev/api/log');
const sentLog = JSON.parse(logPost.options.body);
assert.deepEqual(Object.keys(sentLog.device).sort(), ['first', 'id'], 'disabled device/network metadata is omitted');
assert.ok(!logPost.options.body.includes('synthetic-private'), 'disabled AI entries do not leave the pending queue');
assert.deepEqual(sentLog.entries.map(entry => entry.k), ['word']);
assert.equal(logs.log.queue().length, 0, 'successful upload clears only the allowed queue');
logs.log.add('word', 'retryable synthetic import');
logs.respond(() => Promise.resolve({ ok: false }));
assert.equal(await logs.log.flush(true), false);
assert.equal(logs.log.queue().length, 1, 'failed upload retains queued summaries');
logs.log.setCfg({ on: false });
const offRequests = logs.requests.length;
assert.equal(await logs.log.flush(true), false);
assert.equal(logs.log.beacon(), false);
assert.equal(logs.requests.length, offRequests, 'turning off logging blocks queued uploads as well as collection');

// Cloud-save summaries follow the real asynchronous result; student no-ops add no summary.
const summaries = adminLogHarness();
summaries.admin.hookCloudSave();
assert.deepEqual(JSON.parse(JSON.stringify(summaries.admin.countTree(teacherState.tree))), { roots: 1, lessons: 1, words: 1 });
for (const result of [false, true]) {
  summaries.setSaveResult(result);
  assert.equal(await summaries.context.PORTAL.save(), result);
  const saved = JSON.parse(summaries.storage.getItem('wordlab_cloud_log'));
  assert.equal(saved.at(-1).ok, result, 'save summary matches the actual PUT result');
  assert.equal(saved.at(-1).lessons, 1);
}
summaries.setSaveResult(undefined);
const summaryBefore = summaries.storage.getItem('wordlab_cloud_log');
assert.equal(summaries.context.PORTAL.save(), undefined);
assert.equal(summaries.storage.getItem('wordlab_cloud_log'), summaryBefore, 'student save does not add a success summary');
for (const request of [...logs.requests, ...summaries.requests]) {
  assert.equal(new URL(request.url).origin, 'https://wordlab-api.pages.dev');
  assert.ok(!request.url.includes('/api/state/api/') && !request.url.includes('/balance'));
}

console.log(`WordLab: links, ${scripts} inline scripts compiled, 1269-word migration, default/personal AI isolation and offline requests, credential-free remote config, assets and v6 scoped cache lifecycle, portal read/cache/migration/save, 1128 role switching/course moves/AI imports, admin summaries and opt-in-only logging passed.`);
