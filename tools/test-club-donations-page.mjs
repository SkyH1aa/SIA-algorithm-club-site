// Offline: node tools/test-club-donations-page.mjs
// Checks the donations page wiring, entry points, i18n coverage and light/dark safety
// without a browser, network, or database.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const read = name => readFile(new URL(name, root), 'utf8');

const page = await read('public/donations.html');
const features = await read('public/club-features.html');
const shell = await read('public/club-shell.js');
const hub = await read('public/admin-hub.html');
const dictSource = await read('public/i18n-dict.js');
const fn = await read('supabase/functions/club-drive/index.ts');
const sql = await read('supabase/club-donations-schema.sql');

// --- Dictionary loads and both languages cover every key the page uses ---
const dictContext = { window: {} };
vm.runInNewContext(dictSource, dictContext);
const dict = dictContext.window.ClubI18nDict;
assert.ok(dict?.zh?.donations && dict?.en?.donations, 'donations dictionary missing');
const used = new Set([...page.matchAll(/data-i18n(?:-title|-placeholder|-aria)?="(donations\.[A-Za-z0-9_.]+)"/g)].map(m => m[1].slice('donations.'.length)));
for (const match of page.matchAll(/t\('(donations\.[A-Za-z0-9_.]+)'/g)) used.add(match[1].slice('donations.'.length));
assert.ok(used.size > 20, 'expected the page to use many translation keys');
for (const key of used) {
  assert.equal(typeof dict.zh.donations[key], 'string', `zh donation key missing: ${key}`);
  assert.equal(typeof dict.en.donations[key], 'string', `en donation key missing: ${key}`);
}
assert.ok(dict.zh.pages.donations?.title && dict.en.pages.donations?.title, 'page title translation missing');
assert.ok(dict.zh.features.donations && dict.en.features.donations, 'features card translation missing');
assert.ok(dict.zh.admin.entryDonations && dict.en.admin.entryDonations, 'admin hub entry translation missing');
assert.ok(dict.zh.admin.entryShortDonations && dict.en.admin.entryShortDonations, 'admin rail label translation missing');
// Placeholders with variables must keep them in both languages.
assert.match(dict.zh.donations.editing, /\{name\}/);
assert.match(dict.en.donations.editing, /\{name\}/);
assert.match(dict.zh.donations.confirmDelete, /\{name\}/);
assert.match(dict.en.donations.confirmDelete, /\{name\}/);

// --- Page wiring ---
assert.match(page, /data-i18n-title-key="pages\.donations\.title"/);
for (const id of ['memberGate', 'content', 'adminPanel', 'donationForm', 'donorName', 'donatedOn', 'amount', 'donationId', 'saveButton', 'resetButton', 'refreshButton', 'donationList', 'formMessage', 'listMessage', 'summaryCount', 'roleBadge']) {
  assert.ok(page.includes(`id="${id}"`), `missing element #${id}`);
}
assert.match(page, /<script src="club-shell\.js(?:\?v=[^"]*)?"><\/script>/);
assert.match(page, /data-club-admin-rail/);
assert.match(page, /member-identity\.js/);
// Read path vs admin path, and super-admin-only editing UI.
assert.match(page, /isSuperAdmin \? 'admin_donations_list' : 'donations_list'/);
assert.match(page, /\$\(['"]adminPanel['"]\)\.hidden = !isSuperAdmin/);
assert.match(page, /isSuperAdmin = Boolean\(access\.isSuperAdmin\)/, 'must rely on isSuperAdmin, not a staff permission');
// QR panel: public read-only display, admin-only form, safe URL handling.
for (const id of ['qrPanel', 'qrFigure', 'qrForm', 'qrUrl', 'qrSaveButton', 'qrClearButton', 'qrMessage']) {
  assert.ok(page.includes(`id="${id}"`), `missing QR element #${id}`);
}
assert.match(page, /function safeImageUrl/);
assert.match(page, /\['http:', 'https:'\]\.includes\(url\.protocol\)/, 'QR URL must be restricted to http(s)');
assert.match(page, /function renderQr/);
assert.match(page, /t\('donations\.qrEmpty'\)/, 'empty QR falls back to the no-code label');
assert.match(page, /\$\('qrForm'\)\.hidden = !isSuperAdmin/);
assert.match(page, /admin_donation_settings_save/);
assert.doesNotMatch(page, /permissions\?\.can_/, 'donation editing must not accept a staff permission');
// Default ordering is documented the same way as the server.
assert.match(page, /按金额从大到小/);
// The page must never write HTML without escaping user-controlled names.
assert.match(page, /ClubCommon\.escapeHtml|const escapeHtml/);
assert.match(page, /\$\{escapeHtml\(item\.donor_name\)\}/);
// Theme: no hardcoded white/black text that would break the light theme.
assert.doesNotMatch(page, /#fff\b|#ffffff\b|color:\s*white/i, 'avoid hardcoded white text');
assert.doesNotMatch(page, /:root\s*\{/, 'must not redefine global theme variables');

// --- Entry points ---
assert.match(features, /<a class="card" href="donations\.html">/);
assert.match(features, /data-i18n="features\.donationsDesc"/);
assert.match(shell, /\{ group: 'member'[^}]*href: 'donations\.html'/);
assert.match(shell, /href: 'donations\.html', requires: 'super'/, 'admin rail entry must be super-admin only');
assert.match(hub, /href: 'donations\.html'[^}]*superOnly: true/, 'admin hub entry must be super-admin only');
// The member-scope launcher entry must stay visible to ordinary members.
const launcherEntry = shell.match(/\{ group: 'member'[^\n]*href: 'donations\.html'[^\n]*\}/);
assert.ok(launcherEntry, 'launcher entry not found');
assert.equal(/requires:/.test(launcherEntry[0]), false, 'member launcher entry must not require staff access');

// --- Server contract ---
assert.match(fn, /if \(payload\.action === 'donations_list'\)[\s\S]{0,220}if \(!user\?\.id\) return json\(\{ error: '请先登录。' \}, 401\)/);
for (const action of ['admin_donations_list', 'admin_donations_save', 'admin_donations_delete']) {
  const pattern = new RegExp(`payload\\.action === '${action}'[\\s\\S]{0,200}requireSuperAdmin\\(user\\)`);
  assert.match(fn, pattern, `${action} must require super admin`);
}
assert.match(fn, /const order = 'amount\.desc,donated_on\.desc,created_at\.desc'/);
assert.match(fn, /select=id,donor_name,donated_on,amount,created_at,updated_at&order=\$\{order\}/);
assert.match(fn, /Math\.round\(numeric \* 100\)/, 'amount must be normalised to cents');
// QR settings: super-admin only write, strict URL validation, one row per site.
assert.match(fn, /payload\.action === 'admin_donation_settings_save'[\s\S]{0,200}requireSuperAdmin\(user\)/);
assert.match(fn, /function asPaymentQrUrl/);
assert.match(fn, /parsed\.protocol !== 'https:' && parsed\.protocol !== 'http:'/);
assert.match(fn, /parsed\.username \|\| parsed\.password/);
assert.match(fn, /club_donation_settings\?select=payment_qr_url,updated_at/);
assert.match(fn, /donations, settings/);
assert.doesNotMatch(fn, /can_donations/, 'donations must not become a staff permission');

// --- SQL contract ---
assert.match(sql, /create table if not exists public\.club_donations/);
assert.match(sql, /amount numeric\(12,2\) not null check \(amount > 0/);
assert.match(sql, /donated_on date not null/);
assert.match(sql, /enable row level security/);
assert.match(sql, /revoke all on table public\.club_donations from public, anon, authenticated/);
assert.match(sql, /to service_role/);
assert.match(sql, /amount desc, donated_on desc, created_at desc/);
assert.match(sql, /create table if not exists public\.club_donation_settings/);
assert.match(sql, /payment_qr_url text not null default ''/);
assert.match(sql, /grant select, update on table public\.club_donation_settings to service_role/);
assert.match(sql, /insert into public\.club_donation_settings/);

console.log('Club donations page: i18n coverage, read/admin split, super-admin-only entry points, escaping, theme safety and SQL contract passed.');
