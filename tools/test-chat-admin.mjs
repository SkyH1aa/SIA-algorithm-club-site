import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

// No browser, credentials, network, or provider calls: run the real management
// functions with a minimal DOM and a queued fetch double.
const publicUrl = new URL('../public/', import.meta.url);
const html = await readFile(new URL('chat-admin.html', publicUrl), 'utf8');
const source = await readFile(new URL('chat-admin.js', publicUrl), 'utf8');
const nodes = new Map();
function makeNode(id) {
  let value = '';
  return {
    id, textContent: '', innerHTML: '', checked: false, hidden: false, disabled: false,
    elements: [], options: [],
    get value() { return value; }, set value(next) { value = String(next); },
    classList: {toggle() {}}, setAttribute() {}, reset() {},
    replaceChildren(...options) { this.options = options; value = options[0]?.value ?? ''; },
    add(option) { this.options.push(option); },
    querySelector() { return {disabled: false}; }
  };
}
for (const match of html.matchAll(/id="([^"]+)"/g)) {
  assert(!nodes.has(match[1]), `Duplicate HTML ID: ${match[1]}`);
  nodes.set(match[1], makeNode(match[1]));
}
function node(id) {
  assert(nodes.has(id), `Missing HTML ID: ${id}`);
  return nodes.get(id);
}
for (const match of source.matchAll(/\$\('([^']+)'\)/g)) node(match[1]);
for (const match of html.matchAll(/<form\b[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/form>/g)) {
  node(match[1]).elements = [...match[2].matchAll(/id="([^"]+)"/g)].map(item => node(item[1]));
}

let language = 'zh';
const queue = [], calls = [];
const sandbox = vm.createContext({
  console, DOMException, AbortController, URL, Map, Date, Number, String, Boolean,
  Option: function(text, value) { return {text, value}; },
  document: {getElementById: node, querySelectorAll: () => []},
  window: {
    supabase: {createClient: () => ({})},
    ClubI18n: {t: (key, vars) => `${language}:${key}:${JSON.stringify(vars ?? {})}`, apply() {}, getLang: () => language}
  },
  fetch: async (_url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body);
    assert.equal(options.headers.authorization, 'Bearer mock-token');
    assert(queue.length, `Unmocked request (network forbidden): ${body.action}`);
    const reply = queue.shift();
    assert.equal(body.action, reply.action);
    await reply.beforeReply?.();
    return {ok: reply.status < 400, status: reply.status, json: async () => reply.payload};
  }
});
const start = source.indexOf('const SUPABASE_URL');
const end = source.indexOf("$('refreshQuotaButton').onclick");
assert(start >= 0 && end > start, 'Management function boundaries changed; update the harness');
vm.runInContext(source.slice(start, end), sandbox, {filename: 'chat-admin.js'});
const run = code => vm.runInContext(code, sandbox);
function reply(action, payload, status = 200, beforeReply) { queue.push({action, payload, status, beforeReply}); }
const userId = '11111111-1111-4111-8111-111111111111';
const snapshot = {
  global: {daily_limit: null, version: 1, used: 4, remaining: null, resets_at: '2026-10-17T00:00:00Z'},
  user: {daily_limit: 10, weekly_limit: null, monthly_limit: 0, version: 2},
  periods: ['day', 'week', 'month'].map(period => ({period, limit: 10, used: 4, remaining: 6, resets_at: '2026-10-17T00:00:00Z'})),
  blacklisted: false, reason: ''
};
sandbox.fixture = snapshot;
sandbox.userId = userId;
run(`session = {user:{id:'admin'},access_token:'mock-token'}; authorized = true;
  selectedUser = userId; selectionEpoch = 1;
  const testRun = {epoch,controller:new AbortController()}; active = testRun;`);

reply('admin_user_directory', {users: [{user_id: userId, username: 'alice', member_name: 'Alice', bound: true}], blacklist: []});
reply('admin_quota_get', snapshot);
await run('loadQuotaDirectory(testRun)');
assert.equal(node('quotaUser').options[1].text, 'alice · Alice');
assert.equal(node('quotaUser').options[1].value, userId);
assert.equal(calls[1].user_id, userId);
assert.equal(node('globalDailyLimit').value, '');
assert.equal(node('userMonthlyLimit').value, '0');
assert.equal(node('userWeeklyLimit').value, '');
for (const [raw, expected] of [['', null], ['0', 0], ['1000000000000', 1e12]]) {
  node('userDailyLimit').value = raw;
  assert.equal(run("quotaInput('userDailyLimit')"), expected);
}
for (const raw of ['-1', '1.5', '1000000000001', 'NaN']) {
  node('userDailyLimit').value = raw;
  assert.throws(() => run("quotaInput('userDailyLimit')"), /quota_input/);
}
console.log('PASS directory UUID labels, summaries, null/zero and numeric boundaries');

reply('admin_quota_save', {error: 'conflict'}, 409);
reply('admin_quota_get', {...snapshot, user: {...snapshot.user, daily_limit: 99, version: 3}});
await run("saveQuota(testRun,'userQuotaMessage',userId,1,'admin_quota_save',{user_id:userId,daily_limit:20,expected_version:2})");
assert.equal(run("messages.get('userQuotaMessage').key"), 'quotaConflict');
assert.equal(node('userDailyLimit').value, '99');
assert.equal(calls.filter(item => item.action === 'admin_quota_save').length, 1, 'Conflicts must not retry writes');
console.log('PASS 409 preserves warning, reloads values and never retries a write');

assert.equal(run("errorKey({status:409,message:'busy'})"), 'busy');
assert.equal(run("errorKey({status:409,message:'other'})"), 'requestFailed');
assert.equal(run("errorKey({status:429,message:'quota'})"), 'testQuota');
reply('admin_quota_save', {error: 'busy'}, 409);
await assert.rejects(run("saveQuota(testRun,'userQuotaMessage',userId,1,'admin_quota_save',{user_id:userId})"), /busy/);
assert.equal(queue.length, 0, 'Busy must not trigger a conflict reload');
assert.equal(run("testResultState('incomplete',true)[0]"), 'testQuotaTruncated');
assert.equal(run("testResultState('incomplete',false)[0]"), 'testIncomplete');
assert.equal(run("testResultState('success',true)[0]"), 'testComplete');
reply('admin_quota_get', {...snapshot, user: {...snapshot.user, daily_limit: 99}});
await run('refreshTestQuota(testRun,userId,1)');
assert.equal(calls.at(-1).action, 'admin_quota_get');
assert.equal(calls.at(-1).user_id, userId);
console.log('PASS busy/conflict/quota distinctions, quota truncation state and post-test quota refresh');

reply('admin_quota_save', {...snapshot, global: {...snapshot.global, daily_limit: 0, version: 2}});
await run("saveQuota(testRun,'globalQuotaMessage',userId,1,'admin_quota_save',{user_id:null,daily_limit:0,expected_version:1})");
assert.equal(node('globalDailyLimit').value, '0');
assert.equal(node('userDailyLimit').value, '99', 'Global save must preserve selected-user limits');
assert(!('weekly_limit' in calls.at(-1)) && !('monthly_limit' in calls.at(-1)));
reply('admin_set_blacklist', {...snapshot, blacklisted: true, reason: '<unsafe>'});
await run("saveQuota(testRun,'blacklistMessage',userId,1,'admin_set_blacklist',{user_id:userId,blocked:true,reason:'<unsafe>'})");
assert(node('userBlacklisted').checked);
assert.equal(run('blacklist.length'), 1);
assert(node('blacklistList').innerHTML.includes('&lt;unsafe&gt;'));
reply('admin_set_blacklist', snapshot);
await run("saveQuota(testRun,'blacklistMessage',userId,1,'admin_set_blacklist',{user_id:userId,blocked:false,reason:''})");
assert.equal(run('blacklist.length'), 0);
console.log('PASS global-only save, blacklist add/remove and escaped reason');

node('blacklistReason').value = 'unsaved draft';
node('userDailyLimit').value = '123';
run("setMessage('userQuotaMessage','quotaSaved','success');refreshLocalizedUi()");
const oldSummary = node('userQuotaSummary').innerHTML;
language = 'en';
run('refreshLocalizedUi()');
assert.notEqual(node('userQuotaSummary').innerHTML, oldSummary);
assert(node('userQuotaMessage').textContent.startsWith('en:'));
assert.equal(node('blacklistReason').value, 'unsaved draft');
assert.equal(node('userDailyLimit').value, '123');
console.log('PASS dynamic language refresh preserves unsaved form values');

reply('admin_quota_get', snapshot, 200, () => run("selectedUser='another-user';selectionEpoch++"));
await assert.rejects(run('loadQuota(testRun)'), {name: 'AbortError'});
assert.equal(node('userDailyLimit').value, '123', 'Stale selection must not fill inputs');
run('selectedUser=userId;selectionEpoch=1');
reply('admin_quota_get', snapshot, 200, () => run("selectedUser='another-user';selectionEpoch++"));
await run('refreshTestQuota(testRun,userId,1)');
assert.equal(node('userDailyLimit').value, '123', 'Post-test refresh must keep selection guard');
run('selectedUser=userId;selectionEpoch=1');
reply('admin_set_blacklist', {...snapshot, blacklisted: true}, 200, () => run('epoch++'));
await assert.rejects(run("saveQuota(testRun,'blacklistMessage',userId,1,'admin_set_blacklist',{user_id:userId,blocked:true})"), {name: 'AbortError'});
assert(!node('userBlacklisted').checked, 'Stale auth epoch must not update blacklist');
run('active=null');
console.log('PASS stale selection and auth-epoch responses are discarded');

for (const action of ['test', 'admin_test']) {
  reply(action, {error: 'blacklisted'}, 403);
  await run(`operation('testMessage', run => request(run, '${action}'))`);
  assert(run('authorized'));
  assert.equal(run("messages.get('testMessage').key"), 'testBlacklisted');
}
assert.equal(run('directory.length'), 1);
console.log('PASS blacklisted test 403 keeps administrator management authorized');

reply('admin_quota_get', {error: 'admin'}, 403);
await run("operation('quotaMessage', run => request(run,'admin_quota_get'))");
assert(!run('authorized'));
assert.equal(run('directory.length + blacklist.length'), 0);
assert.equal(run('globalQuota'), null);
assert.equal(run('userQuota'), null);
assert.equal(run('selectedUser'), '');
assert.equal(run('directoryLoaded'), false);
assert.equal(node('blacklistReason').value, '');
assert.equal(node('userDailyLimit').value, '');
assert(node('adminContent').hidden);
assert.equal(run("messages.get('gateMessage').key"), 'unauthorized');
run('authorized=true');
reply('admin_user_directory', {error: 'login'}, 401);
await run("operation('quotaMessage', run => request(run,'admin_user_directory'))");
assert(!run('authorized'));
assert.equal(run("messages.get('gateMessage').key"), 'loginExpired');
assert.equal(queue.length, 0, 'All mocked requests must be consumed');
console.log('PASS management 403/session 401 revoke access and clear sensitive state');
console.log(`Chat admin VM regression passed (${calls.length} mocked requests; zero network or paid calls).`);
