// Offline: node tools/test-drive-quota.mjs
// 社团盘容量配额：仅超管可管理、按用户/全局两种粒度、写入前实时校验。
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => readFile(path.join(root, name), 'utf8');

const sql = await read('supabase/club-drive-quota-schema.sql');
const fn = await read('supabase/functions/club-drive/index.ts');
const page = await read('public/drive-admin.html');
const shell = await read('public/club-shell.js');
const gate = await read('public/service-gate.js');
const hub = await read('public/admin-hub.html');

// --- schema ---
assert.match(sql, /create table if not exists public\.club_drive_quotas/i);
assert.match(sql, /max_bytes bigint not null default 0/i);
assert.match(sql, /user_id uuid,/, 'global row uses a null user_id');
assert.match(sql, /club_drive_quotas_global_uidx/, 'only one global default row');
assert.match(sql, /enable row level security/i);
assert.match(sql, /grant select, insert, update, delete on table public\.club_drive_quotas to service_role/i);
assert.doesNotMatch(sql, /grant [^;]*to anon/i, 'never granted to anon');
assert.doesNotMatch(sql, /drop table/i, 'never drops an existing table');
assert.match(sql, /get_club_drive_quota/i);
assert.match(sql, /set_club_drive_quota/i);
assert.match(sql, /clear_club_drive_quota/i);

// --- backend: super-admin only management ---
for (const action of ['admin_drive_quota_list', 'admin_drive_quota_set', 'admin_drive_quota_clear']) {
  const start = fn.indexOf(`payload.action === '${action}'`);
  assert.ok(start > 0, `${action} is dispatched`);
  const block = fn.slice(start, start + 420);
  assert.match(block, /requireSuperAdmin\(user\)/, `${action} requires a super admin`);
}
// Quota is enforced before writes.
assert.match(fn, /async function assertDriveQuota/, 'quota guard exists');
const uploadBlock = fn.slice(fn.indexOf("streamAction === 'upload'"), fn.indexOf("streamAction === 'upload'") + 900);
assert.match(uploadBlock, /assertDriveQuota\(user\.id/, 'file upload checks the quota');
const archiveBlock = fn.slice(fn.indexOf('async function chatArchiveRequest'), fn.indexOf('async function chatArchiveRequest') + 4200);
assert.match(archiveBlock, /assertDriveQuota\(user\.id/, 'chat archive upload checks the quota');
// Usage is measured from the live WebDAV tree, not a cached counter.
assert.match(fn, /async function driveUsageBytes/, 'usage walks the real directory');
assert.match(fn, /depth > DRIVE_QUOTA_MAX_DEPTH/, 'recursion is bounded');
// A zero limit means unlimited.
assert.match(fn, /maxBytes === 0/, 'zero means unlimited');
assert.match(fn, /unlimited:/, 'usage reports the unlimited flag');

// --- page ---
assert.match(page, /admin_drive_quota_list/);
assert.match(page, /admin_drive_quota_set/);
assert.match(page, /admin_drive_quota_clear/);
assert.match(page, /drive_quota_get/);
assert.match(page, /id="globalForm"/);
assert.match(page, /id="userForm"/);
assert.match(page, /id="usageForm"/);
// Gate: only super admins reach the content.
assert.match(page, /isSuper = Boolean\(access\?\.isSuperAdmin\)/);
assert.match(page, /\$\('content'\)\.classList\.toggle\('hidden', !isSuper\)/);
// User-facing strings must be translated, not hard-coded.
const i18nZh = await read('public/i18n-dict-zh.js');
const i18nEn = await read('public/i18n-dict-en.js');
const ctx = { window: {} };
vm.runInNewContext(i18nZh, ctx);
vm.runInNewContext(i18nEn, ctx);
const zh = ctx.window.ClubI18nDictZh;
const en = ctx.window.ClubI18nDictEn;
assert.ok(zh.driveAdmin && en.driveAdmin, 'driveAdmin dictionary exists');
const used = new Set();
for (const m of page.matchAll(/data-i18n(?:-title|-placeholder|-aria)?="(driveAdmin\.[A-Za-z0-9_.]+)"/g)) used.add(m[1]);
for (const m of page.matchAll(/t\('(driveAdmin\.[A-Za-z0-9_.]+)'/g)) used.add(m[1]);
assert.ok(used.size >= 15, `expected many keys, saw ${used.size}`);
for (const key of used) {
  const leaf = key.split('.').pop();
  const section = key.split('.')[0];
  if (key.includes('.source_')) continue; // built dynamically below
  assert.equal(typeof zh[section]?.[leaf], 'string', `zh missing ${key}`);
  assert.equal(typeof en[section]?.[leaf], 'string', `en missing ${key}`);
}
for (const source of ['none', 'global', 'user']) {
  assert.equal(typeof zh.driveAdmin[`source_${source}`], 'string', `zh source_${source}`);
  assert.equal(typeof en.driveAdmin[`source_${source}`], 'string', `en source_${source}`);
}

// --- discoverability ---
assert.match(shell, /href: 'drive-admin\.html'/, 'launcher lists the page');
assert.match(shell, /requires: 'super'/, 'launcher entry is super-admin only');
assert.match(gate, /'drive-admin\.html':'drive-admin'/, 'service gate maps the page');
assert.match(hub, /href: 'drive-admin\.html'/, 'admin hub links the page');
assert.match(hub, /permOn\(key\) \{\s*\n\s*if \(currentAccess\?\.isSuperAdmin\) return true;/, 'super-only entries pass permOn');

console.log(`Drive quota: schema RLS, super-admin-only ${3} actions, live usage walk, write-time enforcement, ${used.size} i18n keys, launcher/gate/hub wiring passed.`);
