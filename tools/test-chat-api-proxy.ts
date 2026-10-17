// No network permission: fetch and DNS are fully mocked.
// npm exec --yes --package=deno -- deno run --allow-env tools/test-chat-api-proxy.ts
import { strict as assert } from 'node:assert';
Deno.env.set('CHAT_TEST_MODE', '1');
Deno.env.set('SUPABASE_URL', 'https://db.example.com');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service-secret');
Deno.env.set('CHAT_KEY_TEST', 'upstream-secret');
const { handler } = await import('../supabase/functions/chat-api-proxy/index.ts');
const { newKey, hashKey, proxyBase } = await import('../supabase/functions/_shared/chat-api-proxy.ts');
const RID = '11111111-1111-4111-8111-111111111111';
const key = newKey(), digest = await hashKey(key);
assert.match(key, /^cap_[A-Za-z0-9_-]{43}$/); assert.match(digest, /^[a-f0-9]{64}$/);
let status = 200, contentType = 'application/json', admission = 'ok', base = 'https://vendor.example.com/v1', dns = 'public';
let calls = 0, releases = 0, body: Uint8Array, signal: AbortSignal | undefined, hang = false, delayAdmission = 0, networkError = false;
let responseBytes = new TextEncoder().encode('{ "output": [], "opaque": "你好" }');
const fetchOriginal = globalThis.fetch, dnsOriginal = Deno.resolveDns;
Deno.resolveDns = ((_: string, family: string) => {
  if (dns === 'hang') return new Promise(() => {});
  if (dns === 'failure') return Promise.reject(new Deno.errors.PermissionDenied());
  return Promise.resolve(family === 'A' ? dns === 'private' ? ['127.0.0.1'] : dns === 'mixed' ? ['8.8.8.8', '10.0.0.1'] : ['8.8.8.8'] : []);
}) as typeof Deno.resolveDns;
globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
  const u = new URL(String(input));
  assert.equal(init.redirect, 'error');
  if (u.hostname === 'db.example.com') {
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer service-secret');
    const data = JSON.parse(String(init.body));
    if (u.pathname.endsWith('chat_proxy_release')) { releases++; return Response.json(null); }
    assert.equal(data.p_key_hash, digest); assert.equal(data.p_route_id, RID);
    assert.equal(data.p_key_limit, 2); assert.equal(data.p_route_limit, 20);
    if (delayAdmission) await new Promise(resolve => setTimeout(resolve, delayAdmission));
    return Response.json(admission === 'ok' ? { route: { base_url: base, secret_name: 'CHAT_KEY_TEST' } } : { code: admission });
  }
  assert.equal(u.href, 'https://vendor.example.com/v1/responses');
  calls++; body = init.body as Uint8Array; signal = init.signal!;
  if (networkError) throw new Error('upstream-secret https://private.example');
  const h = new Headers(init.headers);
  assert.equal(h.get('authorization'), 'Bearer upstream-secret');
  assert.equal([...h].length, 4); assert.equal(h.get('cookie'), null); assert.equal(h.get('apikey'), null);
  return new Response([204,205,304].includes(status) ? null : new ReadableStream<Uint8Array>({
    pull(c) { if (hang) return new Promise(() => {}); if (responseBytes.length) { c.enqueue(responseBytes.slice(0,1)); responseBytes = responseBytes.slice(1); } else c.close(); }
  }), { status, headers: { 'content-type': contentType, 'set-cookie': 'secret', server: 'private', location: 'https://private.example', 'x-debug-key': 'secret' } });
}) as typeof fetch;
function request(raw = '{ "model":"untouched", "tools":[{"type":"web_search"}], "stream":false }', headers: Record<string,string> = {}, path = `/${RID}/v1/responses`, method = 'POST', abortSignal?: AbortSignal) {
  return new Request(`https://site.example/functions/v1/chat-api-proxy${path}`, { method, headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', cookie: 'client-cookie', apikey: 'client-supabase-key', ...headers }, ...(method === 'POST' ? { body: raw } : {}), signal: abortSignal });
}
let n=0;
async function test(name: string, run: () => Promise<void>) {
  calls=0; releases=0; status=200; contentType='application/json'; admission='ok'; base='https://vendor.example.com/v1'; dns='public'; hang=false; delayAdmission=0; networkError=false;
  responseBytes = new TextEncoder().encode('{ "output": [], "opaque": "你好" }');
  Deno.env.delete('CHAT_PROXY_TIMEOUT_MS'); Deno.env.delete('CHAT_PROXY_KEY_CONCURRENCY'); Deno.env.delete('CHAT_PROXY_CORS_ORIGINS');
  await run(); n++; console.log(`PASS ${name}`);
}
try {
  await test('byte-exact JSON, arbitrary Responses fields, credential isolation and header allowlist', async () => {
    const raw = '{ "model":"untouched", "tools":[], "stream":false, "new_field":123 }';
    const expected = responseBytes.slice(); const r = await handler(request(raw));
    assert.equal(r.status,200); assert.equal(new TextDecoder().decode(body),raw);
    assert.deepEqual(new Uint8Array(await r.arrayBuffer()),expected);
    for (const h of ['server','set-cookie','location','x-debug-key','content-length','access-control-allow-credentials']) assert.equal(r.headers.get(h),null);
    assert.equal(r.headers.get('access-control-allow-origin'),'*'); assert.equal(releases,1);
  });
  await test('fragmented SSE is not parsed or reserialized', async () => {
    contentType='text/event-stream'; responseBytes=new TextEncoder().encode('data: not-json\r\n\r\ndata: {"delta":"你好"}\n\n');
    const expected=responseBytes.slice(); const r=await handler(request()); assert.deepEqual(new Uint8Array(await r.arrayBuffer()),expected); assert.equal(releases,1);
  });
  await test('non-2xx retains status but sanitizes body and headers', async () => {
    for (const s of [401,429,500,304]) { status=s; const r=await handler(request()); assert.equal(r.status,s); assert.doesNotMatch(await r.text(),/opaque|private|secret/); assert.equal(r.headers.get('location'),null); }
    assert.equal(releases,4);
  });
  await test('204 and 205 empty success', async () => { for (const s of [204,205]) { status=s; const r=await handler(request()); assert.equal(r.status,s); assert.equal(await r.text(),''); } assert.equal(releases,2); });
  await test('HTML success is rejected', async () => { contentType='text/html'; assert.equal((await handler(request())).status,502); assert.equal(releases,1); });
  await test('unknown, disabled, revoked, wrong-route keys and busy admission', async () => {
    for (const code of ['invalid_key','busy']) { admission=code; assert.equal((await handler(request())).status,code==='busy'?429:401); }
    assert.equal(calls,0); assert.equal(releases,0);
  });
  await test('strict path, methods and bearer format', async () => {
    for (const path of [`/${RID}/v1/responses/`,`/${RID}/v1/models`,`/${RID}/v1/responses?target=x`,`/not-uuid/v1/responses`]) assert.equal((await handler(request('{}',{},path))).status,404);
    assert.equal((await handler(request('{}',{},`/${RID}/v1/responses`,'GET'))).status,405);
    assert.equal((await handler(request('{}',{},`/${RID}/v1/responses`,'OPTIONS'))).status,204);
    assert.equal((await handler(request('{}',{authorization:'Bearer invalid'}))).status,401); assert.equal(calls,0);
  });
  await test('compression, invalid content type, JSON and bounded bytes', async () => {
    assert.equal((await handler(request('{}',{'content-encoding':'gzip'}))).status,415);
    assert.equal((await handler(request('{}',{'content-type':'text/plain'}))).status,415);
    assert.equal((await handler(request('invalid'))).status,400);
    assert.equal((await handler(request('{}',{'content-length':String(12*1024*1024+1)}))).status,413);
    assert.equal((await handler(request(' '.repeat(12*1024*1024+1)))).status,413); assert.equal(calls,0);
  });
  await test('SSRF DNS and loopback, singular endpoint rejected', async () => {
    for (const value of ['http://vendor.example.com/v1','https://127.0.0.1','https://10.0.0.1','https://user:pass@vendor.example.com','https://vendor.example.com/v1/response','https://vendor.example.com/v1/responses','https://db.example.com/v1','https://vendor.example.com/chat-api-proxy','https://vendor.example.com/?x=y','https://vendor.example.com/#x']) await assert.rejects(()=>proxyBase(value));
    for (const mode of ['private','mixed','failure']) { dns=mode; assert.equal((await handler(request())).status,400); }
    assert.equal(calls,0); assert.equal(releases,3);
  });
  await test('cancel aborts upstream and releases without reading more bytes', async () => {
    hang=true; const r=await handler(request()); await r.body!.cancel(); assert.equal(signal!.aborted,true); assert.equal(releases,1);
  });
  await test('deadline spans response stream even without downstream reads', async () => {
    Deno.env.set('CHAT_PROXY_TIMEOUT_MS','20'); hang=true;
    const r=await handler(request()); await new Promise(resolve=>setTimeout(resolve,60));
    await assert.rejects(()=>r.text()); assert.equal(signal!.aborted,true); assert.equal(releases,1);
  });
  await test('deadline bounds unresolved DNS', async () => {
    Deno.env.set('CHAT_PROXY_TIMEOUT_MS','20'); dns='hang'; assert.equal((await handler(request())).status,504); assert.equal(releases,1);
  });
  await test('deadline bounds slow request body', async () => {
    Deno.env.set('CHAT_PROXY_TIMEOUT_MS','20');
    const req = new Request(`https://site.example/chat-api-proxy/${RID}/v1/responses`, {method:'POST',headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},body:new ReadableStream({pull(){return new Promise(()=>{});}})});
    assert.equal((await handler(req)).status,504); assert.equal(releases,1);
  });
  await test('late successful admission after timeout still releases', async () => {
    Deno.env.set('CHAT_PROXY_TIMEOUT_MS','20'); delayAdmission=60;
    assert.equal((await handler(request())).status,504);
    await new Promise(resolve=>setTimeout(resolve,90)); assert.equal(releases,1); assert.equal(calls,0);
  });
  await test('network and redirect rejection redact upstream details and release', async () => {
    networkError=true; const r=await handler(request()); assert.equal(r.status,502); assert.doesNotMatch(await r.text(),/private|secret/); assert.equal(releases,1);
  });
  await test('pre-aborted request never calls upstream', async () => {
    const c=new AbortController(); c.abort(); assert.equal((await handler(request('{}',{},`/${RID}/v1/responses`,'POST',c.signal))).status,504); assert.equal(calls,0); assert.equal(releases,0);
  });
  await test('exact CORS allowlist rejects unknown browser origins and preserves CLI auth', async () => {
    Deno.env.set('CHAT_PROXY_CORS_ORIGINS', 'https://allowed.example, http://localhost:4173');
    const allowed = await handler(request('{"model":"ok"}', { origin: 'https://allowed.example' }));
    assert.equal(allowed.status, 200); assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://allowed.example'); await allowed.arrayBuffer();
    const beforeDenied = calls;
    const denied = await handler(request('{"model":"ok"}', { origin: 'https://evil.example' }));
    assert.equal(denied.status, 403); assert.equal(denied.headers.get('access-control-allow-origin'), null); assert.equal(calls, beforeDenied);
    const cli = await handler(request('{"model":"ok"}'));
    assert.equal(cli.status, 200); assert.equal(cli.headers.get('access-control-allow-origin'), null); await cli.arrayBuffer();
  });
  await test('configuration validation fails closed', async () => {
    for (const v of ['0','-1','1.2','NaN','120001']) { Deno.env.set('CHAT_PROXY_TIMEOUT_MS',v); assert.equal((await handler(request())).status,503); }
    Deno.env.delete('CHAT_PROXY_TIMEOUT_MS'); Deno.env.set('CHAT_PROXY_KEY_CONCURRENCY','0'); assert.equal((await handler(request())).status,503); assert.equal(calls,0);
  });
  console.log(`${n} proxy groups passed; no real network calls.`);
} finally { globalThis.fetch=fetchOriginal; Deno.resolveDns=dnsOriginal; }
