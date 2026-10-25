// Offline: node tools/test-club-launcher-favorites.mjs
// Contract test for the launcher favorites / recents layer:
// account-bound backend (schema + edge actions) plus the local fallback.
// Behaviour is verified in a browser separately (file:// + HTTP, guest and signed-in).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => readFile(path.join(root, name), 'utf8');

const shell = await read('public/club-shell.js');
const css = await read('public/club-ui.css');
const sql = await read('supabase/club-launcher-schema.sql');
const fn = await read('supabase/functions/club-drive/index.ts');

// ---------- schema: account-owned, service_role only ----------
assert.match(sql, /create table if not exists public\.club_launcher_items/i, 'launcher table exists');
assert.match(sql, /primary key \(user_id, kind, item_key\)/, 'one row per user/kind/key');
assert.match(sql, /constraint club_launcher_items_kind_check[\s\S]*?check \(kind in \('favorite', 'recent'\)\)/, 'only favorite/recent kinds');
assert.match(sql, /enable row level security/i, 'RLS enabled');
assert.match(sql, /create policy "deny all club_launcher_items"[\s\S]*?using \(false\)[\s\S]*?with check \(false\)/, 'deny-all policy');
assert.doesNotMatch(sql, /grant .* to anon/i, 'launcher table must never be granted to anon');
assert.doesNotMatch(sql, /grant .* to authenticated/i, 'launcher table must never be granted to authenticated');
assert.doesNotMatch(sql, /drop table/i, 'schema must never drop an existing table');
for (const name of ['get_club_launcher_items', 'set_club_launcher_favorite', 'push_club_launcher_recent',
  'clear_club_launcher_recents', 'merge_club_launcher_items']) {
  assert.ok(sql.includes(`function public.${name}`), `${name} exists`);
}
assert.match(sql, /security definer/g, 'launcher functions run as definer');
assert.match(sql, /offset case when p_kind = 'recent' then 6 else 24 end/, 'caps are enforced server-side');

// ---------- edge function: five actions, auth required, user id from token only ----------
for (const action of ['launcher_items_get', 'launcher_favorite_set', 'launcher_recent_push',
  'launcher_recents_clear', 'launcher_items_merge']) {
  assert.ok(fn.includes(`payload.action === '${action}'`), `action ${action} is dispatched`);
  const block = fn.slice(fn.indexOf(`payload.action === '${action}'`)).slice(0, 260);
  assert.match(block, /if \(!user\?\.id\) return json\(\{ error: .* \}, 401\)/, `${action} requires auth`);
}
assert.match(fn, /async function getLauncherItems\(userId: string\)/, 'reads by authenticated user id');
assert.match(fn, /p_user_id: userId/, 'never trusts a client-supplied user id');
assert.doesNotMatch(fn.slice(fn.indexOf("async function getLauncherItems"), fn.indexOf("async function allMemberUserIds")),
  /payload\.user_?[Ii]d/, 'launcher handlers ignore user_id from the request body');
assert.match(fn, /launcherAfterWrite/, 'writes re-read the authoritative order');
assert.match(fn, /LAUNCHER_MAX_FAVORITES = 24/, 'favorites cap mirrors the schema');
assert.match(fn, /LAUNCHER_MAX_RECENTS = 6/, 'recents cap mirrors the schema');

// ---------- front end: account first, local fallback ----------
assert.match(shell, /FAVORITES_KEY = 'algorithm-club-launcher-favorites'/, 'favorites cache key is stable');
assert.match(shell, /STORAGE_KEY = 'algorithm-club-launcher-recents'/, 'recents keep the historical key');
assert.match(shell, /OWNER_KEY = 'algorithm-club-launcher-owner'/, 'cache records which account owns it');
assert.match(shell, /function setLauncherSession\(session\)/, 'session changes drive the sync');
assert.match(shell, /function bindLauncherAuth\(\)/, 'sync subscribes to auth state');
assert.match(shell, /launcher_items_merge/, 'first sign-in merges guest favorites');
assert.match(shell, /launcher_items_get/, 'signed-in reads come from the account');
assert.match(shell, /launcher_favorite_set/, 'favorites are written to the account');
assert.match(shell, /launcher_recent_push/, 'recents are written to the account');
assert.match(shell, /launcher_recents_clear/, 'clearing recents is written to the account');
assert.match(shell, /launcherSync\.remote/, 'remote/local mode is explicit');
assert.match(shell, /wasRemote \|\| readOwner\(\)/, 'logout clears the cached account data');

// Guest mode must not call the network.
const guestBlock = shell.slice(shell.indexOf('function pushRecent(item)'), shell.indexOf('function rememberCurrentView'));
assert.match(guestBlock, /if \(launcherSync\.remote\) \{/, 'remote push is gated by an authenticated session');
assert.match(shell, /function launcherRequest\(action, body\) \{\s*var token = launcherSync\.token;\s*if \(!token\) return Promise\.reject/, 'no token means no request');

// ---------- stable keys and launcher rendering ----------
assert.match(shell, /function itemKey\(item\) \{\s*return \(item\.root \? 'root:' : 'page:'\) \+ item\.href;/, 'stable item keys instead of paths');
assert.match(shell, /function normalizeStoredEntry/, 'legacy href-only records migrate');
const renderBlock = shell.slice(shell.indexOf('function renderLauncher'), shell.indexOf('function setActive'));
const favoritesIndex = renderBlock.indexOf("launcherGroupHtml(en ? 'Favorites' : '收藏'");
const recentsIndex = renderBlock.indexOf("en ? 'Recent' : '最近使用'");
const groupsIndex = renderBlock.indexOf('groups.forEach(function (group)');
assert.ok(favoritesIndex > 0, 'a favorites group is rendered');
assert.ok(recentsIndex > favoritesIndex && groupsIndex > recentsIndex, 'Favorites → Recent → normal groups');
assert.match(renderBlock, /if \(shownKeys\[itemKey\(item\)\]\) return false;/, 'no duplicate row across groups');
assert.match(renderBlock, /No favorites yet/, 'empty favorites explain how to add one');
assert.match(renderBlock, /data-launcher-clear="recents"/, 'recents can be cleared');
assert.match(renderBlock, /item\.href\.split\('\?'\)\[0\]\.toLowerCase\(\) !== here/, 'current page hides from its own recents');

// ---------- interactions ----------
assert.match(shell, /event\.target\.closest\('\.club-launcher-star'\)/, 'clicking the star toggles a favorite');
assert.match(shell, /event\.metaKey \|\| event\.ctrlKey/, 'Ctrl/⌘ + Enter toggles a favorite');
assert.match(shell, /renderLauncher\(launcherInput\.value\);\s*var next = -1;/, 'the active row survives a re-render');
assert.match(shell, /rememberCurrentView\(\);/, 'boot records the current page');
assert.match(shell, /if \(!item \|\| item\.root\) return;/, 'root/home entries are skipped for recents');

// ---------- styles ----------
assert.match(css, /\.club-launcher-group \{[\s\S]*?display: flex;/, 'group header supports a trailing action');
assert.match(css, /\.club-launcher-star\.is-favorite \{ color: var\(--club-warn\); \}/, 'favorited star uses the warn token');
assert.match(css, /@media \(hover: none\) \{\s*\.club-launcher-star \{ opacity: 1; \}/, 'touch devices always show the star');
assert.match(css, /\.club-launcher-clear/, 'clear action has a style');

console.log('Launcher favorites: account-owned schema, auth-only edge actions, pin-to-top render, guest fallback and sync caps passed.');
