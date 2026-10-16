// Run: npm exec --yes --package=deno -- deno run --allow-env tools/test-chat-backend.ts
// No network permission: every fetch and DNS query is intercepted in this process.
import { strict as assert } from 'node:assert';

Deno.env.set('CHAT_TEST_MODE', '1');
Deno.env.set('SUPABASE_URL', 'http://127.0.0.1:19999');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'local-service');
Deno.env.set('SUPABASE_ANON_KEY', 'local-anon');
Deno.env.set('CHAT_KEY_MOCK', 'local-provider-secret');
Deno.env.set('CHAT_CORS_ORIGINS', 'http://localhost:4173');
const { handler } = await import('../supabase/functions/chat/index.ts');
const UID = '11111111-1111-4111-8111-111111111111';
const PID = '22222222-2222-4222-8222-222222222222';
const MID = '33333333-3333-4333-8333-333333333333';
type Row = Record<string, unknown>;
const originalFetch = globalThis.fetch;
const originalDns = Deno.resolveDns;
const encoder = new TextEncoder();
const providerBase = { id: PID, name: 'mock', label: 'Local Provider', base_url: 'https://provider.example.com/v1', secret_name: 'CHAT_KEY_MOCK', auth_header: 'authorization', enabled: true };
const modelBase = { id: MID, provider_id: PID, model_key: 'local-model', display_name: 'Local Model', context_window: 1000000, max_output_tokens: 1000, default_max_output_tokens: 100, reasoning_efforts: ['low', 'high'], default_reasoning_effort: 'low', supports_images: true, supports_pdf: true, preserve_reasoning: true, enabled: true };
let provider: Row, model: Row, profile: boolean, admin: boolean, auditFail: boolean, startFail: boolean, finishFail: boolean, busy: boolean;
let dnsMode: string, mode: string, upstreamSignal: AbortSignal | undefined;
let audits: Row[], patches: Row[], upstreamBodies: Array<Row & { input: Array<{ content: Array<{ text: string }> }> }>, requests: URL[], released: number, finishAttempts: number, leased: boolean;
let usageRange: string | null;
let terminalGate: Promise<void> | null, terminalReached: (() => void) | null;
function reset() {
  terminalGate = null; terminalReached = null;
  provider = { ...providerBase }; model = { ...modelBase }; profile = true; admin = true;
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
  let content = delta + completed;
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
    assert.equal(url.pathname, '/v1/responses');
    assert.equal(init.redirect, 'error');
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer local-provider-secret');
    assert.equal(audits.length, 1, 'audit must precede upstream');
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
  if (table === 'chat_providers') return json(init.method === 'POST' ? [{ ...provider, ...JSON.parse(String(init.body)) }] : [provider]);
  if (table === 'chat_models') return json(init.method === 'POST' ? [{ ...model, ...JSON.parse(String(init.body)) }] : [model]);
  if (table === 'rpc/chat_acquire_generation_lease') {
    const row = JSON.parse(String(init.body));
    assert.equal(row.p_user_id, UID); assert.ok(Date.parse(row.p_expires_at) > Date.now());
    if (busy || leased) return json(false);
    leased = true; return json(true);
  }
  if (table === 'rpc/chat_release_generation_lease') {
    const row = JSON.parse(String(init.body));
    if (audits.length) assert.equal(row.p_request_id, audits[0].request_id);
    assert.equal(row.p_user_id, UID); released++; leased = false; return json(null);
  }
  if (table === 'chat_usage') {
    if (init.method === 'POST') {
      if (auditFail) return json({}, 503);
      const row = JSON.parse(String(init.body)); audits.push(row); return json([{ id: UID, ...row }]);
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
  const response = await handler(request(body)); assert.equal(response.status, 200); return await response.text();
}
let count = 0;
async function test(name: string, fn: () => Promise<void>) {
  reset(); await fn(); count++; console.log(`PASS ${name}`);
}
try {
  await test('authentication, profile binding, dynamic admin permission', async () => {
    await expectStatus({ action: 'catalog' }, 401, null); await expectStatus({ action: 'catalog' }, 401, 'invalid');
    profile = false; await expectStatus(payload(), 403);
    admin = false; await expectStatus({ action: 'admin_get' }, 403); await expectStatus({ action: 'admin_test', model_id: MID, prompt: 'test' }, 403);
    assert.equal(upstreamBodies.length, 0);
  });
  await test('catalog hides disabled models/providers and secrets', async () => {
    let result = await (await expectStatus({ action: 'catalog' }, 200)).json();
    assert.equal(result.models.length, 1); assert.equal(result.member_name, '测试会员'); assert.ok(!JSON.stringify(result).includes('CHAT_KEY'));
    provider.enabled = false; result = await (await expectStatus({ action: 'catalog' }, 200)).json(); assert.equal(result.models.length, 0);
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
    assert.ok(audits[0].input_bytes < 12 * 1024 * 1024);
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
  await test('admin model save and invalid configuration', async () => {
    const { id: _id, ...fields } = modelBase;
    await expectStatus({ action: 'save_model', ...fields }, 200);
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
    for (const url of ['http://provider.example.com', 'https://127.0.0.1', 'https://169.254.169.254', 'https://[::1]', 'https://localhost', 'https://x.local', 'https://u:p@provider.example.com', 'https://provider.example.com?x=1', 'https://provider.example.com#x', 'https://provider.example.com:444', 'https://provider.example.com/v1/responses']) { provider.base_url = url; await expectStatus(payload(), 400); }
    assert.equal(upstreamBodies.length, 0);
  });
  for (const failure of ['network', 'http', 'wrong-content']) await test(`upstream ${failure} redaction and release`, async () => {
    mode = failure; const response = await expectStatus(payload(), 502); assert.deepEqual(await response.json(), { error: 'upstream' }); assert.equal(audits[0].status, 'failed'); assert.equal(released, 1);
  });
  await test('audit insertion fails closed before provider and releases lease', async () => {
    auditFail = true; await expectStatus(payload(), 503); assert.equal(upstreamBodies.length, 0); assert.equal(released, 1);
  });
  await test('upstream-start audit failure aborts provider and releases lease', async () => {
    startFail = true; await expectStatus(payload(), 503); assert.ok(upstreamSignal!.aborted); assert.equal(released, 1);
  });
  await test('terminal audit failure does not deliver completed success', async () => {
    finishFail = true; await assert.rejects(consume()); assert.ok(upstreamSignal!.aborted); assert.equal(released, 1); assert.notEqual(audits[0].status, 'completed');
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
