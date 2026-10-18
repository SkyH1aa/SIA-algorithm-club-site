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
let calls = 0, releases = 0, admissions = 0, body: Uint8Array, signal: AbortSignal | undefined, hang = false, delayAdmission = 0, networkError = false;
let endpoint = 'responses', expectedUrl = '', expectedVersion = '2023-06-01', expectedBeta: string | null = null;
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
    assert.equal(data.p_key_hash, digest); assert.equal(data.p_route_id, RID); admissions++;
    assert.equal(data.p_key_limit, 2); assert.equal(data.p_route_limit, 20);
    if (delayAdmission) await new Promise(resolve => setTimeout(resolve, delayAdmission));
    return Response.json(admission === 'ok' ? { route: { base_url: base, secret_name: 'CHAT_KEY_TEST' } } : { code: admission });
  }
  assert.equal(u.href, expectedUrl || `https://vendor.example.com/v1/${endpoint}`);
  calls++; body = init.body as Uint8Array; signal = init.signal!;
  if (networkError) throw new Error('upstream-secret https://private.example');
  const h = new Headers(init.headers);
  assert.equal(h.get('authorization'), endpoint === 'messages' ? null : 'Bearer upstream-secret');
  assert.equal(h.get('x-api-key'), endpoint === 'messages' ? 'upstream-secret' : null);
  assert.equal(h.get('anthropic-version'), endpoint === 'messages' ? expectedVersion : null);
  assert.equal(h.get('anthropic-beta'), endpoint === 'messages' ? expectedBeta : null);
  assert.equal(h.get('openai-beta'), endpoint === 'messages' ? null : expectedBeta);
  assert.equal(h.get('content-type'), 'application/json');
  assert.equal(h.get('accept'), 'application/json, text/event-stream');
  assert.equal(h.get('accept-encoding'), 'identity');
  assert.equal([...h].length, (endpoint === 'messages' ? 5 : 4) + Number(expectedBeta !== null));
  for (const name of ['cookie', 'apikey', 'x-supabase-api-version', 'x-client-info', 'anthropic-dangerous-direct-browser-access', 'x-forwarded-authorization']) assert.equal(h.get(name), null);
  return new Response([204,205,304].includes(status) ? null : new ReadableStream<Uint8Array>({
    pull(c) { if (hang) return new Promise(() => {}); if (responseBytes.length) { c.enqueue(responseBytes.slice(0,1)); responseBytes = responseBytes.slice(1); } else c.close(); }
  }), { status, headers: { 'content-type': contentType, 'set-cookie': 'secret', server: 'private', location: 'https://private.example', 'x-debug-key': 'secret' } });
}) as typeof fetch;
function request(raw: BodyInit = '{ "model":"untouched", "tools":[{"type":"web_search"}], "stream":false }', headers: Record<string,string | null | undefined> = {}, path = `/${RID}/v1/responses`, method = 'POST', abortSignal?: AbortSignal) {
  const h = new Headers({ authorization: `Bearer ${key}`, 'content-type': 'application/json', cookie: 'client-cookie', apikey: 'client-supabase-key' });
  for (const [name, value] of Object.entries(headers)) { if (value === null) h.delete(name); else if (value !== undefined) h.set(name, value); }
  return new Request(`https://site.example/functions/v1/chat-api-proxy${path}`, { method, headers: h, ...(method === 'POST' ? { body: raw } : {}), signal: abortSignal });
}
let n=0;
async function test(name: string, run: () => Promise<void>) {
  calls=0; releases=0; admissions=0; status=200; contentType='application/json'; admission='ok'; base='https://vendor.example.com/v1'; dns='public'; hang=false; delayAdmission=0; networkError=false;
  endpoint='responses'; expectedUrl=''; expectedVersion='2023-06-01'; expectedBeta=null;
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
  await test('SSRF DNS and loopback, malformed endpoints rejected', async () => {
    for (const value of ['http://vendor.example.com/v1','https://127.0.0.1','https://10.0.0.1','https://user:pass@vendor.example.com','https://vendor.example.com/v1/response','https://vendor.example.com/v1/%72esponses','https://db.example.com/v1','https://vendor.example.com/chat-api-proxy/messages','https://vendor.example.com/?x=y','https://vendor.example.com/#x','https://vendor.example.com:444/v1','https://vendor.internal/v1']) await assert.rejects(()=>proxyBase(value));
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
  await test('native JSON and fragmented SSE preserve request and response bytes on every endpoint', async () => {
    for (const native of ['responses', 'messages', 'chat/completions', 'message']) {
      endpoint = native === 'message' ? 'messages' : native;
      for (const stream of [false, true]) {
        const raw = new TextEncoder().encode(` { "model":"native", "messages":[{"role":"user","content":[{"type":"text","text":"你好"}]}], "tools":[], "stream":${stream}, "unknown":1e+02, "escaped":"\\u4f60" }\r\n`);
        let offset = 0;
        const input = new ReadableStream<Uint8Array>({ pull(c) { if (offset < raw.length) c.enqueue(raw.slice(offset, ++offset)); else c.close(); } });
        contentType = stream ? 'text/event-stream; charset=utf-8' : 'application/json; charset=utf-8';
        responseBytes = new TextEncoder().encode(stream ? ': ping\r\nevent: content_block_delta\r\ndata: {"delta":"你好"}\r\n\r\ndata: [DONE]\n\n' : '{ "native":true, "delta":"你好", "unknown":1e+02 }\r\n');
        const expected = responseBytes.slice();
        const r = await handler(request(input, { 'x-client-info': 'supabase-client', 'x-supabase-api-version': 'secret', 'x-forwarded-authorization': 'client-token', 'anthropic-dangerous-direct-browser-access': 'true' }, `/${RID}/v1/${native}`));
        assert.equal(r.status, 200); assert.deepEqual(body, raw);
        assert.equal(r.headers.get('content-type'), contentType);
        assert.deepEqual(new Uint8Array(await r.arrayBuffer()), expected);
      }
    }
    assert.equal(calls, 8); assert.equal(releases, 8);
  });
  await test('messages accepts Bearer, x-api-key or matching dual capabilities, including alias', async () => {
    endpoint = 'messages';
    for (const native of ['messages', 'message']) {
      for (const headers of [{}, { authorization: null, 'x-api-key': key }, { 'x-api-key': key }]) {
        const r = await handler(request('{}', headers, `/${RID}/v1/${native}`));
        assert.equal(r.status, 200); await r.arrayBuffer();
      }
    }
    assert.equal(admissions, 6); assert.equal(releases, 6);
  });
  await test('missing, conflicting and Supabase credentials fail before admission on every endpoint', async () => {
    for (const native of ['responses', 'messages', 'message', 'chat/completions']) {
      for (const headers of [
        { authorization: null }, { authorization: 'Bearer supabase-jwt' },
        { authorization: `Bearer ${key}`, 'x-api-key': newKey() },
        { authorization: `Bearer ${key}`, 'x-api-key': 'client-supabase-key' },
        { authorization: 'Bearer supabase-jwt', 'x-api-key': key },
        { authorization: null, 'x-api-key': 'client-supabase-key' },
        { authorization: `Bearer ${key}, Bearer ${key}` },
        { authorization: null, 'x-api-key': `${key}, ${key}` }
      ]) assert.equal((await handler(request('{}', headers, `/${RID}/v1/${native}`))).status, 401);
    }
    for (const native of ['responses', 'chat/completions']) {
      assert.equal((await handler(request('{}', { authorization: null, 'x-api-key': key }, `/${RID}/v1/${native}`))).status, 401);
      assert.equal((await handler(request('{}', { 'x-api-key': key }, `/${RID}/v1/${native}`))).status, 401);
    }
    assert.equal(admissions, 0); assert.equal(calls, 0); assert.equal(releases, 0);
  });
  await test('only endpoint-specific validated version and beta headers reach upstream', async () => {
    for (const native of ['responses', 'chat/completions', 'messages']) {
      endpoint = native;
      expectedVersion = '2023-06-01';
      expectedBeta = native === 'messages' ? 'prompt-caching-2024-07-31, tools-2024-04-04' : 'responses=v1, assistants=v2';
      const r = await handler(request('{}', {
        'anthropic-version': expectedVersion,
        'anthropic-beta': native === 'messages' ? expectedBeta : 'must-not-forward',
        'openai-beta': native === 'messages' ? 'must-not-forward' : expectedBeta,
      }, `/${RID}/v1/${native}`));
      assert.equal(r.status, 200); await r.arrayBuffer();
    }
    const before = calls;
    for (const headers of [
      { 'anthropic-version': '2023-02-29' }, { 'anthropic-version': 'latest' },
      { 'anthropic-version': '2023-06-01, 2023-06-01' }, { 'anthropic-beta': '' },
      { 'anthropic-beta': 'token;secret=value' }, { 'anthropic-beta': 'token,' },
      { 'anthropic-beta': 'x'.repeat(1025) }, { 'anthropic-beta': 'https://private.example' }
    ]) assert.equal((await handler(request('{}', headers, `/${RID}/v1/messages`))).status, 400);
    for (const native of ['responses', 'chat/completions']) assert.equal((await handler(request('{}', { 'openai-beta': 'token;secret=value' }, `/${RID}/v1/${native}`))).status, 400);
    assert.equal(calls, before); assert.equal(releases, admissions);
  });
  await test('base and explicit endpoint URLs normalize before selecting each native endpoint', async () => {
    for (const prefix of ['/v1', '/gateway/provider/v1', '']) {
      for (const suffix of ['', '/responses', '/messages', '/message', '/chat/completions']) {
        base = `https://vendor.example.com${prefix}${suffix}/`;
        assert.equal(await proxyBase(base), `https://vendor.example.com${prefix}`);
        for (const native of ['responses', 'messages', 'chat/completions']) {
          endpoint = native; expectedUrl = `https://vendor.example.com${prefix}/${native}`;
          const r = await handler(request('{}', {}, `/${RID}/v1/${native}`));
          assert.equal(r.status, 200); await r.arrayBuffer();
        }
      }
    }
    assert.equal(calls, 45); assert.equal(releases, 45);
  });
  await test('preflight allows only native credential/version/beta headers on canonical and alias paths', async () => {
    for (const native of ['responses', 'chat/completions', 'messages', 'message']) {
      const r = await handler(request('{}', { origin: 'https://allowed.example' }, `/${RID}/v1/${native}`, 'OPTIONS'));
      assert.equal(r.status, 204);
      const claude = native === 'messages' || native === 'message';
      assert.equal(r.headers.get('access-control-allow-headers'), claude ? 'authorization, content-type, x-api-key, anthropic-version, anthropic-beta' : 'authorization, content-type, openai-beta');
      assert.equal(r.headers.get('access-control-allow-credentials'), null);
      for (const suffix of ['/', '?target=x']) assert.equal((await handler(request('{}', {}, `/${RID}/v1/${native}${suffix}`))).status, 404);
      assert.equal((await handler(request('{}', {}, `/${RID}/v1/${native}`, 'GET'))).status, 405);
    }
    assert.equal(calls, 0); assert.equal(admissions, 0);
  });
  await test('revoked routes, busy leases, deadlines, redirects and stream cancellation cover new endpoints', async () => {
    for (const native of ['messages', 'chat/completions', 'message']) {
      endpoint = native === 'message' ? 'messages' : native;
      for (const code of ['invalid_key', 'disabled', 'revoked', 'busy']) {
        admission = code; const before = calls;
        assert.equal((await handler(request('{}', {}, `/${RID}/v1/${native}`))).status, code === 'busy' ? 429 : 401);
        assert.equal(calls, before);
      }
      admission = 'ok'; hang = true;
      let beforeRelease = releases;
      const r = await handler(request('{}', {}, `/${RID}/v1/${native}`));
      assert.equal(r.status, 200); await r.body!.cancel();
      assert.equal(signal!.aborted, true); assert.equal(releases, beforeRelease + 1);
      Deno.env.set('CHAT_PROXY_TIMEOUT_MS', '20');
      beforeRelease = releases;
      const timed = await handler(request('{}', {}, `/${RID}/v1/${native}`));
      await new Promise(resolve => setTimeout(resolve, 60)); await assert.rejects(() => timed.text());
      assert.equal(signal!.aborted, true); assert.equal(releases, beforeRelease + 1);
      Deno.env.delete('CHAT_PROXY_TIMEOUT_MS'); hang = false; status = 307;
      const redirect = await handler(request('{}', {}, `/${RID}/v1/${native}`));
      assert.equal(redirect.status, 307); assert.equal(redirect.headers.get('location'), null); assert.doesNotMatch(await redirect.text(), /private|secret/);
      status = 200; networkError = true;
      const failed = await handler(request('{}', {}, `/${RID}/v1/${native}`));
      assert.equal(failed.status, 502); assert.doesNotMatch(await failed.text(), /private|secret/); networkError = false;
    }
  });
  await test('tiny and empty request fragments preserve bytes with bounded aggregation', async () => {
    const raw = new TextEncoder().encode(` {"opaque":"${'x'.repeat(70000)}你好","tools":[],"stream":false} \r\n`);
    let offset = 0, empty = false;
    const input = new ReadableStream<Uint8Array>({ pull(c) {
      if (offset === raw.length) { c.close(); return; }
      empty = !empty;
      c.enqueue(empty ? new Uint8Array() : raw.subarray(offset, ++offset));
    } });
    const r = await handler(request(input, { 'content-length': '1' }));
    assert.equal(r.status, 200); assert.deepEqual(body, raw); await r.arrayBuffer();
    assert.equal(input.locked, false); assert.equal(releases, 1);
  });
  await test('actual body overflow cancels underreported stream and releases admission', async () => {
    let cancelled = false, reads = 0;
    const input = new ReadableStream<Uint8Array>({ pull(c) {
      reads++; c.enqueue(new Uint8Array(64 * 1024));
    }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
    const r = await handler(request(input, { 'content-length': '1' }));
    assert.equal(r.status, 413); assert.equal((await r.json()).error.code, 'request_too_large');
    assert.equal(reads, 193); assert.equal(cancelled, true); assert.equal(input.locked, false);
    assert.equal(calls, 0); assert.equal(releases, 1);
  });
  await test('body deadline and client abort cancel a pending read and release once', async () => {
    for (const clientAbort of [false, true]) {
      Deno.env.set('CHAT_PROXY_TIMEOUT_MS', clientAbort ? '120000' : '20');
      const abort = new AbortController(); let cancelled = false, started!: () => void;
      const reading = new Promise<void>(resolve => { started = resolve; });
      const input = new ReadableStream<Uint8Array>({ pull() { started(); return new Promise(() => {}); }, cancel() { cancelled = true; return new Promise(() => {}); } }, { highWaterMark: 0 });
      const before = releases;
      const pending = handler(request(input, {}, `/${RID}/v1/responses`, 'POST', abort.signal));
      await reading; if (clientAbort) abort.abort();
      const r = await pending;
      assert.equal(r.status, 504); assert.equal((await r.json()).error.code, 'timeout');
      assert.equal(cancelled, true); assert.equal(input.locked, false); assert.equal(releases, before + 1);
    }
    assert.equal(calls, 0); assert.equal(releases, 2);
  });
  await test('invalid capability never reads request body or acquires a lease', async () => {
    let reads = 0;
    const input = new ReadableStream<Uint8Array>({ pull() { reads++; return new Promise(() => {}); } }, { highWaterMark: 0 });
    assert.equal((await handler(request(input, { authorization: 'Bearer invalid' }))).status, 401);
    assert.equal(reads, 0); assert.equal(input.locked, false); assert.equal(admissions, 0); assert.equal(calls, 0);
    await input.cancel();
  });
  console.log(`${n} proxy groups passed; no real network calls.`);
} finally { globalThis.fetch=fetchOriginal; Deno.resolveDns=dnsOriginal; }
