// Offline: node tools/test-notifications.mjs
// Verifies the notification data layer: schema shape, action wiring, dedupe,
// read marking, and that every push site uses a stable dedupe key.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => readFile(path.join(root, name), 'utf8');

const sql = await read('supabase/club-notifications-schema.sql');
const fn = await read('supabase/functions/club-drive/index.ts');

// --- schema ---
assert.match(sql, /create table if not exists public\.club_notifications/i);
assert.match(sql, /create table if not exists public\.club_member_profile_settings/i);
assert.match(sql, /enable row level security/i);
assert.equal((sql.match(/deny all club_notifications/g) || []).length >= 1, true, 'deny-all policy present');
assert.match(sql, /grant select, insert, update, delete on table public\.club_notifications to service_role/i);
assert.match(sql, /grant select, insert, update, delete on table public\.club_member_profile_settings to service_role/i);
assert.doesNotMatch(sql, /grant .* to anon/i, 'notification tables must never be granted to anon');
assert.doesNotMatch(sql, /grant .* to authenticated/i, 'notification tables must never be granted to authenticated');
assert.doesNotMatch(sql, /drop table/i, 'schema must never drop an existing table');
assert.match(sql, /create unique index if not exists club_notifications_dedupe_uidx[\s\S]*?where dedupe_key <> ''/i,
  'dedupe index is partial so empty keys are allowed');
assert.match(sql, /get_club_member_profile_settings/i);
assert.match(sql, /set_club_member_profile_settings/i);

// --- action wiring ---
for (const action of ['notifications_list', 'notifications_mark_read', 'member_profile_public_get',
  'member_profile_settings_get', 'member_profile_settings_set', 'search_all']) {
  assert.ok(fn.includes(`'${action}'`), `action ${action} is dispatched`);
}
// Every member-facing notification action requires a logged-in user.
for (const action of ['notifications_list', 'notifications_mark_read', 'member_profile_public_get',
  'member_profile_settings_get', 'member_profile_settings_set']) {
  const block = fn.slice(fn.indexOf(`payload.action === '${action}'`)).slice(0, 260);
  assert.match(block, /if \(!user\?\.id\) return json\(\{ error: .* \}, 401\)/, `${action} requires auth`);
}

// Search is public and only exposes published content.
const searchStart = fn.indexOf("payload.action === 'search_all'");
const searchEnd = fn.indexOf("payload.action ===", searchStart + 10);
const searchBlock = fn.slice(searchStart, searchEnd > 0 ? searchEnd : searchStart + 400);
assert.doesNotMatch(searchBlock, /401/, 'search_all stays available to guests');
const searchFn = fn.slice(fn.indexOf('async function searchAll'));
assert.match(searchFn.slice(0, 2000), /is_published=eq\.true/, 'search only returns published announcements/events');

// Public profile projection must never leak identity fields.
const publicProfile = fn.slice(fn.indexOf('async function publicMemberProfile')).slice(0, 4000);
assert.doesNotMatch(publicProfile, /email:/, 'public profile must not return email');
assert.doesNotMatch(publicProfile, /user_id:/, 'public profile must not return user ids');
assert.match(publicProfile, /is_self:/, 'public profile tells the viewer whether it is their own page');
assert.match(publicProfile, /settings\.show_donations/, 'donations are gated by the owner setting');
assert.match(publicProfile, /settings\.show_games/, 'games are gated by the owner setting');
assert.match(publicProfile, /settings\.show_checkin/, 'check-in stats are gated by the owner setting');

// Donations are summed by exact Chinese name (multiple rows allowed).
const donationTotal = fn.slice(fn.indexOf('async function donationTotalFor')).slice(0, 1200);
assert.match(donationTotal, /donor_name=eq\./, 'donations match by exact name');
assert.match(donationTotal, /total \+=/, 'multiple donation rows are summed');

// Game stats cover exactly the three in-site games, never the platformer.
const gameStats = fn.slice(fn.indexOf('async function gameStatsFor')).slice(0, 2000);
for (const table of ['gomoku_players', 'tetris_players', 'tetris_versus_players', 'snake_players', 'snake_versus_players']) {
  assert.ok(gameStats.includes(table), `${table} is included in game stats`);
}
assert.doesNotMatch(gameStats, /platformer/, '行于无垠 (platformer) is excluded from game stats');

// --- dedupe keys at every push site ---
const pushSites = [...fn.matchAll(/dedupeKey: `([^`]+)`/g)].map(m => m[1]);
assert.ok(pushSites.length >= 6, `expected at least 6 notification push sites, saw ${pushSites.length}`);
for (const key of pushSites) {
  assert.ok(key.includes(':'), `dedupe key must be namespaced: ${key}`);
}
const kinds = [...fn.matchAll(/kind: '([a-z]+)'/g)].map(m => m[1]);
for (const kind of kinds) {
  assert.ok(['announcement', 'event', 'signup', 'points', 'message', 'mall', 'account', 'system'].includes(kind),
    `unknown notification kind: ${kind}`);
}

// Broadcast helpers skip drafts/cancelled events and unpublished announcements.
const broadcastEvent = fn.slice(fn.indexOf('async function broadcastEvent')).slice(0, 900);
assert.match(broadcastEvent, /草稿/, 'draft events do not notify');
assert.match(broadcastEvent, /已取消/, 'cancelled events do not notify');
const broadcastAnnouncement = fn.slice(fn.indexOf('async function broadcastAnnouncement')).slice(0, 900);
assert.match(broadcastAnnouncement, /is_published === false/, 'unpublished announcements do not notify');

console.log(`Notifications: schema RLS/grants, ${pushSites.length} dedupe-keyed push sites, auth gating, `
  + 'public-profile projection and search wiring passed.');
