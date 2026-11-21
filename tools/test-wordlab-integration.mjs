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
assert.match(page, /href="\.\.\/\.\.\/\.\.\/index\.html"[^>]*>← 返回社团主页<\/a>/);
assert.doesNotMatch(page, /<(?:script|link)\b[^>]*(?:src|href)="[^"\n]*(?:club-shell|club-ui|theme\.js|i18n\.js)/);
assert.match(page, /var BUILTIN = '';/, 'public copy has no bundled default AI credential');
assert.doesNotMatch(page, /var KEYB = '[A-Za-z0-9+/=]{20,}'/);
assert.doesNotMatch(page, /内置 Key（已隐藏），可直接用/);
assert.equal(manifest.start_url, './WordLab.html');
assert.equal(manifest.scope, './');
for (const icon of manifest.icons) {
  assert.ok((await readFile(new URL(`public/member-works/wordlab/${icon.src}`, root))).length > 0);
}
let scripts = 0;
for (const match of page.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
  if (/\bsrc=/.test(match[1])) continue;
  new vm.Script(match[2], { filename: `WordLab-inline-${++scripts}` });
}
assert.ok(scripts >= 2, 'compile the original inline application without executing it');

const defaultsSource = page.slice(page.indexOf('/* ===== ng-defaults.js ===== */'), page.indexOf('/* ===== ng-sitecfg.js ===== */'));
assert.ok(defaultsSource.length > 0, 'updated member defaults are present');
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
assert.equal(fresh.storage.getItem('wordlab_aiKey'), null);
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
  assert.equal(migrated.storage.getItem(key), prior[key], 'cached site defaults do not override personal AI settings');
  migrated.storage.setItem(key, 'saved-personal-value');
  assert.equal(migrated.storage.getItem(key), 'saved-personal-value', 'personal AI settings remain writable');
}
migrated.storage.removeItem('wordlab_aiKey');
assert.equal(migrated.storage.getItem('wordlab_aiKey'), null, 'clear key remains effective');
migrated.window.DEFAULTS.applyRemote({ settings: { wordlab_aiKey: 'discard-remote-value' }, ai: { key: 'discard-ai-value', model: 'new-site-model' } });
assert.equal(migrated.storage.getItem('wordlab_aiKey'), null, 'remote config cannot insert a default key');
const sanitized = JSON.parse(migrated.data.get('wordlab_sitecfg_cache'));
assert.equal(Object.hasOwn(sanitized.settings, 'wordlab_aiKey'), false);
assert.equal(Object.hasOwn(sanitized.ai, 'key'), false, 'remote credentials are not cached');
const restored = defaults(Object.fromEntries(migrated.data), migrated.session);
assert.equal(restored.data.get('wordlab_v1'), migrated.data.get('wordlab_v1'), 'reload does not duplicate vocabulary');
assert.equal(restored.reloads.length, 0, 'completed migration does not reload again');
const corrupt = defaults({ wordlab_v1: '{incomplete', wordlab_log: prior.wordlab_log });
assert.equal(corrupt.data.get('wordlab_v1'), '{incomplete', 'invalid existing vocabulary remains recoverable');
assert.equal(corrupt.data.get('wordlab_log'), prior.wordlab_log);
const noKeyCache = defaults({ wordlab_sitecfg_cache: prior.wordlab_sitecfg_cache });
assert.equal(noKeyCache.storage.getItem('wordlab_aiKey'), null, 'cached default key is ignored without a personal key');
assert.equal(noKeyCache.storage.getItem('wordlab_aiUrl'), 'https://site.example.test/v1/chat/completions', 'credential-free remote AI defaults still apply');

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
const cacheNames = ['club-shell-old', 'club-runtime-old', 'unrelated-app', 'wordlab-v2', `${prefix}v1`, `${prefix}v2`];
const app = worker(wordlabSource, scope, cacheNames);
await app.activate();
assert.deepEqual(app.deleted, [`${prefix}v1`], 'WordLab deletes only its own obsolete cache');
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

console.log(`WordLab: directory/return links, original-style isolation, no bundled AI key, ${scripts} inline scripts compiled, 1269-word seed and progress-preserving migration, personal AI settings, credential-free remote config, assets and scoped cache lifecycle passed.`);
