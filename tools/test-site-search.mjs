// Offline: node tools/test-site-search.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => readFile(path.join(root, name), 'utf8');

const page = await read('public/search.html');
const fn = await read('supabase/functions/club-drive/index.ts');
const shell = await read('public/club-shell.js');

assert.match(page, /action: 'search_all'/, 'search page calls search_all');
assert.match(page, /data-club-search/, 'search input is discoverable via the "/" shortcut');
assert.match(page, /new URLSearchParams\(location\.search\)\.get\('q'\)/, 'supports ?q= deep links');
assert.match(page, /history\.replaceState/, 'keeps the query in the address bar');
assert.match(page, /aria-live="polite"/, 'results region is announced');

const searchFn = fn.slice(fn.indexOf('async function searchAll')).slice(0, 2600);
for (const table of ['club_announcements', 'club_events', 'club_member_points', 'club_mall_products']) {
  assert.ok(searchFn.includes(table), `${table} is searched`);
}
assert.match(searchFn, /is_published=eq\.true/g, 'only published rows are searched');
assert.doesNotMatch(searchFn, /club_member_profiles/, 'search never reads the profile table (no email leak)');
assert.match(searchFn, /SEARCH_LIMIT/, 'per-group limit exists');

// Every result type has a translation label.
const zh = await read('public/i18n-dict-zh.js');
const en = await read('public/i18n-dict-en.js');
const ctx = { window: {} };
vm.runInNewContext(zh, ctx);
vm.runInNewContext(en, ctx);
for (const lang of ['ClubI18nDictZh', 'ClubI18nDictEn']) {
  const dict = ctx.window[lang].search;
  for (const key of ['title', 'intro', 'placeholder', 'submit', 'hint', 'loading', 'failed',
    'empty', 'emptyHint', 'groupMember', 'groupAnnouncement', 'groupEvent', 'groupProduct']) {
    assert.equal(typeof dict[key], 'string', `${lang}.search.${key}`);
  }
}

// The launcher links to it.
assert.match(shell, /href: 'search\.html'/, 'launcher exposes site search');

console.log('Site search: search_all wiring, published-only scope, deep links, result labels and launcher entry passed.');
