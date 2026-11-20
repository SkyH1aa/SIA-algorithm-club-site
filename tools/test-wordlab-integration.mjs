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
const cacheNames = ['club-shell-old', 'club-runtime-old', 'unrelated-app', 'wordlab-v2', `${prefix}v0`, `${prefix}v1`];
const app = worker(wordlabSource, scope, cacheNames);
await app.activate();
assert.deepEqual(app.deleted, [`${prefix}v0`], 'WordLab deletes only its own obsolete cache');
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

console.log(`WordLab: directory/return links, original-style isolation, no bundled AI key, ${scripts} inline scripts compiled, assets and scoped cache lifecycle passed.`);
