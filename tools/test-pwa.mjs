// Offline: node tools/test-pwa.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

// --- registration ---
assert.match(shell, /navigator\.serviceWorker\.register/, 'shell registers the worker');
assert.match(shell, /location\.protocol !== 'http:' && location\.protocol !== 'https:'/, 'file:// never registers');
assert.match(shell, /rel = 'manifest'/, 'manifest link injected');

// The worker file must be versioned so a change busts the cache.
const versions = JSON.parse(await read('public/asset-versions.json'));
assert.ok(versions.hashes['sw.js'], 'sw.js is content-hashed');

console.log('PWA: manifest, shell-only precache, private-request bypass, network-first HTML and guarded registration passed.');
