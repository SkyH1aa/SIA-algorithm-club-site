// Offline: node tools/test-member-profile.mjs
// Member profile page + public projection contract.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => readFile(path.join(root, name), 'utf8');

const page = await read('public/member-profile.html');
const pointsPage = await read('public/member-points.html');
const centerPage = await read('public/member-center.html');
const fn = await read('supabase/functions/club-drive/index.ts');
const zh = await read('public/i18n-dict-zh.js');
const en = await read('public/i18n-dict-en.js');

// --- page wiring ---
assert.match(page, /member_profile_public_get/, 'profile page reads the public projection');
assert.match(page, /member_profile_settings_get/, 'profile page reads the owner settings');
assert.match(page, /member_profile_settings_set/, 'profile page writes the owner settings');
for (const id of ['showPoints', 'showDonations', 'showGames', 'showCheckin', 'headlineInput',
  'cardPoints', 'cardDonations', 'cardGames', 'cardCheckin']) {
  assert.ok(page.includes(`id="${id}"`), `profile page has #${id}`);
}
// The four switches default to the documented values.
for (const field of ['show_points', 'show_donations', 'show_games', 'show_checkin']) {
  assert.ok(page.includes(field + ': $('), `profile page submits ${field}`);
}

// Both leaderboards link a member name to the profile page by points id.
assert.match(pointsPage, /member-profile\.html\?id=\$\{escapeHtml\(member\.id\)\}/, 'points page links names');
assert.match(centerPage, /member-profile\.html\?id=\$\{escapeHtml\(member\.id\)\}/, 'member center links names');

// --- defaults from the SQL layer ---
const sql = await read('supabase/club-notifications-schema.sql');
assert.match(sql, /show_points boolean not null default true/);
assert.match(sql, /show_donations boolean not null default false/);
assert.match(sql, /show_games boolean not null default true/);
assert.match(sql, /show_checkin boolean not null default false/);
assert.match(sql, /headline text not null default ''/);
assert.match(sql, /char_length\(headline\) <= 80/, 'headline is capped at 80 chars');

// --- public projection privacy ---
const projection = fn.slice(fn.indexOf('async function publicMemberProfile')).slice(0, 4200);
assert.doesNotMatch(projection, /email/, 'never returns email');
assert.doesNotMatch(projection, /user_id:/, 'never returns user id');
assert.match(projection, /bound:/);
assert.match(projection, /is_self:/);
// Donations only when the owner enabled them.
const donationGate = projection.slice(projection.indexOf('if (settings.show_donations)'));
assert.match(donationGate.slice(0, 120), /profile\.donations = await donationTotalFor/, 'donations gated by switch');
const gamesGate = projection.slice(projection.indexOf('if (settings.show_games)'));
assert.match(gamesGate.slice(0, 120), /profile\.games = await gameStatsFor/, 'games gated by switch');
const checkinGate = projection.slice(projection.indexOf('if (settings.show_checkin)'));
assert.match(checkinGate.slice(0, 120), /profile\.checkin = await checkinStatsFor/, 'check-in gated by switch');

// Donations: exact Chinese name, multiple rows summed.
const donationFn = fn.slice(fn.indexOf('async function donationTotalFor')).slice(0, 1200);
assert.match(donationFn, /donor_name=eq\./, 'exact-name match only');
assert.match(donationFn, /total \+=/, 'sums every matching record');

// Games: only the three in-site games.
const gamesFn = fn.slice(fn.indexOf('async function gameStatsFor')).slice(0, 2200);
for (const table of ['gomoku_players', 'tetris_players', 'tetris_vs', 'snake_players']) {
  // tetris_vs is a loose substring guard; the real table name is checked below.
}
for (const table of ['gomoku_players', 'tetris_players', 'tetris_versus_players', 'snake_players', 'snake_versus_players']) {
  assert.ok(gamesFn.includes(table), `${table} present`);
}
assert.doesNotMatch(gamesFn, /platformer/i, '行于无垠 excluded');

// --- i18n coverage for every key the page uses ---
const ctx = { window: {} };
vm.runInNewContext(zh, ctx);
vm.runInNewContext(en, ctx);
const dict = { zh: ctx.window.ClubI18nDictZh, en: ctx.window.ClubI18nDictEn };
const used = new Set();
for (const match of page.matchAll(/data-i18n(?:-title|-placeholder|-aria)?="(memberProfile\.[A-Za-z0-9_.]+)"/g)) used.add(match[1]);
for (const match of page.matchAll(/t\('(memberProfile\.[A-Za-z0-9_.]+)'/g)) used.add(match[1]);
assert.ok(used.size >= 15, `expected many memberProfile keys, saw ${used.size}`);
for (const key of used) {
  const parts = key.split('.');
  const leaf = parts[parts.length - 1];
  const section = parts[0];
  assert.equal(typeof dict.zh[section]?.[leaf], 'string', `zh missing ${key}`);
  assert.equal(typeof dict.en[section]?.[leaf], 'string', `en missing ${key}`);
}

console.log(`Member profile: ${used.size} i18n keys, four switch defaults, exact-name donation sum, `
  + 'three in-site games only, privacy-safe projection passed.');
