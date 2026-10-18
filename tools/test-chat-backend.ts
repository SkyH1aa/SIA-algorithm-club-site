// Run: npm exec --yes --package=deno -- deno run --allow-env tools/test-chat-backend.ts
// No network permission: every fetch and DNS query is intercepted in this process.
import { strict as assert } from 'node:assert';
import { chatEndpoint } from '../supabase/functions/_shared/chat-protocol.ts';

Deno.env.set('CHAT_TEST_MODE', '1');
Deno.env.set('SUPABASE_URL', 'http://127.0.0.1:19999');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'local-service');
Deno.env.set('SUPABASE_ANON_KEY', 'local-anon');
Deno.env.set('CHAT_KEY_MOCK', 'local-provider-secret');
Deno.env.set('CHAT_CORS_ORIGINS', 'http://localhost:4173');
const { handler } = await import('../supabase/functions/chat/index.ts');
const { handler: proxyHandler } = await import('../supabase/functions/chat-api-proxy/index.ts');
const { hashKey } = await import('../supabase/functions/_shared/chat-api-proxy.ts');
const deletedCredential = 'cap_' + 'A'.repeat(43);
const siblingCredential = 'cap_' + 'B'.repeat(43);
const deletedCredentialHash = await hashKey(deletedCredential);
const siblingCredentialHash = await hashKey(siblingCredential);
const UID = '11111111-1111-4111-8111-111111111111';
const PID = '22222222-2222-4222-8222-222222222222';
const MID = '33333333-3333-4333-8333-333333333333';
type Row = Record<string, unknown>;
const originalFetch = globalThis.fetch;
const originalDns = Deno.resolveDns;
const encoder = new TextEncoder();
const providerBase = { id: PID, name: 'mock', label: 'Local Provider', base_url: 'https://provider.example.com/v1', api_protocol: 'auto' as const, secret_name: 'CHAT_KEY_MOCK', auth_header: 'authorization', enabled: true };
const modelBase = { id: MID, provider_id: PID, model_key: 'local-model', display_name: 'Local Model', introduction: 'A local test model.', context_window: 1000000, max_output_tokens: 1000, default_max_output_tokens: 100, reasoning_efforts: ['low', 'high'], default_reasoning_effort: 'low', supports_images: true, supports_pdf: true, preserve_reasoning: true, enabled: true, visibility: 'all' as const };
const ASSIGNED_MID = '44444444-4444-4444-8444-444444444444';
const CUSTOM_ID = '55555555-5555-4555-8555-555555555555';
const OTHER_UID = '66666666-6666-4666-8666-666666666666';
let provider: Row, model: Row, profile: boolean, admin: boolean, auditFail: boolean, startFail: boolean, finishFail: boolean, busy: boolean;
let assignedVisible = false, customModels: Row[];
let dnsMode: string, mode: string, upstreamSignal: AbortSignal | undefined;
let wire: string | null;
let audits: Row[], patches: Row[], upstreamBodies: Array<Row & { input: Array<{ content: Array<{ text: string; image_url: string }> }> }>, requests: URL[], released: number, finishAttempts: number, leased: boolean;
let quota: Row, admissionCode: string | null, shrink: number | null, conflict: boolean;
let rpcCalls: Array<{ name: string; body: Row }>, settlements: Row[];
let charged: number;
let proxyRoute: Row | null, proxyKey: Row | null;
const directory = { users: [{ user_id: UID, username: 'local-account', member_name: '测试会员', bound: true }], blacklist: [{ user_id: PID, reason: 'abuse' }] };
let usageRange: string | null;
let providerWrites: Row[];
let terminalGate: Promise<void> | null, terminalReached: (() => void) | null;
function reset() {
  terminalGate = null; terminalReached = null; wire = null;
  quota = { global: { daily_limit: null, version: 0, used: 0, remaining: null, resets_at: '2026-10-17T00:00:00Z' }, user: { daily_limit: null, weekly_limit: null, monthly_limit: null, version: 0 }, periods: [], blacklisted: false, reason: null };
  admissionCode = null; shrink = null; conflict = false; rpcCalls = []; settlements = []; charged = 0;
  provider = { ...providerBase }; providerWrites = []; model = { ...modelBase }; profile = true; admin = true;
  proxyRoute = { id: PID, enabled: true, deleted_at: null, version: 3 };
  proxyKey = { id: MID, route_id: PID, enabled: true, revoked_at: null, version: 4 };
  assignedVisible = false; customModels = [];
  auditFail = startFail = finishFail = busy = false; dnsMode = 'a-only'; mode = 'complete';
  audits = []; patches = []; upstreamBodies = []; requests = []; released = finishAttempts = 0; leased = false; usageRange = '2-3/17'; upstreamSignal = undefined;
}
function json(value: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } });
}
function event(type: string, extra: Row = {}) { return `data: ${JSON.stringify({ type, ...extra })}\r\n\r\n`; }
const completed = event('response.completed', { response: { output: [], usage: { input_tokens: 7, output_tokens: 3, total_tokens: 10 } } });
const delta = 'event: response.output_text.delta\r\ndata: {"delta":\r\ndata: "你好"}\r\n\r\n';
function upstreamStream(signal?: AbortSignal) {
  let content = wire ?? delta + completed;
  if (mode === 'eof') content = delta;
  if (mode === 'unterminated') content = completed.trimEnd();
  if (mode === 'malformed') content = 'data: nope\n\n';
  if (mode === 'failed') content = event('response.failed');
  if (mode === 'incomplete') content = event('response.incomplete');
  if (mode === 'error-event') content = event('error');
  if (mode === 'done-only') content = 'data: [DONE]\n\n';
  if (mode === 'terminal-first') content = completed + event('response.failed');
  let index = 0;
  const bytes = mode === 'bad-utf8' ? Uint8Array.of(255) : encoder.encode(content);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      signal?.addEventListener('abort', () => { try { controller.error(new DOMException('Aborted', 'AbortError')); } catch { /* already closed */ } }, { once: true });
    },
    pull(controller) {
      if (mode === 'hanging') return new Promise<void>(() => {});
      if (index === bytes.length) controller.close();
      else controller.enqueue(bytes.slice(index, ++index)); // split every UTF-8 byte and CRLF
    },
    cancel() { /* downstream cancellation is asserted through the AbortSignal */ }
  });
}
Deno.resolveDns = ((_: string, family: string) => {
  if (dnsMode === 'unavailable') return Promise.reject(new Deno.errors.PermissionDenied('mock DNS'));
  if (dnsMode === 'absent' || (family === 'AAAA' && dnsMode === 'a-only')) return Promise.reject(new Deno.errors.NotFound('no records'));
  if (dnsMode === 'private') return Promise.resolve(family === 'A' ? ['10.0.0.1'] : []);
  if (dnsMode === 'mixed') return Promise.resolve(family === 'A' ? ['8.8.8.8', '192.168.1.1'] : []);
  if (dnsMode === 'reserved') return Promise.resolve(family === 'A' ? ['192.0.2.1'] : []);
  if (dnsMode === 'ipv6-private') return Promise.resolve(family === 'A' ? [] : ['fd00::1']);
  if (dnsMode === 'ipv6-public') return Promise.resolve(family === 'A' ? [] : ['2606:4700:4700::1111']);
  return Promise.resolve(family === 'A' ? ['8.8.8.8'] : []);
}) as typeof Deno.resolveDns;
globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
  const url = new URL(input instanceof Request ? input.url : input);
  requests.push(url);
  if (url.origin === 'https://provider.example.com') {
    const endpoint = chatEndpoint(String(provider.base_url), provider.api_protocol as Parameters<typeof chatEndpoint>[1]);
    assert.equal(url.href, endpoint.url);
    const upstreamHeaders = new Headers(init.headers);
    assert.equal(upstreamHeaders.get('anthropic-version'), endpoint.protocol === 'messages' ? '2023-06-01' : null);
    assert.equal(init.redirect, 'error');
    if (provider.auth_header === 'x-api-key') {
      assert.equal(upstreamHeaders.get('x-api-key'), 'local-provider-secret'); assert.equal(upstreamHeaders.get('authorization'), null);
    } else assert.equal(upstreamHeaders.get('authorization'), 'Bearer local-provider-secret');
    assert.ok(audits.length > 0, 'audit must precede upstream');
    assert.equal(audits.at(-1)!.status, 'upstream_started', 'start marker must precede fetch');
    upstreamBodies.push(JSON.parse(String(init.body)));
    upstreamSignal = init.signal!;
    if (upstreamSignal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (mode === 'network') throw new Error('provider network');
    if (mode === 'http') return new Response('private provider error', { status: 429 });
    if (mode === 'wrong-content') return json({ secret: 'private provider response' });
    if (mode === 'fetch-abort') return await new Promise<Response>((_, reject) => upstreamSignal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
    return new Response(upstreamStream(upstreamSignal), { headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
  }
  assert.equal(url.origin, 'http://127.0.0.1:19999', `unexpected external request ${url}`);
  const headers = new Headers(init.headers);
  if (url.pathname === '/auth/v1/user') {
    assert.equal(headers.get('apikey'), 'local-anon');
    return headers.get('authorization') === 'Bearer invalid' ? json({}, 401) : json({ id: UID, email: 'local@example.com' });
  }
  assert.equal(headers.get('authorization'), 'Bearer local-service');
  assert.equal(init.redirect, 'error');
  const table = url.pathname.slice('/rest/v1/'.length);
  if (table === 'club_member_profiles') return json(profile ? [{ username: 'local-account', member_name: '测试会员' }] : []);
  if (table === 'club_super_admins') return json(admin ? [{ user_id: UID }] : []);
  if (table === 'chat_providers') {
    if (init.method === 'POST') {
      const body = JSON.parse(String(init.body));
      providerWrites.push(body); provider = { ...provider, ...body };
      return json([provider]);
    }
    if (url.searchParams.get('id') && url.searchParams.get('id') !== `eq.${provider.id}`) return json([]);
    // Honor projections so forgetting api_protocol in the real query is visible.
    const fields = url.searchParams.get('select')?.split(',');
    return json([fields ? Object.fromEntries(fields.filter(key => key in provider).map(key => [key, provider[key]])) : provider]);
  }
  if (table === 'chat_models') {
    const body = init.method === 'POST' ? JSON.parse(String(init.body)) : null;
    const row = { ...model, ...(body || {}) };
    if (url.searchParams.get('id')?.includes(ASSIGNED_MID)) return json([{ ...row, id: ASSIGNED_MID, visibility: 'assigned' }]);
    return json([row]);
  }
  if (table === 'chat_model_access') return json(assignedVisible ? [{ user_id: UID, model_id: MID }] : []);
  if (table === 'chat_custom_models') return json(customModels);
  if (table.startsWith('rpc/')) {
    const name = table.slice(4), row = JSON.parse(String(init.body));
    rpcCalls.push({ name, body: row });
    if (name === 'chat_custom_model_list') return json(customModels);
    if (name === 'chat_custom_model_save') {
      assert.equal(row.p_user_id, UID);
      customModels = [{ id: row.p_id, user_id: UID, display_name: row.p_display_name, model_key: row.p_model_key, base_url: row.p_base_url, version: 0 }];
      return json(customModels[0]);
    }
    if (name === 'chat_custom_model_delete') {
      customModels = []; return json({ deleted: true, id: row.p_id });
    }
    if (name === 'chat_model_access_get') return json({ model_id: ASSIGNED_MID, visibility: assignedVisible ? 'assigned' : 'all', version: 1, user_ids: assignedVisible ? [UID] : [] });
    if (name === 'chat_model_access_save') {
      assert.equal(row.p_actor_user_id, UID); assignedVisible = row.p_visibility === 'assigned' && (row.p_user_ids as unknown[]).includes(UID);
      return json({ model_id: row.p_model_id, visibility: row.p_visibility, version: 2, user_ids: row.p_user_ids });
    }
    if (name === 'chat_proxy_admit') {
      assert.equal(row.p_route_id, PID);
      assert.ok([deletedCredentialHash, siblingCredentialHash].includes(row.p_key_hash));
      assert.ok(!proxyRoute || !proxyRoute.enabled || proxyRoute.deleted_at || (row.p_key_hash === deletedCredentialHash && !proxyKey), 'fixture must deny only deleted/disabled credentials');
      return json({ code: 'invalid_key' });
    }
    if (name === 'chat_proxy_admin') {
      assert.equal(row.p_actor, UID);
      if (conflict) return json({ code: 'conflict' });
      if (['admin_proxy_route_hard_delete', 'admin_proxy_key_hard_delete'].includes(row.p_action)) {
        const routeAction = row.p_action === 'admin_proxy_route_hard_delete';
        const target = routeAction ? proxyRoute : proxyKey;
        assert.deepEqual(Object.keys(row.p_data).sort(), ['expected_version', 'id']);
        if (!target || target.id !== row.p_data.id) return json({ code: 'not_found' });
        if (target.version !== row.p_data.expected_version) return json({ code: 'conflict' });
        if (!(routeAction ? target.deleted_at : target.revoked_at)) return json({ code: 'not_revoked' });
        if (routeAction) { proxyRoute = null; proxyKey = null; }
        else proxyKey = null;
        return json({ [routeAction ? 'deleted_route_id' : 'deleted_key_id']: row.p_data.id });
      }
      if (row.p_action === 'admin_proxy_list') return json({ routes: [], keys: [] });
      if (row.p_action === 'admin_proxy_key_create') {
        assert.match(row.p_data.key_hash, /^[a-f0-9]{64}$/);
        assert.equal(row.p_data.api_key, undefined);
        return json({ key: { id: MID, route_id: PID, label: row.p_data.label, key_prefix: row.p_data.key_prefix, key_last4: row.p_data.key_last4, enabled: true, revoked_at: null, version: 1, created_at: '2026-01-01T00:00:00Z' } });
      }
      return json(row.p_action === 'admin_proxy_key_state' ? { key: { id: MID, enabled: row.p_data.enabled } } : { route: { id: PID, ...row.p_data, version: 1 } });
    }
    if (name === 'chat_quota_get') return json(quota);
    if (name === 'chat_quota_save') return json(conflict ? { code: 'conflict' } : quota);
    if (name === 'chat_blacklist_set') return json({ ...quota, blacklisted: row.p_blocked, reason: row.p_reason });
    if (name === 'chat_user_directory') return json(directory);
    if (name === 'chat_begin_generation') {
      assert.equal(row.p_user_id, UID); assert.ok(Number.isInteger(row.p_input_tokens));
      assert.ok(!('user_id' in row.p_audit)); assert.ok(!('request_id' in row.p_audit));
      const code = admissionCode || (quota.blacklisted ? 'blacklisted' : busy || leased ? 'busy' : null);
      if (code) return json({ allowed: false, code, quota });
      if (auditFail) return json({}, 503);
      const effective = shrink ?? row.p_output_tokens;
      charged = row.p_input_tokens + effective;
      audits.push({ ...row.p_audit, user_id: UID, request_id: row.p_request_id, max_output_tokens: effective });
      leased = true;
      return json({ allowed: true, max_output_tokens: effective, quota_limited: effective < row.p_output_tokens, quota });
    }
    if (name === 'chat_finish_generation') {
      finishAttempts++;
      settlements.push(row);
      if (terminalGate) { terminalReached?.(); await terminalGate; }
      if (finishFail) return json({}, 503);
      const audit = audits.find(item => item.request_id === row.p_request_id);
      assert.ok(audit);
      if (!['audited', 'upstream_started'].includes(String(audit.status))) return json({ settled: true });
      Object.assign(audit, row.p_patch); patches.push(row.p_patch);
      charged = row.p_refund ? 0 : Number.isSafeInteger(row.p_patch.total_tokens) ? row.p_patch.total_tokens : charged;
      released++; leased = false;
      return json({ settled: true });
    }
    throw new Error(`unexpected RPC ${name}`);
  }
  if (table === 'chat_usage') {
    if (init.method === 'POST') {
      throw new Error('audit insertion must be atomic in begin RPC');
    }
    if (init.method === 'PATCH') {
      const patch = JSON.parse(String(init.body));
      if (patch.finished_at) finishAttempts++;
      assert.equal(url.searchParams.get('status'), 'in.(audited,upstream_started)');
      if (patch.finished_at && terminalGate) { terminalReached?.(); await terminalGate; }
      if ((startFail && patch.status === 'upstream_started') || (finishFail && patch.finished_at)) return json({}, 503);
      const row = audits.find(row => `eq.${row.request_id}` === url.searchParams.get('request_id'));
      if (!row || !['audited', 'upstream_started'].includes(String(row.status))) return json([]);
      Object.assign(row, patch); patches.push(patch); return json([row]);
    }
    assert.equal(headers.get('prefer'), 'count=exact');
    return json([{ member_name: '测试会员', username: 'local-account', provider_name: 'Local Provider', model_name: 'Local Model', started_at: '2026-10-15T00:00:00Z', finished_at: '2026-10-15T00:01:00Z' }], 200, usageRange ? { 'content-range': usageRange } : {});
  }
  throw new Error(`unexpected mock route ${url}`);
}) as typeof fetch;
function request(payload: Row, token: string | null = 'member', signal?: AbortSignal) {
  return new Request('http://localhost/chat', { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(payload), signal });
}
const message = (text = 'hello') => ({ role: 'user', content: [{ type: 'input_text', text }] });
const payload = (extra: Row = {}) => ({ action: 'respond', model_id: MID, input: [message()], ...extra });
async function expectStatus(body: Row, status: number, token: string | null = 'member') {
  const response = await handler(request(body, token)); assert.equal(response.status, status, await response.clone().text()); return response;
}
async function consume(body: Row = payload()) {
  const response = await handler(request(body)); assert.equal(response.status, 200, await response.clone().text()); return await response.text();
}
let count = 0;
async function test(name: string, fn: () => Promise<void>) {
  reset(); await fn(); count++; console.log(`PASS ${name}`);
}
try {
  await test('proxy administration dynamic superadmin, strict contract, one-time key and conflicts', async () => {
    const save = { action: 'admin_proxy_save', id: null, name: 'proxy', base_url: 'https://provider.example.com/v1', secret_name: 'CHAT_KEY_MOCK', enabled: true, expected_version: 0 };
    admin = false;
    for (const body of [{action:'admin_proxy_list'},save,{action:'admin_proxy_key_create',route_id:PID,label:'member'}]) await expectStatus(body,403);
    assert.equal(rpcCalls.length,0); admin=true;
    await expectStatus({action:'admin_proxy_list'},200);
    await expectStatus(save,200);
    const r=await expectStatus({action:'admin_proxy_key_create',route_id:PID,label:'member'},200);
    assert.equal(r.headers.get('cache-control'),'no-store');
    const value=await r.json(); assert.match(value.api_key,/^cap_[A-Za-z0-9_-]{43}$/); assert.equal(value.key.key_hash,undefined);
    const {hashKey}=await import('../supabase/functions/_shared/chat-api-proxy.ts');
    assert.equal((rpcCalls.at(-1)!.body.p_data as Row).key_hash,await hashKey(value.api_key));
    for (const bad of [{...save,expected_version:undefined},{...save,enabled:'yes'},{...save,api_key:'must-not-accept'}, {...save,base_url:'https://provider.example.com/v1/response'}, {action:'admin_proxy_key_state',id:MID,enabled:true,expected_version:1}]) await expectStatus(bad,400);
    conflict=true; await expectStatus({...save,id:PID,expected_version:1},409);
    assert.equal(upstreamBodies.length,0);
  });
  await test('hard-delete actions authenticate and recheck dynamic admin without RPC', async () => {
    for (const [action, id] of [['admin_proxy_route_hard_delete', PID], ['admin_proxy_key_hard_delete', MID]]) {
      const body = { action, id, expected_version: 1 };
      await expectStatus(body, 401, null);
      await expectStatus(body, 401, 'invalid');
      admin = false; await expectStatus(body, 403);
      admin = true; profile = false;
      await expectStatus({ action: 'admin_proxy_list' }, 200);
      admin = false; await expectStatus(body, 403);
    }
    assert.ok(rpcCalls.every(call => call.body.p_action === 'admin_proxy_list'));
    assert.equal(upstreamBodies.length, 0);
  });
  await test('hard-delete strict ids, positive safe versions and payload allowlists', async () => {
    for (const [action, id] of [['admin_proxy_route_hard_delete', PID], ['admin_proxy_key_hard_delete', MID]]) {
      const valid = { action, id, expected_version: 1 };
      for (const change of [
        { id: undefined }, { id: null }, { id: 1 }, { id: 'bad' },
        { expected_version: undefined }, { expected_version: null }, { expected_version: true },
        { expected_version: '1' }, { expected_version: 0 }, { expected_version: -1 },
        { expected_version: 1.5 }, { expected_version: Number.MAX_SAFE_INTEGER + 1 },
        { enabled: false }, { revoked: true }, { api_key: deletedCredential }, { extra: true }
      ]) await expectStatus({ ...valid, ...change }, 400);
    }
    assert.equal(rpcCalls.length, 0);
    assert.equal(upstreamBodies.length, 0);
  });
  for (const routeAction of [false, true]) await test(`hard-delete ${routeAction ? 'route' : 'key'} eligibility, CAS, missing and deleted credential denial`, async () => {
    const action = routeAction ? 'admin_proxy_route_hard_delete' : 'admin_proxy_key_hard_delete';
    const target = (routeAction ? proxyRoute : proxyKey)!;
    const body = { action, id: target.id, expected_version: target.version };
    const error = async (data: Row, status: number, code: string) => {
      assert.deepEqual(await (await expectStatus(data, status)).json(), { error: code });
    };
    await error({ ...body, expected_version: Number(target.version) - 1 }, 409, 'conflict');
    await error(body, 409, 'not_revoked');
    target.enabled = false;
    await error(body, 409, 'not_revoked');
    target[routeAction ? 'deleted_at' : 'revoked_at'] = '2026-10-18T00:00:00Z';
    await error({ ...body, expected_version: Number(target.version) - 1 }, 409, 'conflict');
    await error({ ...body, id: OTHER_UID }, 404, 'not_found');
    admin = false; await expectStatus(body, 403); admin = true;
    const result = await expectStatus(body, 200);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await result.json(), { [routeAction ? 'deleted_route_id' : 'deleted_key_id']: body.id });
    assert.deepEqual(rpcCalls.at(-1), { name: 'chat_proxy_admin', body: { p_actor: UID, p_action: action, p_data: { id: body.id, expected_version: body.expected_version } } });
    await error(body, 404, 'not_found');
    assert.equal(proxyKey, null);
    assert.equal(proxyRoute === null, routeAction);
    // Exercise the real gateway, with deleted credential admission denied by the
    // RPC fixture before URL validation, DNS, body forwarding or provider fetch.
    for (const credential of routeAction ? [deletedCredential, siblingCredential] : [deletedCredential]) {
      const response = await proxyHandler(new Request(`http://localhost/chat-api-proxy/${PID}/v1/responses`, {
        method: 'POST', headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' }, body: '{"model":"mock","input":"hello"}'
      }));
      assert.equal(response.status, 401);
      assert.equal((await response.json()).error.code, 'invalid_key');
      assert.equal(rpcCalls.at(-1)!.name, 'chat_proxy_admit');
    }
    assert.equal(upstreamBodies.length, 0);
    assert.ok(requests.every(url => url.origin === 'http://127.0.0.1:19999'));
  });
  await test('authentication, profile binding, dynamic admin permission', async () => {
    await expectStatus({ action: 'catalog' }, 401, null); await expectStatus({ action: 'catalog' }, 401, 'invalid');
    profile = false; await expectStatus(payload(), 403);
    admin = false; await expectStatus({ action: 'admin_get' }, 403); await expectStatus({ action: 'admin_test', model_id: MID, prompt: 'test' }, 403);
    assert.equal(upstreamBodies.length, 0);
  });
  await test('catalog hides disabled models/providers and secrets', async () => {
    let result = await (await expectStatus({ action: 'catalog' }, 200)).json();
    assert.equal(result.models.length, 1); assert.equal(result.models[0].introduction, 'A local test model.'); assert.equal(result.member_name, '测试会员'); assert.ok(!JSON.stringify(result).includes('CHAT_KEY'));
    provider.enabled = false; result = await (await expectStatus({ action: 'catalog' }, 200)).json(); assert.equal(result.models.length, 0);
  });
  await test('model visibility filters catalog and enforces direct access while admins may test assigned models', async () => {
    model.visibility = 'assigned';
    let result = await (await expectStatus({ action: 'catalog' }, 200)).json();
    assert.equal(result.models.length, 0);
    await expectStatus(payload(), 403);
    assignedVisible = true;
    result = await (await expectStatus({ action: 'catalog' }, 200)).json();
    assert.equal(result.models.length, 1);
    assignedVisible = false;
    await consume({ action: 'admin_test', model_id: MID, prompt: 'admin assigned test' });
    admin = false;
    await expectStatus({ action: 'admin_model_access_get', model_id: MID }, 403);
    await expectStatus({ action: 'admin_model_access_save', model_id: MID, visibility: 'assigned', user_ids: [UID], expected_version: 1 }, 403);
  });
  await test('model access admin actions and custom profiles reject unsafe payloads', async () => {
    await expectStatus({ action: 'admin_model_access_get', model_id: ASSIGNED_MID }, 200);
    await expectStatus({ action: 'admin_model_access_save', model_id: ASSIGNED_MID, visibility: 'assigned', user_ids: [UID], expected_version: 1 }, 200);
    const base = { action: 'custom_model_save', id: CUSTOM_ID, display_name: 'Personal', model_key: 'upstream/model', base_url: 'https://jgezpvmlnhycxslqbwcx.supabase.co/functions/v1/chat-api-proxy/' + PID, expected_version: 0 };
    await expectStatus({ action: 'custom_model_list' }, 200);
    await expectStatus(base, 200);
    for (const suffix of ['', '/', '/v1', '/v1/', '/responses', '/messages', '/message', '/chat/completions', '/v1/responses', '/v1/messages', '/v1/message', '/v1/chat/completions/']) {
      const base_url = base.base_url + suffix;
      await expectStatus({ ...base, base_url }, 200);
      assert.equal(rpcCalls.at(-1)!.body.p_base_url, base_url.replace(/\/+$/, ''));
    }
    for (const suffix of ['/v2', '/v1/v1', '/response', '/messages/extra', '/chat/completion', '/v1/chat/completions/extra']) await expectStatus({ ...base, base_url: base.base_url + suffix }, 400);
    assert.equal(rpcCalls.at(-1)!.body.p_user_id, UID);
    for (const bad of [
      { ...base, api_key: 'secret' },
      { ...base, extra: true },
      { ...base, model_key: 'bad model' },
      { ...base, base_url: 'https://evil.example/chat-api-proxy/' + PID },
      { ...base, base_url: 'https://jgezpvmlnhycxslqbwcx.supabase.co/functions/v1/chat-api-proxy/' + PID + '?x=1' },
      { ...base, expected_version: -1 }
    ]) await expectStatus(bad, 400);
    await expectStatus({ action: 'custom_model_delete', id: CUSTOM_ID, expected_version: 0 }, 200);
    profile = false;
    await expectStatus({ action: 'custom_model_list' }, 403);
  });
  await test('multi-turn continuation, encrypted reasoning, images/PDF and metadata-only audit', async () => {
    const image = { type: 'input_image', image_url: 'data:image/png;base64,aGVsbG8=' };
    const pdf = { type: 'input_file', filename: 'local.pdf', file_data: 'data:application/pdf;base64,JVBERg==' };
    const input = [{ role: 'user', content: [image, image, pdf, pdf] }, { type: 'reasoning', encrypted_content: 'opaque-secret', summary: [] }, { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'previous answer', annotations: [] }] }, { role: 'user', content: [{ type: 'input_text', text: 'private prompt' }, image, pdf] }];
    assert.match(await consume(payload({ input })), /你好/);
    assert.deepEqual(upstreamBodies[0].input, input); assert.deepEqual(upstreamBodies[0].include, ['reasoning.encrypted_content']);
    assert.equal(upstreamBodies[0].store, false); assert.deepEqual(upstreamBodies[0].reasoning, { effort: 'low' });
    assert.equal(audits[0].status, 'completed'); assert.equal(audits[0].total_tokens, 10);
    assert.equal(audits[0].username, 'local-account'); assert.equal(audits[0].provider_name, 'Local Provider'); assert.equal(audits[0].model_name, 'Local Model'); assert.ok(audits[0].finished_at);
    assert.doesNotMatch(JSON.stringify(audits), /private prompt|opaque-secret|previous answer|aGVsbG8|JVBERg/);
    assert.equal(released, 1); assert.equal(leased, false);
  });
  await test('admin_test takes prompt, admin without member profile uses account fallback', async () => {
    profile = false;
    await consume({ action: 'admin_test', model_id: MID, prompt: 'admin local test', max_output_tokens: 5, reasoning_effort: 'high' });
    assert.equal(upstreamBodies[0].input[0].content[0].text, 'admin local test'); assert.equal(audits[0].action, 'admin_test'); assert.equal(audits[0].username, 'local@example.com');
  });
  await test('ordinary respond always uses the configured default output budget', async () => {
    const response = await consume(payload({ max_output_tokens: 900 }));
    assert.match(response, /你好/);
    assert.equal(upstreamBodies[0].max_output_tokens, 100, 'client budget must not override the admin default');
    assert.equal(audits[0].max_output_tokens, 100);
  });
  await test('2040 KiB image fits 200k context with 32k admin output budget', async () => {
    model.context_window = 200000;
    model.max_output_tokens = 32000;
    model.default_max_output_tokens = 32000;
    const decodedBytes = 2040 * 1024;
    const image = { type: 'input_image', image_url: `data:image/png;base64,${'A'.repeat(4 * Math.ceil(decodedBytes / 3))}`, detail: 'auto' };
    await consume(payload({ input: [{ role: 'user', content: [message('image prompt').content[0], image] }] }));
    assert.equal(upstreamBodies[0].max_output_tokens, 32000);
    assert.equal(audits[0].max_output_tokens, 32000);
    assert.equal(upstreamBodies[0].input[0].content[1].image_url.length, image.image_url.length);
    assert.ok(Number(audits[0].input_bytes) < 12 * 1024 * 1024);
  });
  await test('strict request, content, output, effort and context validation', async () => {
    for (const bad of [payload({ extra: true }), payload({ input: [] }), payload({ input: [{ role: 'tool', content: [] }] }), payload({ input: [message('')] }), payload({ input: [{ role: 'user', content: [{ type: 'input_text', text: 'x', filename: 'x.txt' }] }] }), payload({ max_output_tokens: 0 }), payload({ max_output_tokens: 1001 }), payload({ max_output_tokens: '5' }), payload({ reasoning_effort: 'extreme' })]) await expectStatus(bad, 400);
    model.context_window = 256; model.max_output_tokens = 100; await expectStatus(payload({ input: [message('x'.repeat(1000))] }), 413);
    assert.equal(upstreamBodies.length, 0);
  });
  await test('attachment capabilities, paths, remote URLs, count and size', async () => {
    const image = { type: 'input_image', image_url: 'data:image/png;base64,aGVsbG8=' };
    const withPart = (part: Row) => payload({ input: [{ role: 'user', content: [part] }] });
    model.supports_images = false; await expectStatus(withPart(image), 400); model.supports_images = true;
    model.supports_pdf = false; await expectStatus(withPart({ type: 'input_file', filename: 'x.pdf', file_data: 'data:application/pdf;base64,JVBERg==' }), 400);
    model.supports_pdf = true;
    await expectStatus(withPart({ ...image, image_url: 'https://example.com/file.png' }), 400);
    await expectStatus(withPart({ type: 'input_file', filename: '../x.pdf', file_data: 'data:application/pdf;base64,JVBERg==' }), 400);
    await expectStatus(payload({ input: [{ role: 'user', content: Array(5).fill(image) }] }), 400);
    await expectStatus(withPart({ ...image, image_url: `data:image/png;base64,${'AAAA'.repeat(1800000)}` }), 413);
    model.preserve_reasoning = false; await expectStatus(payload({ input: [{ type: 'reasoning', encrypted_content: 'opaque', summary: [] }, message()] }), 400);
  });
  await test('large text attachment accepts 500k+ characters', async () => {
    await consume(payload({ input: [message('x'.repeat(600000))] })); assert.equal(upstreamBodies[0].input[0].content[0].text.length, 600000);
  });
  await test('admin configuration actions and aliases validate capabilities', async () => {
    await expectStatus({ action: 'admin_get' }, 200);
    await expectStatus({ action: 'save_provider', ...providerBase }, 200).catch(error => { throw error; });
  });
  await test('provider protocol create default, save/read roundtrip and omitted update preservation', async () => {
    const { id: _id, api_protocol: _protocol, ...fields } = providerBase;
    const created = await (await expectStatus({ action: 'admin_save_provider', ...fields }, 200)).json();
    assert.equal(created.provider.api_protocol, 'auto'); assert.equal(providerWrites.at(-1)!.api_protocol, 'auto');
    model.preserve_reasoning = false; model.reasoning_efforts = []; model.default_reasoning_effort = null;
    for (const api_protocol of ['messages', 'chat', 'responses', 'auto']) {
      const saved = await (await expectStatus({ action: 'save_provider', ...providerBase, api_protocol }, 200)).json();
      assert.equal(saved.provider.api_protocol, api_protocol); assert.equal(provider.api_protocol, api_protocol);
      const listed = await (await expectStatus({ action: 'admin_get' }, 200)).json();
      assert.equal(listed.providers[0].api_protocol, api_protocol);
      assert.equal(listed.providers[0].auth_header, 'authorization');
      const updated = await (await expectStatus({ action: 'admin_save_provider', ...fields, id: PID, label: 'Edited' }, 200)).json();
      assert.equal(updated.provider.api_protocol, api_protocol); assert.equal(providerWrites.at(-1)!.api_protocol, api_protocol);
    }
    assert.equal(upstreamBodies.length, 0);
  });
  await test('omitted provider protocol defaults to auto for an id with no existing row', async () => {
    const { api_protocol: _protocol, ...fields } = providerBase;
    const result = await (await expectStatus({ action: 'admin_save_provider', ...fields, id: OTHER_UID }, 200)).json();
    assert.equal(result.provider.api_protocol, 'auto');
    const lookup = requests.find(url => url.pathname.endsWith('/chat_providers') && url.searchParams.get('select') === 'api_protocol')!;
    assert.equal(lookup.searchParams.get('id'), `eq.${OTHER_UID}`); assert.equal(lookup.searchParams.get('deleted_at'), 'is.null');
    assert.equal(providerWrites[0].api_protocol, 'auto');
  });
  await test('provider protocol rejects supplied invalid types/values before persistence', async () => {
    const { id: _id, ...fields } = providerBase;
    for (const id of [undefined, PID]) {
      for (const api_protocol of [null, '', 'AUTO', 'message', 'chat/completions', 'invalid', 0, true, [], {}]) {
        const result = await expectStatus({ action: 'admin_save_provider', ...fields, id, api_protocol }, 400);
        assert.deepEqual(await result.json(), { error: 'api_protocol' });
      }
    }
    assert.equal(providerWrites.length, 0); assert.equal(upstreamBodies.length, 0);
  });
  await test('admin model save and invalid configuration', async () => {
    const { id: _id, ...fields } = modelBase;
    await expectStatus({ action: 'save_model', ...fields }, 200);
    await expectStatus({ action: 'admin_save_model', ...fields, introduction: 'x'.repeat(1001) }, 400);
    await expectStatus({ action: 'admin_save_model', ...fields, introduction: 123 }, 400);
    await expectStatus({ action: 'admin_save_model', ...fields, reasoning_efforts: ['high', 'high'] }, 400);
    await expectStatus({ action: 'admin_save_model', ...fields, default_reasoning_effort: 'unknown' }, 400);
    await expectStatus({ action: 'admin_save_model', ...fields, context_window: 256 }, 400);
  });
  await test('exact usage pagination, metadata columns and UTC date boundaries', async () => {
    const response = await expectStatus({ action: 'usage', page: 2, pageSize: 2, from: '2026-10-01T08:00:00+08:00', to: '2026-10-16T00:00:00Z' }, 200);
    const result = await response.json(); assert.equal(result.total, 17); assert.equal(result.page, 2); assert.equal(result.usage[0].username, 'local-account');
    const query = requests.find(url => url.pathname.endsWith('/chat_usage'))!.searchParams;
    assert.equal(query.get('offset'), '2'); assert.deepEqual(query.getAll('started_at'), ['gte.2026-10-01T00:00:00.000Z', 'lte.2026-10-16T00:00:00.000Z']);
    await expectStatus({ action: 'admin_usage', from: 'bad' }, 400); await expectStatus({ action: 'admin_usage', from: '2026-10-16', to: '2026-10-01' }, 400);
    await expectStatus({ action: 'admin_usage', page: 0 }, 400); usageRange = null; await expectStatus({ action: 'admin_usage' }, 503);
  });
  await test('DNS A-only/AAAA-only valid, absent/private/reserved/error fail closed', async () => {
    for (const bad of ['unavailable', 'absent', 'private', 'mixed', 'reserved', 'ipv6-private']) { dnsMode = bad; await expectStatus(payload(), 400); }
    assert.equal(upstreamBodies.length, 0);
    dnsMode = 'ipv6-public'; await consume();
  });
  await test('SSRF URL validation blocks credentials, fragments, IP and local hosts', async () => {
    for (const url of ['http://provider.example.com', 'https://127.0.0.1', 'https://169.254.169.254', 'https://[::1]', 'https://localhost', 'https://x.local', 'https://u:p@provider.example.com', 'https://provider.example.com?x=1', 'https://provider.example.com#x', 'https://provider.example.com:444']) { provider.base_url = url; await expectStatus(payload(), 400); }
    assert.equal(upstreamBodies.length, 0);
  });
  for (const failure of ['network', 'http', 'wrong-content']) await test(`upstream ${failure} redaction and release`, async () => {
    mode = failure; const response = await expectStatus(payload(), 502); assert.deepEqual(await response.json(), { error: 'upstream' }); assert.equal(audits[0].status, 'failed'); assert.equal(released, 1);
  });
  await test('atomic admission audit failure never acquires lease or calls provider', async () => {
    auditFail = true; await expectStatus(payload(), 503); assert.equal(upstreamBodies.length, 0); assert.equal(released, 0); assert.equal(leased, false);
  });
  await test('pre-fetch start marker failure never calls provider and settles conservatively', async () => {
    startFail = true; await expectStatus(payload(), 503); assert.equal(upstreamBodies.length, 0); assert.equal(released, 1); assert.equal(settlements[0].p_refund, false);
  });
  await test('terminal audit failure does not deliver completed success', async () => {
    finishFail = true; await assert.rejects(consume()); assert.ok(upstreamSignal!.aborted); assert.equal(released, 0); assert.equal(leased, true); assert.notEqual(audits[0].status, 'completed');
  });
  await test('busy lease never audits or calls provider', async () => {
    busy = true; await expectStatus(payload(), 409); assert.equal(upstreamBodies.length, 0); assert.equal(audits.length, 0); assert.equal(released, 0);
  });
  for (const [streamMode, status] of [['complete', 'completed'], ['failed', 'failed'], ['incomplete', 'incomplete'], ['error-event', 'failed'], ['eof', 'interrupted'], ['unterminated', 'interrupted'], ['done-only', 'interrupted'], ['terminal-first', 'completed']]) await test(`byte-fragmented SSE ${streamMode}`, async () => {
    mode = streamMode; await consume(); assert.equal(audits[0].status, status); assert.equal(released, 1); assert.equal(finishAttempts, 1);
  });
  for (const streamMode of ['malformed', 'bad-utf8']) await test(`reject stream ${streamMode}`, async () => {
    mode = streamMode; await assert.rejects(consume()); assert.equal(audits[0].status, 'failed'); assert.equal(released, 1); assert.equal(finishAttempts, 1);
  });
  await test('downstream body cancellation aborts upstream and releases once', async () => {
    mode = 'hanging'; const response = await handler(request(payload())); await response.body!.cancel();
    assert.ok(upstreamSignal!.aborted); assert.equal(audits[0].status, 'cancelled'); assert.equal(released, 1); assert.equal(finishAttempts, 1);
  });
  await test('request cancellation while streaming aborts upstream and releases', async () => {
    mode = 'hanging'; const abort = new AbortController(); const response = await handler(request(payload(), 'member', abort.signal)); const reading = response.text(); abort.abort(); await assert.rejects(reading);
    assert.ok(upstreamSignal!.aborted); assert.equal(audits[0].status, 'cancelled'); assert.equal(released, 1); assert.equal(finishAttempts, 1);
  });
  await test('request cancellation during fetch and before fetch', async () => {
    mode = 'fetch-abort'; const abort = new AbortController(); const result = handler(request(payload(), 'member', abort.signal));
    while (!upstreamSignal) await new Promise(resolve => setTimeout(resolve, 0)); abort.abort(); assert.equal((await result).status, 499); assert.equal(released, 1);
    reset(); const early = new AbortController(); early.abort(); assert.equal((await handler(request(payload(), 'member', early.signal))).status, 499); assert.equal(released, 1);
  });
  await test('abort after completion cannot overwrite completed audit', async () => {
    const abort = new AbortController(); const response = await handler(request(payload(), 'member', abort.signal)); await response.text(); abort.abort();
    assert.equal(audits[0].status, 'completed'); assert.equal(released, 1); assert.equal(patches.filter(row => row.finished_at).length, 1);
  });
  await test('cancel during terminal audit preserves completed state and tokens', async () => {
    let release!: () => void;
    terminalGate = new Promise<void>(resolve => { release = resolve; });
    const reached = new Promise<void>(resolve => { terminalReached = resolve; });
    const response = await handler(request(payload()));
    const reader = response.body!.getReader();
    const draining = (async () => { while (!(await reader.read()).done) { /* drain */ } })();
    await reached;
    const cancellation = reader.cancel();
    release(); await cancellation; await draining;
    assert.equal(audits[0].status, 'completed'); assert.equal(audits[0].total_tokens, 10);
    assert.equal(released, 1); assert.equal(patches.filter(row => row.finished_at).length, 1);
  });
  await test('quota visibility, admin routes and dynamic permissions', async () => {
    assert.deepEqual(await (await expectStatus({ action: 'quota' }, 200)).json(), quota);
    assert.equal(rpcCalls.at(-1)!.body.p_user_id, UID);
    assert.deepEqual((await (await expectStatus({ action: 'catalog' }, 200)).json()).quota, quota);
    await expectStatus({ action: 'admin_quota_get' }, 200); assert.equal(rpcCalls.at(-1)!.body.p_user_id, null);
    await expectStatus({ action: 'admin_quota_get', user_id: PID }, 200); assert.equal(rpcCalls.at(-1)!.body.p_user_id, PID);
    const save = { action: 'admin_quota_save', user_id: PID, daily_limit: 0, weekly_limit: null, monthly_limit: 1e12, expected_version: 0 };
    await expectStatus(save, 200); assert.deepEqual(rpcCalls.at(-1)!.body, { p_actor_user_id: UID, p_user_id: PID, p_daily_limit: 0, p_weekly_limit: null, p_monthly_limit: 1e12, p_expected_version: 0 });
    await expectStatus({ ...save, user_id: null, weekly_limit: null, monthly_limit: null }, 200);
    await expectStatus({ action: 'admin_quota_save', daily_limit: null, expected_version: 0 }, 200);
    assert.equal(rpcCalls.at(-1)!.body.p_weekly_limit, null); assert.equal(rpcCalls.at(-1)!.body.p_monthly_limit, null);
    conflict = true; await expectStatus(save, 409);
    assert.deepEqual(await (await expectStatus({ action: 'admin_user_directory' }, 200)).json(), directory);
    assert.deepEqual(await (await expectStatus({ action: 'admin_blacklist_list' }, 200)).json(), { blacklist: directory.blacklist });
    await expectStatus({ action: 'admin_set_blacklist', user_id: PID, blocked: true, reason: ' abuse ' }, 200);
    assert.deepEqual(rpcCalls.at(-1)!.body, { p_actor_user_id: UID, p_user_id: PID, p_blocked: true, p_reason: 'abuse' });
    await expectStatus({ action: 'admin_set_blacklist', user_id: PID, blocked: false }, 200);
    admin = false;
    for (const action of ['admin_quota_get', 'admin_quota_save', 'admin_user_directory', 'admin_blacklist_list', 'admin_set_blacklist']) await expectStatus({ action }, 403);
    await expectStatus({ action: 'quota', user_id: PID }, 400);
  });
  await test('strict quota and blacklist types, bounds and allowlists', async () => {
    const save = { action: 'admin_quota_save', daily_limit: null, weekly_limit: null, monthly_limit: null, expected_version: 0 };
    for (const change of [{ daily_limit: -1 }, { daily_limit: 1e12 + 1 }, { daily_limit: '4' }, { daily_limit: 1.5 }, { daily_limit: undefined }, { user_id: UID, weekly_limit: undefined }, { user_id: UID, monthly_limit: undefined }, { expected_version: null }, { expected_version: -1 }, { user_id: '' }, { weekly_limit: 1 }, { extra: true }]) await expectStatus({ ...save, ...change }, 400);
    for (const change of [{ blocked: 'true' }, { blocked: null }, { user_id: null }, { reason: 5 }, { reason: null }, { reason: 'x'.repeat(1001) }, { extra: true }]) await expectStatus({ action: 'admin_set_blacklist', user_id: UID, blocked: true, ...change }, 400);
    await expectStatus({ action: 'admin_user_directory', user_id: UID }, 400);
    assert.equal(rpcCalls.length, 0);
  });
  await test('blacklist and quota deny both generation paths without provider', async () => {
    quota.blacklisted = true;
    assert.deepEqual(await (await expectStatus({ action: 'catalog' }, 403)).json(), { error: 'blacklisted' });
    await expectStatus(payload(), 403);
    await expectStatus({ action: 'admin_test', model_id: MID, prompt: 'test' }, 403);
    quota.blacklisted = false; admissionCode = 'quota_exceeded';
    for (const body of [payload(), { action: 'admin_test', model_id: MID, prompt: 'test' }]) {
      assert.deepEqual(await (await expectStatus(body, 429)).json(), { error: 'quota', quota });
    }
    assert.equal(upstreamBodies.length, 0); assert.equal(audits.length, 0); assert.equal(released, 0);
  });
  await test('quota shrink uses effective provider and audit budget with exposed headers', async () => {
    shrink = 12;
    const response = await expectStatus(payload(), 200);
    assert.equal(response.headers.get('x-chat-quota-limited'), 'true'); assert.equal(response.headers.get('x-chat-max-output-tokens'), '12');
    assert.match(response.headers.get('access-control-expose-headers')!, /X-Chat-Quota-Limited/);
    await response.text();
    assert.equal(upstreamBodies[0].max_output_tokens, 12); assert.equal(audits[0].max_output_tokens, 12);
    assert.equal(rpcCalls.find(x => x.name === 'chat_begin_generation')!.body.p_input_tokens, 2);
    assert.equal(charged, 10); assert.equal(settlements.length, 1); assert.equal(settlements[0].p_refund, false);
    reset(); shrink = 3;
    await consume({ action: 'admin_test', model_id: MID, prompt: 'test', max_output_tokens: 20 });
    assert.equal(upstreamBodies[0].max_output_tokens, 3); assert.equal(audits[0].max_output_tokens, 3);
  });
  await test('unknown post-fetch failures retain reservation; only pre-fetch abort refunds', async () => {
    for (const failure of ['network', 'http', 'eof', 'failed', 'incomplete', 'malformed', 'hanging']) {
      reset(); mode = failure;
      const response = await handler(request(payload()));
      if (failure === 'hanging') await response.body!.cancel();
      else await response.text().catch(() => undefined);
      assert.equal(charged, 102, failure); assert.equal(settlements.length, 1); assert.equal(settlements[0].p_refund, false);
    }
    reset(); const abort = new AbortController(); abort.abort();
    await handler(request(payload(), 'member', abort.signal));
    assert.equal(upstreamBodies.length, 0); assert.equal(charged, 0); assert.equal(settlements[0].p_refund, true);
  });
  for (const endpoint of ['/v1/responses', '/v1/responses/']) await test(`explicit Responses endpoint ${endpoint}`, async () => {
    provider.base_url = 'https://provider.example.com' + endpoint;
    await consume(); assert.equal(audits[0].status, 'completed');
    await expectStatus({ action: 'admin_save_provider', ...provider }, 200);
  });
  const chunk = (value: Row) => `data: ${JSON.stringify(value)}\r\n\r\n`;
  const chatWire = chunk({ choices: [{ index: 0, delta: { role: 'assistant', content: '你好' }, finish_reason: null }] }) + chunk({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + chunk({ choices: [], usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 } }) + 'data: [DONE]\r\n\r\n';
  const messagesWire = event('message_start', { message: { usage: { input_tokens: 4, cache_read_input_tokens: 2, cache_creation_input_tokens: 1, output_tokens: 1 } } }) + event('content_block_start', { content_block: { type: 'text', text: '' } }) + event('content_block_delta', { delta: { type: 'text_delta', text: '你好' } }) + event('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } }) + event('message_stop');
  for (const api_protocol of ['responses', 'messages', 'chat']) {
    const endpoint = api_protocol === 'chat' ? 'chat/completions' : api_protocol;
    for (const auth_header of ['authorization', 'x-api-key']) await test(`explicit ${api_protocol} from bare v1 with independent ${auth_header} auth`, async () => {
      provider.api_protocol = api_protocol; provider.auth_header = auth_header;
      if (api_protocol !== 'responses') { model.preserve_reasoning = false; model.reasoning_efforts = []; model.default_reasoning_effort = null; }
      wire = api_protocol === 'chat' ? chatWire : api_protocol === 'messages' ? messagesWire : null;
      await expectStatus({ action: 'admin_save_provider', ...provider }, 200);
      await expectStatus({ action: 'admin_save_model', ...model }, 200);
      for (const body of [payload(), { action: 'admin_test', model_id: MID, prompt: 'check explicit dispatch' }]) {
        assert.match(await consume(body), /response.completed/);
        assert.equal(requests.filter(url => url.origin === 'https://provider.example.com').at(-1)!.pathname, `/v1/${endpoint}`);
        const sent = upstreamBodies.at(-1)!;
        assert.equal(sent.model, 'local-model');
        assert.equal(sent[api_protocol === 'responses' ? 'max_output_tokens' : api_protocol === 'chat' ? 'max_completion_tokens' : 'max_tokens'], 100);
        assert.equal(Array.isArray(sent[api_protocol === 'responses' ? 'input' : 'messages']), true);
      }
      assert.equal(audits.length, 2); assert.ok(audits.every(row => row.status === 'completed' && row.total_tokens === 10));
    });
    for (const suffix of ['responses', 'messages', 'message', 'chat/completions']) await test(`explicit ${api_protocol} overrides ${suffix} suffix and retains gateway path`, async () => {
      provider.api_protocol = api_protocol; provider.base_url = `https://provider.example.com/gateway/v1/${suffix}/`;
      model.preserve_reasoning = false; model.reasoning_efforts = []; model.default_reasoning_effort = null;
      wire = api_protocol === 'chat' ? chatWire : api_protocol === 'messages' ? messagesWire : null;
      assert.match(await consume(), /response.completed/);
      assert.equal(requests.filter(url => url.origin === 'https://provider.example.com').at(-1)!.pathname, `/gateway/v1/${endpoint}`);
      assert.equal(audits[0].status, 'completed');
    });
  }
  await test('explicit protocols retain capability errors on provider/model saves and both generation paths', async () => {
    for (const api_protocol of ['messages', 'chat']) {
      reset(); provider.api_protocol = api_protocol;
      for (const body of [payload(), { action: 'admin_test', model_id: MID, prompt: 'test' }, { action: 'admin_save_model', ...model }, { action: 'admin_save_provider', ...provider }]) {
        assert.deepEqual(await (await expectStatus(body, 400)).json(), { error: 'reasoning_history_unsupported' });
      }
      model.preserve_reasoning = false; model.reasoning_efforts = ['custom-effort']; model.default_reasoning_effort = 'custom-effort';
      assert.deepEqual(await (await expectStatus(payload(), 400)).json(), { error: 'reasoning_effort_unsupported' });
      assert.equal(audits.length, 0); assert.equal(upstreamBodies.length, 0); assert.equal(providerWrites.length, 0);
    }
    reset(); provider.api_protocol = 'messages'; model.preserve_reasoning = false;
    assert.deepEqual(await (await expectStatus({ action: 'admin_save_provider', ...provider }, 400)).json(), { error: 'reasoning_budget' });
    // An explicit Responses selection permits native reasoning even with a Messages suffix.
    reset(); provider.api_protocol = 'responses'; provider.base_url += '/messages';
    await expectStatus({ action: 'admin_save_model', ...model }, 200);
    await expectStatus({ action: 'admin_save_provider', ...provider }, 200);
    assert.match(await consume(), /response.completed/);
    assert.equal(upstreamBodies[0].include instanceof Array, true);
  });
  for (const format of ['messages', 'message', 'chat/completions']) {
    const setup = () => {
      provider.base_url = `https://provider.example.com/v1/${format}`;
      provider.auth_header = format === 'messages' ? 'x-api-key' : 'authorization';
      model.preserve_reasoning = false; model.reasoning_efforts = []; model.default_reasoning_effort = null;
      wire = format === 'chat/completions' ? chatWire : messagesWire;
    };
    await test(`${format} translates multi-turn attachments, completion and usage`, async () => {
      setup(); shrink = 12;
      const response = await handler(request(payload({ input: [
        { role: 'system', content: [{ type: 'input_text', text: 'system instruction' }] }, message('first'),
        { role: 'assistant', content: [{ type: 'output_text', text: 'previous' }] },
        { role: 'user', content: [{ type: 'input_text', text: 'next' }, { type: 'input_image', image_url: 'data:image/png;base64,aGVsbG8=' }, { type: 'input_file', filename: 'x.pdf', file_data: 'data:application/pdf;base64,JVBERg==' }] }
      ] })));
      assert.equal(response.status, 200); assert.equal(response.headers.get('x-chat-max-output-tokens'), '12');
      const text = await response.text(); assert.match(text, /response.output_text.delta/); assert.match(text, /你好/); assert.match(text, /response.completed/);
      assert.doesNotMatch(text, /message_delta|chat.completion/);
      const body = upstreamBodies[0] as Row;
      assert.equal(body.input, undefined); assert.equal(body.include, undefined);
      assert.equal(body[format === 'chat/completions' ? 'max_completion_tokens' : 'max_tokens'], 12);
      assert.equal(audits[0].total_tokens, 10); assert.equal(audits[0].input_tokens, 7); assert.equal(charged, 10); assert.equal(finishAttempts, 1);
      assert.doesNotMatch(JSON.stringify(audits), /system instruction|previous|aGVsbG8|JVBERg/);
    });
    await test(`${format} accepts compatible saves and admin tests`, async () => {
      setup();
      await expectStatus({ action: 'admin_save_model', ...model }, 200);
      await expectStatus({ action: 'admin_save_provider', ...provider }, 200);
      await consume({ action: 'admin_test', model_id: MID, prompt: 'check native protocol', max_output_tokens: 9 });
      assert.equal(upstreamBodies[0][format === 'chat/completions' ? 'max_completion_tokens' : 'max_tokens'], 9);
      assert.equal(audits[0].action, 'admin_test');
    });
    await test(`${format} rejects incompatible configured capabilities before quota`, async () => {
      setup(); model.preserve_reasoning = true;
      const result = await expectStatus(payload(), 400); assert.equal((await result.json()).error, 'reasoning_history_unsupported');
      await expectStatus({ action: 'admin_save_model', ...model }, 400);
      await expectStatus({ action: 'admin_save_provider', ...provider }, 400);
      model.preserve_reasoning = false; model.reasoning_efforts = ['unsupported'];
      const result2 = await expectStatus(payload(), 400); assert.equal((await result2.json()).error, 'reasoning_effort_unsupported');
      assert.equal(audits.length, 0); assert.equal(upstreamBodies.length, 0);
    });
    await test(`${format} incomplete and interrupted settlement`, async () => {
      setup(); wire = format === 'chat/completions' ? chatWire.replace('"stop"', '"length"') : messagesWire.replace('"end_turn"', '"max_tokens"');
      assert.match(await consume(), /response.incomplete/); assert.equal(audits[0].status, 'incomplete'); assert.equal(charged, 10);
      reset(); setup(); wire = wire!.slice(0, wire!.indexOf(format === 'chat/completions' ? 'data: [DONE]' : 'data: {"type":"message_stop"'));
      assert.doesNotMatch(await consume(), /response.completed/); assert.equal(audits[0].status, 'interrupted'); assert.equal(charged, 102);
    });
    await test(`${format} cancellation and terminal database failure`, async () => {
      setup(); mode = 'hanging'; const response = await handler(request(payload())); await response.body!.cancel();
      assert.equal(audits[0].status, 'cancelled'); assert.equal(finishAttempts, 1); assert.ok(upstreamSignal!.aborted);
      reset(); setup(); finishFail = true;
      const failureResponse = await handler(request(payload()));
      const reader = failureResponse.body!.getReader(); let received = '';
      await assert.rejects(async () => { while (true) { const part = await reader.read(); if (part.done) break; received += new TextDecoder().decode(part.value); } });
      assert.doesNotMatch(received, /response.completed/); assert.equal(released, 0); assert.equal(finishAttempts, 1);
      reset(); setup(); mode = 'hanging'; const abort = new AbortController();
      const abortResponse = await handler(request(payload(), 'member', abort.signal)); const pending = abortResponse.text(); abort.abort();
      await assert.rejects(pending); assert.equal(audits[0].status, 'cancelled'); assert.equal(finishAttempts, 1);
    });
  }
  await test('Anthropic thinking budgets track quota and refund before dispatch when too small', async () => {
    provider.base_url = 'https://provider.example.com/v1/messages'; model.preserve_reasoning = false;
    model.max_output_tokens = 10000; model.default_max_output_tokens = 9000; model.reasoning_efforts = ['none', 'low', 'medium', 'high']; model.default_reasoning_effort = 'high'; wire = messagesWire;
    shrink = 1500; await consume(); assert.deepEqual(upstreamBodies[0].thinking, { type: 'enabled', budget_tokens: 1499 });
    reset(); provider.base_url = 'https://provider.example.com/v1/messages'; model.preserve_reasoning = false;
    model.max_output_tokens = 10000; model.default_max_output_tokens = 9000; model.default_reasoning_effort = 'high'; wire = messagesWire;
    shrink = 100; await expectStatus(payload(), 400); assert.equal(upstreamBodies.length, 0); assert.equal(charged, 0); assert.equal(settlements[0].p_refund, true);
  });
  await test('HTTP method, malformed body and CORS', async () => {
    assert.equal((await handler(new Request('http://localhost/chat'))).status, 405);
    assert.equal((await handler(new Request('http://localhost/chat', { method: 'POST', body: '{' }))).status, 400);
    assert.equal((await handler(new Request('http://localhost/chat', { method: 'OPTIONS', headers: { origin: 'https://evil.example.com' } }))).status, 403);
    const response = await handler(new Request('http://localhost/chat', { method: 'OPTIONS', headers: { origin: 'http://localhost:4173' } })); assert.equal(response.status, 204); assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:4173');
  });
  console.log(`Chat backend: ${count} real-handler mock integration cases passed; network permission disabled.`);
} finally {
  globalThis.fetch = originalFetch; Deno.resolveDns = originalDns;
}
