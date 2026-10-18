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
    elements: [], options: [], listeners: {},
    addEventListener(type, handler) { this.listeners[type] = handler; },
    reportValidity() { return true; }, focus() {},
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
  const form = node(match[1]);
  form.elements = [...match[2].matchAll(/id="([^"]+)"/g)].map(item => node(item[1]));
  const defaults = new Map();
  for (const field of match[2].matchAll(/<(input|textarea|select)\b[^>]*id="([^"]+)"[^>]*>(?:([\s\S]*?)<\/\1>)?/g)) {
    const element = node(field[2]);
    const options = [...(field[3] || '').matchAll(/<option\b([^>]*)>([^<]*)<\/option>/g)];
    const selected = options.find(option => /\bselected\b/.test(option[1])) || options[0];
    const value = selected ? /value="([^"]*)"/.exec(selected[1])?.[1] || '' : /\bvalue="([^"]*)"/.exec(field[0])?.[1] || '';
    const checked = /\bchecked\b/.test(field[0]);
    element.options = options.map(option => ({text: option[2], value: /value="([^"]*)"/.exec(option[1])?.[1] || ''}));
    defaults.set(element, {value, checked});
  }
  form.reset = () => { for (const [element, initial] of defaults) Object.assign(element, initial); };
  form.reset();
}

const actionNodes = new Map();
function proxyActionNodes(selector) {
  const attributes = [...selector.matchAll(/\[(data-proxy-[\w-]+)\]/g)].map(match => match[1]);
  const result = [];
  for (const id of ['proxyRoutesList', 'proxyKeysList']) {
    for (const match of node(id).innerHTML.matchAll(/<button\b[^>]*\b(data-proxy-[\w-]+)="([^"]+)"[^>]*>/g)) {
      if (!attributes.includes(match[1])) continue;
      const key = `${match[1]}:${match[2]}`;
      if (!actionNodes.has(key)) actionNodes.set(key, {disabled: false});
      result.push(actionNodes.get(key));
    }
  }
  return result;
}
let language = 'zh', confirmResult = true;
const confirmations = [], clipboard = [];
const queue = [], calls = [];
const windowListeners = new Map(), scheduledRefreshes = [];
const sandbox = vm.createContext({
  console, DOMException, AbortController, URL, Map, Date, Number, String, Boolean,
  setTimeout: callback => { scheduledRefreshes.push(callback); },
  Option: function(text, value) { return {text, value}; },
  document: {getElementById: node, querySelectorAll: proxyActionNodes},
  navigator: {clipboard: {writeText: async value => { clipboard.push(value); }}},
  window: {
    confirm: message => { confirmations.push(message); return confirmResult; },
    addEventListener: (type, handler) => { windowListeners.set(type, handler); },
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
// Bind the real proxy handlers without running auth startup or unrelated handlers.
const proxyHandlersStart = source.indexOf("$('refreshProxyButton').onclick");
const proxyHandlersEnd = source.indexOf("$('quotaUserForm').addEventListener");
run(source.slice(proxyHandlersStart, proxyHandlersEnd));
const route = {id: '22222222-2222-4222-8222-222222222222', name: '<route>', base_url: 'https://example.com/v1', secret_name: 'CHAT_KEY_TEST', enabled: true, version: 1, created_at: '2026-10-16T00:00:00Z', updated_at: '2026-10-16T00:00:00Z'};
const key = {id: '33333333-3333-4333-8333-333333333333', route_id: route.id, label: '<access>', key_prefix: 'test-prefix', key_last4: '1234', enabled: true, revoked_at: null, version: 1, created_at: route.created_at};
sandbox.routeFixture = route; sandbox.keyFixture = key;
run("authorized=true;active=null;const proxyRun={epoch,controller:new AbortController()};active=proxyRun");
reply('admin_proxy_list', {routes: [route], keys: [{...key, api_key: 'MUST_NOT_RETAIN', key_hash: 'HASH_MUST_NOT_RETAIN'}]});
await run('loadProxy(proxyRun)');
assert.deepEqual(calls.at(-1), {action: 'admin_proxy_list'});
assert.equal(run('JSON.stringify(proxyKeys).includes("MUST_NOT_RETAIN")'), false);
assert(node('proxyRoutesList').innerHTML.includes('&lt;route&gt;'));
run('fillProxyRoute(routeFixture)');
assert.equal(run('proxyRouteInput().expected_version'), 1);
for (const url of ['https://example.com/response', 'https://example.com/responses/v1', 'https://example.com/%72esponses', 'https://example.com/v1/messages/extra', 'https://example.com/v1/chat/completions/extra', 'http://example.com/v1', 'https://x:y@example.com/v1', 'https://example.com/v1?q=1', 'https://example.com:8443/v1']) {
  node('proxyBaseUrl').value = url;
  assert.throws(() => run('proxyRouteInput()'), /proxy_url/);
}
for (const endpoint of ['', '/v1', '/v1/responses', '/v1/messages', '/v1/message', '/v1/chat/completions', '/messages', '/chat/completions']) {
  const url = 'https://example.com' + endpoint;
  node('proxyBaseUrl').value = url;
  assert.equal(run('proxyRouteInput().base_url'),url,'proxy route endpoint remains in metadata');
  assert.equal(run(`validProviderUrl(${JSON.stringify(url)}).href`),new URL(url).href,'provider endpoint is accepted by the same validator');
}
node('proxyBaseUrl').value = route.base_url;
node('proxySecretName').value = 'sk-real-key';
assert.throws(() => run('proxyRouteInput()'), /secret_name/);
node('proxySecretName').value = route.secret_name;
reply('admin_proxy_save', {route: {...route, version: 2}});
await run("proxyMutation(proxyRun,'admin_proxy_save',proxyRouteInput())");
assert.equal(calls.at(-1).expected_version, 1);
assert.equal(run('proxyEditingVersion'), 0);
assert.equal(node('proxyRouteId').value, '');
run('clearProxyRoute()'); node('proxyRouteName').value = 'New'; node('proxyBaseUrl').value = route.base_url; node('proxySecretName').value = route.secret_name;
assert.equal(run('proxyRouteInput().id'), null);
assert.equal(run('proxyRouteInput().expected_version'), 0);
reply('admin_proxy_route_state', {route: {...route, enabled: false, version: 3}});
await run("proxyMutation(proxyRun,'admin_proxy_route_state',{id:routeFixture.id,enabled:false,expected_version:2})");
assert.equal(run('proxyRoutes[0].enabled'), false);
  run('fillProxyRoute(proxyRoutes[0])');
  reply('admin_proxy_save', {error: 'conflict'}, 409);
  reply('admin_proxy_list', {routes: [{...route, version: 4, name: 'Server changed'}], keys: [key]});
  const writesBefore = calls.filter(item => item.action === 'admin_proxy_save').length;
  await run("proxyMutation(proxyRun,'admin_proxy_save',proxyRouteInput())");
  assert.equal(calls.filter(item => item.action === 'admin_proxy_save').length, writesBefore + 1);
  assert.equal(run('proxyEditingVersion'), 4);
  assert.equal(node('proxyRouteName').value, 'Server changed');
  assert.equal(run("messages.get('proxyMessage').key"), 'proxyConflict');
console.log('PASS proxy safe metadata, escaped routes, base/secret validation, create/edit/state and conflict reload without retry');

for (const [id, plaintext] of [[key.id, 'MOCK_ONE_TIME_1'], ['44444444-4444-4444-8444-444444444444', 'MOCK_ONE_TIME_2']]) {
  reply('admin_proxy_key_create', {key: {...key, id}, api_key: plaintext});
  await run(`proxyMutation(proxyRun,'admin_proxy_key_create',{route_id:routeFixture.id,label:'access'})`);
  assert.equal(node('proxyOneTimeKey').textContent, plaintext);
  assert.equal(node('proxyOneTimePanel').hidden, false);
  assert(!node('proxyKeysList').innerHTML.includes(plaintext));
  assert(!node('proxyExample').textContent.includes(plaintext));
}
assert.equal(run('proxyKeys.length'), 2, 'Multiple keys per route must be retained');
node('proxyKeyRoute').value = route.id;
node('proxyKeyLabel').value = 'unsaved label';
node('proxyRouteName').value = 'unsaved route';
const priorProxyLanguage = node('proxyKeysList').innerHTML;
language = language === 'en' ? 'zh' : 'en';
run("setMessage('proxyMessage','proxySaved','success');refreshLocalizedUi()");
assert.notEqual(node('proxyKeysList').innerHTML, priorProxyLanguage);
assert.equal(node('proxyKeyLabel').value, 'unsaved label');
assert.equal(node('proxyRouteName').value, 'unsaved route');
assert.equal(node('proxyKeyRoute').value, route.id);
assert.equal(node('proxyOneTimeKey').textContent, 'MOCK_ONE_TIME_2');
assert(node('proxyMessage').textContent.startsWith(language + ':'));
reply('admin_proxy_key_state', {error: 'conflict'}, 409);
reply('admin_proxy_list', {routes: [{...route, version: 4}], keys: [key, {...key, id: '44444444-4444-4444-8444-444444444444'}]});
await run("proxyMutation(proxyRun,'admin_proxy_key_state',{id:keyFixture.id,enabled:false,revoked:false,expected_version:1})");
assert.equal(run("messages.get('proxyMessage').key"), 'proxyConflict');
assert.equal(calls.at(-1).action, 'admin_proxy_list');
assert.equal(node('proxyOneTimeKey').textContent, 'MOCK_ONE_TIME_2');
assert.equal(queue.length, 0);
await run('copyProxyPlaintext()');
assert.deepEqual(clipboard, ['MOCK_ONE_TIME_2']);
run('clearProxyPlaintext()');
assert.equal(run('proxyPlaintext'), ''); assert.equal(node('proxyOneTimeKey').textContent, ''); assert(node('proxyOneTimePanel').hidden);
node('proxyKeyRoute').value = route.id;
run('renderProxyExample()');
assert(node('proxyExample').textContent.includes(`/functions/v1/chat-api-proxy/${route.id}/v1`));
assert(node('proxyExample').textContent.includes('<YOUR_PROXY_API_KEY>'));
assert(node('proxyExample').textContent.includes('"method": "POST"'));
// Exercise real event handlers, including confirmation cancellation and irreversible state.
run('active=null');
function keyClick(dataset) { node('proxyKeysList').listeners.click({target: {closest: () => ({dataset})}}); }
confirmResult = false;
const beforeCancel = calls.length;
keyClick({proxyKeyRevoke: key.id});
assert.equal(calls.length, beforeCancel);
assert(confirmations.at(-1).includes('proxyRevokeConfirm'));
confirmResult = true;
reply('admin_proxy_key_state', {key: {...key, enabled: false, version: 2}});
keyClick({proxyKeyState: key.id});
while (run('Boolean(active)')) await new Promise(resolve => setTimeout(resolve, 0));
assert.deepEqual(calls.at(-1), {action: 'admin_proxy_key_state', id: key.id, enabled: false, revoked: false, expected_version: 1});
reply('admin_proxy_key_state', {key: {...key, enabled: false, revoked_at: route.created_at, version: 3}});
keyClick({proxyKeyRevoke: key.id});
while (run('Boolean(active)')) await new Promise(resolve => setTimeout(resolve, 0));
assert.deepEqual(calls.at(-1), {action: 'admin_proxy_key_state', id: key.id, enabled: false, revoked: true, expected_version: 2});
const afterRevoke = calls.length;
keyClick({proxyKeyState: key.id}); assert.equal(calls.length, afterRevoke, 'Revoked key cannot be enabled');
assert(node('proxyKeysList').innerHTML.includes('proxyRevoked'));
console.log('PASS multi-key issuance, one-time copy/clear, placeholder-only examples, state and irreversible revoke confirmation');

// Run the actual account-change function (not an approximation) for signout/switch.
const sessionStart = source.indexOf('function updateSession(next)');
const sessionEnd = source.indexOf('// Process account changes immediately');
run(source.slice(sessionStart, sessionEnd));
run('active=proxyRun');
reply('admin_proxy_key_create', {key, api_key: 'STALE_KEY'}, 200, () => run('updateSession(null)'));
await assert.rejects(run("proxyMutation(proxyRun,'admin_proxy_key_create',{route_id:routeFixture.id,label:'stale'})"), {name: 'AbortError'});
assert.equal(run('proxyPlaintext'), ''); assert.equal(node('proxyOneTimeKey').textContent, ''); assert.equal(run('proxyKeys.length'), 0);
run("session={user:{id:'old'},access_token:'mock-token'};authorized=true;proxyPlaintext='OLD_KEY';$('proxyOneTimeKey').textContent=proxyPlaintext;active=null");
reply('admin_get', {authorized: false});
run("updateSession({user:{id:'new'},access_token:'mock-token'})");
assert.equal(run('proxyPlaintext'), '', 'Account switch immediately clears memory');
assert.equal(node('proxyOneTimeKey').textContent, '', 'Account switch immediately clears DOM');
while (run('Boolean(active)')) await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(queue.length, 0);
assert(!/localStorage|indexedDB|console\.(?:log|debug|info)/.test(source), 'No key persistence or logging');
console.log('PASS real signout/account switch clears memory and DOM; late issuance cannot restore plaintext');
// Permanent deletion uses the real delegated handlers and never contacts a server.
function routeClick(dataset) { node('proxyRoutesList').listeners.click({target: {closest: () => ({dataset})}}); }
async function settleProxy() {
  while (run('Boolean(active)')) await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(queue.length, 0, 'Every queued response must be consumed');
}
const tombstone = {...route, enabled: false, deleted_at: route.created_at, version: 7};
const revokedKey = {...key, enabled: false, revoked_at: route.created_at, version: 5};
const otherRoute = {...route, id: 'other-route', name: 'Other route'};
const otherKey = {...key, id: 'other-key', route_id: otherRoute.id};
const disabledRoute = {...route, id: 'disabled-route', enabled: false};
const disabledKey = {...key, id: 'disabled-key', enabled: false};
sandbox.tombstone = tombstone; sandbox.revokedKey = revokedKey;
sandbox.otherRoute = otherRoute; sandbox.otherKey = otherKey;
sandbox.disabledRoute = disabledRoute; sandbox.disabledKey = disabledKey;
function seedDeletion() {
  run(`session={user:{id:'admin'},access_token:'mock-token'};authorized=true;active=null;
    proxyRoutes=[tombstone,otherRoute,disabledRoute];proxyKeys=[revokedKey,otherKey,disabledKey];proxyLoaded=true;
    renderProxy();controls()`);
}
seedDeletion();
assert(node('proxyRoutesList').innerHTML.includes(`data-proxy-route-hard-delete="${route.id}"`));
assert(node('proxyKeysList').innerHTML.includes(`data-proxy-key-hard-delete="${key.id}"`));
for (const id of [otherRoute.id, disabledRoute.id]) {
  assert(!node('proxyRoutesList').innerHTML.includes(`data-proxy-route-hard-delete="${id}"`));
  assert(node('proxyRoutesList').innerHTML.includes(`data-proxy-route-delete="${id}"`));
}
for (const id of [otherKey.id, disabledKey.id]) assert(!node('proxyKeysList').innerHTML.includes(`data-proxy-key-hard-delete="${id}"`));
assert(!node('proxyRoutesList').innerHTML.includes(`data-proxy-edit="${route.id}"`));
assert(!node('proxyKeysList').innerHTML.includes(`data-proxy-key-state="${key.id}"`));
const beforeIneligible = [calls.length, confirmations.length];
for (const id of [otherRoute.id, disabledRoute.id, 'missing']) routeClick({proxyRouteHardDelete: id});
for (const id of [otherKey.id, disabledKey.id, 'missing']) keyClick({proxyKeyHardDelete: id});
routeClick({proxyEdit: route.id}); routeClick({proxyRouteState: route.id}); routeClick({proxyRouteDelete: route.id});
keyClick({proxyKeyRevoke: key.id});
assert.deepEqual([calls.length, confirmations.length], beforeIneligible, 'Ineligible and obsolete actions must be guarded before confirmation');
confirmResult = false;
routeClick({proxyRouteHardDelete: route.id}); keyClick({proxyKeyHardDelete: key.id});
assert.equal(calls.length, beforeIneligible[0], 'Cancellation must not write or reload');
assert(confirmations.at(-2).includes('proxyHardDeleteRouteConfirm') && confirmations.at(-2).includes(route.name));
assert(confirmations.at(-1).includes('proxyHardDeleteKeyConfirm') && confirmations.at(-1).includes(key.label));
confirmResult = true;
run('authorized=false;controls()');
assert([...actionNodes.values()].every(item => item.disabled), 'Unauthorized action buttons must be disabled');
const beforeUnauthorized = confirmations.length;
routeClick({proxyRouteHardDelete: route.id}); keyClick({proxyKeyHardDelete: key.id});
assert.equal(confirmations.length, beforeUnauthorized);
run('authorized=true;controls();fillProxyRoute(otherRoute)');
reply('admin_proxy_key_hard_delete', {deleted_key_id: key.id}, 200, () => {
  assert.equal(actionNodes.get(`data-proxy-key-hard-delete:${key.id}`).disabled, true);
  assert.equal(actionNodes.get(`data-proxy-route-hard-delete:${route.id}`).disabled, true);
  assert.equal(actionNodes.get(`data-proxy-route-delete:${disabledRoute.id}`).disabled, true);
  const beforeBusy = [calls.length, confirmations.length];
  keyClick({proxyKeyHardDelete: key.id}); routeClick({proxyRouteHardDelete: route.id});
  assert.deepEqual([calls.length, confirmations.length], beforeBusy, 'Busy guard blocks duplicate actions');
});
keyClick({proxyKeyHardDelete: key.id}); await settleProxy();
assert.deepEqual(calls.at(-1), {action: 'admin_proxy_key_hard_delete', id: key.id, expected_version: revokedKey.version});
assert.equal(run('proxyKeys.length'), 2);
assert(!node('proxyKeysList').innerHTML.includes(key.id));
assert.equal(node('proxyRouteId').value, otherRoute.id, 'Key removal preserves route editor');
assert.equal(run("messages.get('proxyMessage').key"), 'proxyHardDeleteKeySuccess');
const previousLanguage = language;
language = 'en'; run('refreshLocalizedUi()');
assert(node('proxyMessage').textContent.startsWith('en:chatAdmin.proxyHardDeleteKeySuccess'));
language = previousLanguage;
run('proxyKeys=[revokedKey,otherKey,disabledKey];fillProxyRoute(tombstone)');
node('proxyKeyRoute').value = route.id;
reply('admin_proxy_route_hard_delete', {deleted_route_id: route.id});
routeClick({proxyRouteHardDelete: route.id}); await settleProxy();
assert.deepEqual(calls.at(-1), {action: 'admin_proxy_route_hard_delete', id: route.id, expected_version: tombstone.version});
assert.equal(run('proxyRoutes.length'), 2);
assert.equal(run('proxyKeys.length'), 1, 'Route removal must remove all associated keys, including unrevoked ones');
assert.equal(run('proxyKeys[0].id'), otherKey.id);
assert(!node('proxyRoutesList').innerHTML.includes(route.id));
assert(!node('proxyKeysList').innerHTML.includes(key.id));
assert.equal(node('proxyRouteId').value, ''); assert.equal(run('proxyEditingVersion'), 0);
assert.equal(node('proxyKeyRoute').value, '');
assert.equal(run("messages.get('proxyMessage').key"), 'proxyHardDeleteRouteSuccess');
console.log('PASS permanent deletion eligibility, cancellation, versioned payloads, busy/authorization guards, list cascade and editor reset');

// The original route delete is still a tombstone write, followed by a list reload.
seedDeletion();
run('proxyRoutes=[otherRoute];proxyKeys=[otherKey];fillProxyRoute(otherRoute);renderProxy()');
node('proxyKeyRoute').value = otherRoute.id;
reply('admin_proxy_route_delete', {route: {...otherRoute, enabled: false, deleted_at: route.created_at, version: 2}});
reply('admin_proxy_list', {routes: [{...otherRoute, enabled: false, deleted_at: route.created_at, version: 2}], keys: [{...otherKey, enabled: false, revoked_at: route.created_at, version: 2}]});
routeClick({proxyRouteDelete: otherRoute.id}); await settleProxy();
assert.deepEqual(calls.at(-2), {action: 'admin_proxy_route_delete', id: otherRoute.id, expected_version: otherRoute.version});
assert.equal(calls.at(-1).action, 'admin_proxy_list');
assert.equal(run('proxyRoutes.length'), 1); assert.equal(run('proxyKeys.length'), 1);
assert.equal(node('proxyRouteId').value, ''); assert.equal(node('proxyKeyRoute').value, '');
assert(node('proxyRoutesList').innerHTML.includes(`data-proxy-route-hard-delete="${otherRoute.id}"`));
assert(node('proxyKeysList').innerHTML.includes(`data-proxy-key-hard-delete="${otherKey.id}"`));
assert.equal(run("messages.get('proxyMessage').key"), 'proxyDeleteSuccess');
console.log('PASS original route deletion retains tombstone and revoked records after reloading');

for (const kind of ['route', 'key']) {
  const action = `admin_proxy_${kind}_hard_delete`;
  const click = () => kind === 'route' ? routeClick({proxyRouteHardDelete: route.id}) : keyClick({proxyKeyHardDelete: key.id});
  for (const code of ['conflict', 'not_revoked']) {
    seedDeletion(); run('fillProxyRoute(tombstone)');
    const before = calls.length;
    reply(action, {error: code}, 409);
    reply('admin_proxy_list', {routes: [route, otherRoute], keys: [key, otherKey]});
    click(); await settleProxy();
    assert.deepEqual(calls.slice(before).map(item => item.action), [action, 'admin_proxy_list'], '409 reloads exactly once and never retries');
    assert.equal(run("messages.get('proxyMessage').key"), code === 'conflict' ? 'proxyConflict' : 'proxyNotRevoked');
    assert.equal(run("messages.get('proxyMessage').type"), 'warning');
    assert.equal(node('proxyRouteId').value, route.id); assert.equal(run('proxyEditingVersion'), route.version);
    assert(!node('proxyRoutesList').innerHTML.includes('data-proxy-route-hard-delete'));
    assert(!node('proxyKeysList').innerHTML.includes('data-proxy-key-hard-delete'));
    const reloadedMessage = node('proxyMessage').textContent;
    language = language === 'en' ? 'zh' : 'en'; run('refreshLocalizedUi()');
    assert.notEqual(node('proxyMessage').textContent, reloadedMessage);
    assert.equal(run('proxyRoutes.length'), 2); assert.equal(run('proxyKeys.length'), 2);
  }
  // A server reload may show that the edited tombstone is gone or still deleted.
  seedDeletion(); run('fillProxyRoute(tombstone)');
  reply(action, {error: 'conflict'}, 409);
  reply('admin_proxy_list', {routes: kind === 'route' ? [] : [tombstone], keys: []});
  click(); await settleProxy();
  assert.equal(node('proxyRouteId').value, ''); assert.equal(run('proxyEditingVersion'), 0);

  // Signout while the mutation or its conflict reload is pending must not restore rows/messages.
  for (const staleAt of ['mutation', 'reload']) {
    seedDeletion();
    const before = calls.length;
    if (staleAt === 'mutation') {
      reply(action, kind === 'route' ? {deleted_route_id: route.id} : {deleted_key_id: key.id}, 200, () => run('updateSession(null)'));
    } else {
      reply(action, {error: 'conflict'}, 409);
      reply('admin_proxy_list', {routes: [tombstone], keys: [revokedKey]}, 200, () => run('updateSession(null)'));
    }
    click(); await settleProxy();
    assert.equal(calls.length - before, staleAt === 'mutation' ? 1 : 2);
    assert.equal(run('proxyRoutes.length + proxyKeys.length'), 0);
    assert.equal(node('proxyRouteId').value, '');
    assert.equal(run("messages.get('proxyMessage').key"), '', 'Stale operations must not display success or conflict messages');
    assert.equal(run('authorized'), false);
  }
}
console.log('PASS both permanent-delete actions reload conflicts/eligibility failures without retries and discard stale mutation/reload responses');

// Verify the actual bilingual copy and that every frontend translation key exists.
let dictionaries;
vm.runInNewContext(await readFile(new URL('chat-admin-i18n.js', publicUrl), 'utf8'), {
  window: {ClubI18n: {mergeDict: value => { dictionaries = value; }}}
});
const usedProxyKeys = new Set([...source.matchAll(/['"](proxy[A-Z]\w*)['"]/g)].map(match => match[1]).filter(key => !nodes.has(key)));
for (const lang of ['zh', 'en']) {
  const dict = dictionaries[lang].chatAdmin;
  for (const key of usedProxyKeys) assert.equal(typeof dict[key], 'string', `${lang} is missing ${key}`);
  assert(dict.proxyHardDeleteRouteConfirm.includes('{name}'));
  assert(dict.proxyHardDeleteKeyConfirm.includes('{label}'));
  assert.match(dict.proxyDeleteConfirm, /撤销路由|Revoke route/);
  assert.match(dict.proxyDeleteConfirm, /记录仍保留|records are retained/);
  assert.match(dict.proxyRevokeConfirm, /记录仍保留|record is retained/);
  assert.match(dict.proxyHardDeleteRouteConfirm, /永久移除|permanently removed/);
  assert.match(dict.proxyHardDeleteRouteConfirm, /全部关联密钥|all associated key/);
  assert.match(dict.proxyHardDeleteKeyConfirm, /永久移除|permanently removed/);
  assert(!/墓碑|物理|tombstone|physically/i.test(Object.values(dict).filter(value => typeof value === 'string').join(' ')));
}
assert.equal(dictionaries.zh.chatAdmin.proxyDelete, '撤销路由');
assert.equal(dictionaries.zh.chatAdmin.proxyDeleted, '已撤销（记录保留）');
assert.equal(dictionaries.zh.chatAdmin.proxyHardDeleteRoute, '彻底删除路由');
assert.equal(dictionaries.zh.chatAdmin.proxyHardDeleteKey, '彻底删除密钥');
assert.equal(dictionaries.en.chatAdmin.proxyDelete, 'Revoke route');
assert.equal(dictionaries.en.chatAdmin.proxyDeleted, 'Revoked (record retained)');
assert.equal(dictionaries.en.chatAdmin.proxyHardDeleteRoute, 'Permanently delete route');
assert.equal(dictionaries.en.chatAdmin.proxyHardDeleteKey, 'Permanently delete key');
console.log('PASS bilingual revoke/permanent-removal copy, confirmation variables and proxy translation coverage');
// 删除供应商/模型：确认取消不请求、确认后带正确参数、墓碑后列表刷新。
{
  run("session={user:{id:'admin'},access_token:'mock-token'}; active=null; authorized=true");
  const providerFixture = {id: '22222222-2222-4222-8222-222222222222', name: 'mockprov', label: 'Mock', base_url: 'https://mock.example.com/v1', secret_name: 'CHAT_KEY_MOCK', auth_header: 'authorization', enabled: true};
  const modelA = {id: '33333333-3333-4333-8333-333333333333', provider_id: providerFixture.id, model_key: 'm-a', display_name: 'Model A', introduction: null, context_window: 8192, max_output_tokens: 1024, default_max_output_tokens: 512, reasoning_efforts: [], default_reasoning_effort: null, supports_images: false, supports_pdf: false, preserve_reasoning: false, enabled: true, visibility: 'all', updated_at: '2026-01-01T00:00:00.000Z', version: Date.parse('2026-01-01T00:00:00.000Z')};
  const modelB = {...modelA, id: '44444444-4444-4444-8444-444444444444', model_key: 'm-b', display_name: 'Model B'};
  sandbox.providerFixture = providerFixture; sandbox.modelA = modelA; sandbox.modelB = modelB;
  // providers/models 是脚本内的 let 绑定，必须通过 run() 赋值，直接写 sandbox 覆盖不到。
  run('providers = [providerFixture]; models = [modelA, modelB]; renderProviders(); renderModels();');
  assert(node('providersList').innerHTML.includes(`data-delete-provider="${providerFixture.id}"`), 'provider row must expose a delete button');
  assert(node('modelsList').innerHTML.includes(`data-delete-model="${modelA.id}"`), 'model row must expose a delete button');

  // 列表监听器注册在脚本后半段（测试只求值配置区），这里直接调用同名处理函数。
  // 取消确认：不应发出任何请求。
  const beforeCancel = calls.length;
  confirmResult = false;
  await run('removeProvider(providerFixture)');
  await run('removeModel(modelA)');
  assert.equal(calls.length, beforeCancel, 'cancelling the confirmation must not call the backend');
  assert(confirmations.at(-2).includes('providerDeleteConfirm'));
  assert(confirmations.at(-1).includes('modelDeleteConfirm'));

  // 删除模型：使用列表里的 version，并在成功后刷新列表。
  confirmResult = true;
  reply('admin_delete_model', {result: {deleted: true, id: modelA.id}}, 200);
  reply('admin_get', {providers: [providerFixture], models: [modelB]});
  reply('admin_proxy_list', {routes: [], keys: []});
  await run('removeModel(modelA)');
  while (run('Boolean(active)')) await new Promise(resolve => setTimeout(resolve, 0));
  const deleteCall = calls.find(call => call.action === 'admin_delete_model');
  assert.deepEqual(JSON.parse(JSON.stringify(deleteCall)), {action: 'admin_delete_model', id: modelA.id, expected_version: modelA.version});
  assert.equal(run("messages.get('modelMessage').key"), 'modelDeleted');

  // 删除供应商：成功后列表为空，并清空正在编辑的表单。
  reply('admin_delete_provider', {result: {deleted: true, id: providerFixture.id, models: 1}}, 200);
  reply('admin_get', {providers: [], models: []});
  reply('admin_proxy_list', {routes: [], keys: []});
  run(`document.getElementById('providerId').value = ${JSON.stringify(providerFixture.id)}`);
  await run('removeProvider(providerFixture)');
  while (run('Boolean(active)')) await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(JSON.parse(JSON.stringify(calls.find(call => call.action === 'admin_delete_provider'))), {action: 'admin_delete_provider', id: providerFixture.id});
  assert.equal(run("messages.get('providerMessage').key"), 'providerDeleted');
  assert.equal(node('providerId').value, '', 'deleting the provider being edited must clear the form');
  assert(node('providersList').innerHTML.includes('noProvider'));
  // 本块用独立 run 执行，结束时把后续用例依赖的状态恢复原样。
  run('active=null; authorized=true; selectedUser=userId; selectionEpoch=1');
}
console.log('PASS provider/model deletion: confirmation, versioned request, list refresh and empty state');
// Protocol controls use the real edit/save/reset and language-change handlers.
{
  const handlersStart = source.indexOf("$('providersList').addEventListener");
  const handlersEnd = source.indexOf("$('testForm').addEventListener");
  assert(handlersStart >= 0 && handlersEnd > handlersStart);
  run(source.slice(handlersStart, handlersEnd));
  sandbox.window.ClubI18n.mountSwitcher = () => {};
  run(source.slice(source.indexOf("$('clearProviderButton').onclick"), source.indexOf('function updateSession(next)')));
  assert.equal(scheduledRefreshes.length, 1, 'Delayed i18n boot must schedule a refresh');
  const translatedCopy = new Map();
  sandbox.window.ClubI18n.t = (key, vars = {}) => {
    const text = key.split('.').reduce((value, part) => value?.[part], dictionaries[language]);
    assert.equal(typeof text, 'string', `Missing ${language} translation: ${key}`);
    return text.replace(/\{(\w+)\}/g, (_match, name) => vars[name] ?? `{${name}}`);
  };
  sandbox.window.ClubI18n.apply = () => {
    for (const match of html.matchAll(/data-i18n="(chatAdmin\.[^"]+)"/g)) translatedCopy.set(match[1], sandbox.window.ClubI18n.t(match[1]));
    const protocolSelect = /<select\b[^>]*id="providerApiProtocol"[^>]*>([\s\S]*?)<\/select>/.exec(html);
    assert(protocolSelect);
    const optionKeys = [...protocolSelect[1].matchAll(/data-i18n="([^"]+)"/g)].map(match => match[1]);
    node('providerApiProtocol').options.forEach((option, index) => { option.text = sandbox.window.ClubI18n.t(optionKeys[index]); });
    node('providerBaseUrl').title = sandbox.window.ClubI18n.t('chatAdmin.baseUrlHelp');
    for (const id of ['providerApiProtocolHelp', 'modelApiProtocolHelp']) {
      const tag = [...html.matchAll(/<p\b[^>]*id="([^"]+)"[^>]*data-i18n="([^"]+)"/g)].find(match => match[1] === id);
      assert(tag, `Help must be linked to a translation: ${id}`);
      node(id).textContent = sandbox.window.ClubI18n.t(tag[2]);
    }
  };
  const provider = {id: 'protocol-provider', name: 'protocol-test', label: 'Protocol test', base_url: 'https://example.com/v1/messages', secret_name: 'CHAT_KEY_TEST', auth_header: 'x-api-key', enabled: true};
  const model = {id: 'protocol-model', provider_id: provider.id, model_key: 'test-model', display_name: 'Test model', introduction: 'Keep this draft', context_window: 8192, max_output_tokens: 8192, default_max_output_tokens: 4096, reasoning_efforts: ['low', 'high'], default_reasoning_effort: 'high', preserve_reasoning: true, supports_images: true, supports_pdf: false, enabled: true};
  sandbox.protocolProvider = provider; sandbox.protocolModel = model;
  run("session={user:{id:'admin'},access_token:'mock-token'};authorized=true;active=null;providers=[protocolProvider];models=[protocolModel];clearProvider();renderProviders();renderModels()");
  const providerClick = () => node('providersList').listeners.click({target: {closest: selector => selector === '[data-edit-provider]' ? {dataset: {editProvider: provider.id}} : null}});
  const modelClick = () => node('modelsList').listeners.click({target: {closest: selector => selector === '[data-edit-model]' ? {dataset: {editModel: model.id}} : null}});
  const submit = id => node(id).listeners.submit({preventDefault() {}});
  function refreshReplies(savedProvider = provider) {
    reply('admin_get', {providers: [savedProvider], models: [model]});
    reply('admin_proxy_list', {routes: [], keys: []});
    reply('admin_user_directory', {users: [], blacklist: []});
    reply('admin_quota_get', snapshot);
    reply('usage', {rows: [], total: 0});
  }
  assert.deepEqual(node('providerApiProtocol').options.map(option => option.value), ['auto', 'responses', 'messages', 'chat']);
  assert.equal(node('providerApiProtocol').value, 'auto');
  assert.match(html, /providerApiProtocol"[^>]*aria-describedby="providerApiProtocolHelp"/);
  assert.match(html, /modelProvider"[^>]*aria-describedby="modelApiProtocolHelp"/);
  assert(!/id="modelApiProtocol"/.test(html), 'Protocol belongs to suppliers, not individual models');
  providerClick();
  assert.equal(node('providerApiProtocol').value, 'auto', 'Legacy missing protocol must edit as Auto');
  for (const legacy of [null, '', 'invalid']) {
    sandbox.legacyProtocol = legacy;
    run('providers=[{...protocolProvider,api_protocol:legacyProtocol}]');
    providerClick(); assert.equal(node('providerApiProtocol').value, 'auto');
  }
  modelClick();
  node('modelIntroduction').value = 'Unsaved model introduction';
  node('reasoningEfforts').value = 'low,high';
  const reasoningDraft = () => [node('reasoningEfforts').value, node('defaultReasoning').value, node('preserveReasoning').checked];
  const originalReasoning = reasoningDraft();
  scheduledRefreshes[0]();
  for (const protocol of ['auto', 'responses', 'messages', 'chat']) {
    sandbox.chosenProtocol = protocol;
    run('providers=[{...protocolProvider,api_protocol:chosenProtocol}];renderProviders()');
    providerClick();
    assert.equal(node('providerApiProtocol').value, protocol);
    assert(node('providersList').innerHTML.includes(dictionaries[language].chatAdmin[run('API_PROTOCOL_LABELS[chosenProtocol]')]), 'Protocol column must show the saved selection');
    node('providerLabel').value = 'Unsaved provider label';
    node('providerBaseUrl').value = protocol === 'messages' ? 'https://example.com/v1/chat/completions' : provider.base_url;
    const urlDraft = node('providerBaseUrl').value;
    const beforeLanguage = calls.length;
    for (const lang of ['zh', 'en']) {
      language = lang;
      windowListeners.get('club:langchange')();
      assert.equal(calls.length, beforeLanguage, 'Language changes must not request or save data');
      assert.equal(node('providerApiProtocol').value, protocol);
      assert.equal(node('providerLabel').value, 'Unsaved provider label');
      assert.equal(node('providerBaseUrl').value, urlDraft);
      assert.equal(node('providerAuthHeader').value, 'x-api-key');
      assert.equal(node('modelIntroduction').value, 'Unsaved model introduction');
      assert.deepEqual(reasoningDraft(), originalReasoning);
      assert.equal(node('providerApiProtocol').options[0].text, dictionaries[lang].chatAdmin.apiProtocolAuto);
      assert.equal(translatedCopy.get('chatAdmin.apiProtocol'), dictionaries[lang].chatAdmin.apiProtocol);
      assert.equal(node('providerApiProtocolHelp').textContent, dictionaries[lang].chatAdmin.apiProtocolHelp);
      assert.equal(node('modelApiProtocolHelp').textContent, dictionaries[lang].chatAdmin.modelApiProtocolHelp);
      assert.equal(node('providerBaseUrl').title, dictionaries[lang].chatAdmin.baseUrlHelp);
    }
    const savedProvider = {...provider, label: 'Unsaved provider label', base_url: urlDraft, api_protocol: protocol};
    const beforeSave = calls.length;
    reply('save_provider', {}); refreshReplies(savedProvider);
    submit('providerForm'); await settleProxy();
    assert.deepEqual(calls[beforeSave], {action: 'save_provider', ...savedProvider}, 'Chosen protocol is sent unchanged with the original URL and auth header');
    assert.equal(node('providerApiProtocol').value, 'auto', 'Successful save resets protocol');
    assert.equal(node('providerId').value, '');
    assert.equal(run('providers[0].api_protocol'), protocol);
    assert.deepEqual(reasoningDraft(), originalReasoning, 'Saving a supplier must preserve model reasoning drafts');
  }
  providerClick();
  node('providerApiProtocol').value = 'invalid';
  const beforeInvalid = calls.length;
  submit('providerForm');
  assert.equal(calls.length, beforeInvalid, 'Invalid enum must be rejected before requesting');
  assert.equal(run("messages.get('providerMessage').key"), 'invalidApiProtocol');
  node('providerApiProtocol').value = 'messages';
  node('clearProviderButton').onclick();
  assert.equal(node('providerApiProtocol').value, 'auto');
  assert.equal(node('providerId').value, '');
  assert.equal(node('providerName').value, '');
  assert.equal(node('providerAuthHeader').value, 'authorization', 'Explicit form reset keeps the existing auth default');
  assert.deepEqual(reasoningDraft(), originalReasoning);
  // A new supplier also sends an explicit Auto; legacy URL inference stays on the backend.
  Object.assign(node('providerName'), {value: provider.name});
  node('providerBaseUrl').value = provider.base_url;
  node('providerSecretName').value = provider.secret_name;
  const beforeCreate = calls.length;
  reply('save_provider', {}); refreshReplies({...provider, api_protocol: 'auto'});
  submit('providerForm'); await settleProxy();
  assert.equal(calls[beforeCreate].id, null);
  assert.equal(calls[beforeCreate].api_protocol, 'auto');
  console.log('PASS real provider edit/save/create/reset handlers, valid protocol enum, legacy Auto, bilingual labels/help and unsaved reasoning/auth preservation');

  modelClick();
  for (const [code, key] of Object.entries({reasoning_history_unsupported: 'reasoningHistoryUnsupported', reasoning_effort_unsupported: 'reasoningEffortUnsupported', reasoning_budget: 'reasoningBudget', effort: 'reasoningEffortInvalid'})) {
    const beforeError = calls.length;
    reply('save_model', {error: code}, 400);
    submit('modelForm'); await settleProxy();
    assert.equal(calls.length, beforeError + 1);
    assert(!('api_protocol' in calls.at(-1)), 'Model payload must inherit supplier protocol');
    assert.equal(run("messages.get('modelMessage').key"), key);
    assert.deepEqual(reasoningDraft(), originalReasoning, 'Validation errors must preserve reasoning settings for review');
    assert.equal(node('modelConfigId').value, model.id);
    for (const lang of ['zh', 'en']) {
      language = lang; windowListeners.get('club:langchange')();
      assert.equal(node('modelMessage').textContent, dictionaries[lang].chatAdmin[key]);
      assert.match(dictionaries[lang].chatAdmin[key], /请检查|请|Check|Review/, 'Errors must explain how to review the settings');
    }
  }
  const beforeModelSave = calls.length;
  reply('save_model', {}); refreshReplies({...provider, api_protocol: 'messages'});
  submit('modelForm'); await settleProxy();
  assert.deepEqual(calls[beforeModelSave], {action: 'save_model', ...model}, 'Model save keeps existing reasoning settings and has no separate protocol');
  assert.equal(run("errorKey({message:'api_protocol',status:400})"), 'invalidApiProtocol');
  for (const lang of ['zh', 'en']) {
    assert.match(dictionaries[lang].chatAdmin.apiProtocolHelp, /覆盖 URL 后缀|overrides the URL suffix/);
    assert.match(dictionaries[lang].chatAdmin.baseUrlHelp, /仅自动模式|Only Auto/);
    assert.match(dictionaries[lang].chatAdmin.modelApiProtocolHelp, /继承|inherit/);
  }
  assert.equal(dictionaries.zh.chatAdmin.apiProtocol, 'API协议');
  console.log('PASS inherited model protocol, unchanged reasoning save payload and actionable bilingual protocol error mappings');
}
assert.equal(queue.length, 0, 'All queued responses must be consumed');
console.log(`Chat admin VM regression passed (${calls.length} mocked requests; zero network or paid calls).`);
