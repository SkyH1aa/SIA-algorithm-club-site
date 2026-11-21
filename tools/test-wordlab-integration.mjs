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
assert.ok(/<meta name="wordlab-source" content="1121-e86470c4021d4a7b">/.test(page));
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
assert.equal(updated.data.get('wordlab_v1'), migrated.data.get('wordlab_v1'), '1121 retains the existing vocabulary migration marker');
assert.equal(updated.data.get('wordlab_pwdhash'), 'existing-password-hash', '1121 does not repeat factory password clearing');
assert.equal(updated.reloads.length, 0, '1121 does not require a new defaults reload');
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
const cacheNames = ['club-shell-old', 'club-runtime-old', 'unrelated-app', 'wordlab-v2', `${prefix}v1`, `${prefix}v2`, `${prefix}v3`, `${prefix}v4`];
const app = worker(wordlabSource, scope, cacheNames);
await app.activate();
assert.deepEqual(app.deleted, [`${prefix}v1`, `${prefix}v2`, `${prefix}v3`], 'WordLab deletes only its own obsolete caches');
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

console.log(`WordLab: links, ${scripts} inline scripts compiled, 1269-word migration, default/personal AI isolation and offline requests, credential-free remote config, assets and v4 scoped cache lifecycle passed.`);
