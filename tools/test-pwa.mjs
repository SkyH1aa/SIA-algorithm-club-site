// Offline: node tools/test-pwa.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => readFile(path.join(root, name), 'utf8');

const manifest = JSON.parse(await read('public/manifest.webmanifest'));
const sw = await read('public/sw.js');
const shell = await read('public/club-shell.js');

// --- manifest ---
assert.equal(manifest.short_name, '算法社');
assert.equal(manifest.display, 'standalone');
assert.ok(manifest.start_url, 'has a start URL');
assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 1, 'has icons');
assert.ok(manifest.icons.every(icon => icon.type === 'image/svg+xml'), 'icons are the SVG brand mark');
assert.ok(manifest.icons.some(icon => icon.purpose === 'maskable'), 'Android maskable icon present');

// --- service worker ---
assert.match(sw, /const VERSION = '[0-9a-f]{10}'/, 'cache version is content-derived');
assert.match(sw, /SHELL_ASSETS/, 'precaches a shell');
// Privacy: never cache authenticated or database traffic.
assert.match(sw, /supabase\\.co/);
assert.match(sw, /functions\\\/v1\\\//);
assert.match(sw, /auth\\\/v1\\\//);
assert.match(sw, /rest\\\/v1\\\//);
assert.match(sw, /if \(isPrivate\(request\.url\)\) return;/, 'private requests bypass the cache entirely');
assert.match(sw, /acceptsHtml/, 'HTML uses a different strategy');
assert.match(sw, /network-first/, 'HTML is network-first');
assert.match(sw, /caches\.keys\(\)[\s\S]*?caches\.delete/, 'old caches are cleaned up');
assert.doesNotMatch(sw, /skipWaiting\(\)[\s\S]{0,40}cache\.deleteAll/, 'does not wipe caches on skipWaiting');
for (const name of ['chat-images.html', 'chat-images.css', 'chat-images.js', 'chat-images-core.js', 'chat-images-store.js', 'chat-images-i18n.js', 'chat-images-file-bundle.js']) {
  assert.ok(sw.includes(`./public/${name}`), `${name} is in the offline shell`);
}

// Exercise the fetch handler, including image bytes served through an opaque-looking URL.
const handlers = {};
let puts = 0, offline = false, networkResponse = new Response('ok');
const shellResponse = new Response('offline shell');
const cache = { put: async () => { puts++; }, match: async key => String(key).endsWith('/public/chat-images.css') ? shellResponse : undefined };
const cachesMock = { open: async () => cache, match: async () => undefined };
const scope = 'https://example.com/site/';
runInNewContext(sw, {
  URL, Response, caches: cachesMock,
  fetch: async () => { if (offline) throw new Error('offline'); return networkResponse; },
  self: { location: { origin: 'https://example.com' }, registration: { scope }, addEventListener: (name, fn) => { handlers[name] = fn; } }
});
function dispatch(url, { method = 'GET', destination = '', headers = {} } = {}) {
  let result;
  handlers.fetch({ request: { url, method, destination, headers: new Headers(headers) }, respondWith: promise => { result = promise; } });
  return result;
}
assert.equal(dispatch(`${scope}public/chat-images.js`, { headers: { authorization: 'Bearer secret' } }), undefined);
assert.equal(dispatch(`${scope}functions/v1/chat`), undefined);
assert.equal(dispatch(`${scope}private.png`, { destination: 'image' }), undefined);
assert.equal(dispatch(`blob:https://example.com/123`), undefined);
assert.equal(dispatch(`${scope}public/chat-images.js?token=secret`), undefined);
assert.equal(dispatch(`${scope}public/chat-images.js`, { method: 'POST' }), undefined);
networkResponse = new Response('private', { headers: { 'cache-control': 'private, no-store' } });
await dispatch(`${scope}public/chat-images.js`);
networkResponse = new Response('image bytes', { headers: { 'content-type': 'image/png' } });
await dispatch(`${scope}public/chat-images.js`);
await new Promise(resolve => setImmediate(resolve));
assert.equal(puts, 0, 'private and image responses never enter Cache Storage');
offline = true;
assert.equal(await (await dispatch(`${scope}public/chat-images.css?v=12345678`)).text(), 'offline shell');

// --- registration ---
assert.match(shell, /navigator\.serviceWorker\.register/, 'shell registers the worker');
assert.match(shell, /location\.protocol !== 'http:' && location\.protocol !== 'https:'/, 'file:// never registers');
assert.match(shell, /rel = 'manifest'/, 'manifest link injected');

// The worker file must be versioned so a change busts the cache.
const versions = JSON.parse(await read('public/asset-versions.json'));
assert.ok(versions.hashes['sw.js'], 'sw.js is content-hashed');

console.log('PWA: manifest, shell-only precache, private-request bypass, network-first HTML and guarded registration passed.');
