// Offline: node tools/test-admin-hub.mjs
//
// 回归保护：admin-hub.html 曾在超管账号下卡在「请先登录管理账号」。
//
// 根因是内联脚本在解析期直接调用 window.ClubStaffAccess.emptyPermissions()，
// 而 member-identity.js 是 defer 脚本，此时还没执行 → TypeError → 整个内联
// 脚本中断 → updateSession 从未运行 → 门禁永远不消失。
// 其他管理页不调用这套 API，所以只有管理员总览受影响。
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => readFile(path.join(root, name), 'utf8');

const page = await read('public/admin-hub.html');

// 1) The page must not call ClubStaffAccess at parse time without a guard.
assert.ok(!/let currentAccess = \{ isSuperAdmin: false, permissions: window\.ClubStaffAccess\.emptyPermissions\(\) \};/.test(page),
  'no unguarded ClubStaffAccess.emptyPermissions() at parse time');
assert.match(page, /const EMPTY_PERMISSIONS = \{/, 'a local permission fallback exists');
assert.match(page, /const emptyPermissions = \(\) =>/, 'permissions go through a guarded getter');

// 2) fetchStaffAccess must be awaited behind a readiness check.
assert.match(page, /whenStaffAccessReady\(\)/, 'updateSession waits for ClubStaffAccess');
assert.match(page, /function whenStaffAccessReady\(\)/, 'readiness helper exists');
const readyFn = page.slice(page.indexOf('function whenStaffAccessReady()')).slice(0, 600);
assert.match(readyFn, /window\.ClubStaffAccess/, 'waits for the global to appear');
assert.match(readyFn, /setTimeout\(tick, 25\)/, 'polls instead of assuming it is loaded');
assert.match(readyFn, /3000/, 'gives up after a bounded wait');
assert.match(page, /await whenStaffAccessReady\(\);\s*\n\s*currentAccess = await window\.ClubStaffAccess\.fetchStaffAccess\(session\);/,
  'the wait happens before fetchStaffAccess');

// 3) Behavioural: simulate the deferred-script ordering (ClubStaffAccess absent
//    during parse, present later) and make sure the page reaches the content.
const STUB = `
  const EMPTY_PERMISSIONS = { can_checkin: false, can_points: false, can_messages: false, can_invites: false, can_events: false, can_mall: false, can_members: false, can_join: false };
  const emptyPermissions = () => (window.ClubStaffAccess && typeof window.ClubStaffAccess.emptyPermissions === 'function')
    ? window.ClubStaffAccess.emptyPermissions()
    : { ...EMPTY_PERMISSIONS };
  let currentAccess = { isSuperAdmin: false, permissions: emptyPermissions() };
  function whenStaffAccessReady() {
    if (window.ClubStaffAccess) return Promise.resolve(true);
    return new Promise(resolve => {
      const started = Date.now();
      const tick = () => {
        if (window.ClubStaffAccess) return resolve(true);
        if (Date.now() - started > 3000) return resolve(false);
        setTimeout(tick, 25);
      };
      tick();
    });
  }
  globalThis.__probe = { currentAccess, whenStaffAccessReady, EMPTY_PERMISSIONS, emptyPermissions };
`;

// The snippet references EMPTY_PERMISSIONS before its declaration in source order,
// exactly like the real file (const hoisting is fine because it runs later).
const sandbox = vm.createContext({ window: {}, setTimeout, console, Date, Promise });
vm.runInContext(STUB, sandbox);
const probe = sandbox.__probe;

// At parse time, permissions fall back to all-false instead of throwing.
assert.equal(probe.currentAccess.isSuperAdmin, false);
assert.equal(probe.currentAccess.permissions.can_members, false);

// Later the deferred script defines the global; the waiter resolves.
sandbox.window.ClubStaffAccess = {
  emptyPermissions: () => ({ can_checkin: false, can_points: false, can_messages: false, can_invites: false, can_events: false, can_mall: false, can_members: false, can_join: false }),
  fetchStaffAccess: async () => ({ isSuperAdmin: true, permissions: {} })
};
assert.equal(await probe.whenStaffAccessReady(), true, 'waiter resolves once the global exists');

console.log('Admin hub: guarded permission fallback + bounded readiness wait; no parse-time TypeError on super-admin accounts.');
