// Offline: npm exec --yes deno -- run --allow-read tools/test-chat-archive.ts
// No network: auth, member profile, and WebDAV are mocked in-process.
import { strict as assert } from 'node:assert';

type Row = Record<string, unknown>;
const project = 'https://jgezpvmlnhycxslqbwcx.supabase.co';
const anon = 'mock-anon';
const userId = '12345678-1234-1234-1234-123456789abc';
const member = 'mock-member';
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const encoder = new TextEncoder();

const source = await Deno.readTextFile(new URL('../supabase/functions/club-drive/index.ts', import.meta.url));
let handler!: (request: Request) => Promise<Response>;
const originalServe = Deno.serve, originalGet = Deno.env.get;
try {
  Deno.serve = ((callback: (request: Request) => Promise<Response>) => { handler = callback; return {} as Deno.HttpServer; }) as typeof Deno.serve;
  Deno.env.get = ((key: string) => ({
    SUPABASE_URL: project,
    SUPABASE_ANON_KEY: anon,
    CLUB_SERVICE_ROLE_KEY: 'mock-service',
    WEBDAV_BASE_URL: 'https://webdav.example/root',
    WEBDAV_USERNAME: 'dav-user',
    WEBDAV_PASSWORD: 'dav-pass'
  }[key])) as typeof Deno.env.get;
  await import(`data:application/typescript,${encodeURIComponent(source)}`);
} finally { Deno.serve = originalServe; Deno.env.get = originalGet; }
assert.equal(typeof handler, 'function');

const originalFetch = globalThis.fetch;
let profile: Row = { username: 'xiaoming', member_name: '张三' };
let profileOk = true;
let davCalls: Array<{ method: string; url: string; body?: Uint8Array<ArrayBuffer>; headers: Headers }> = [];
let davFail: number | null = null;
let davMkcolStatus: number | null = null;
let davPutRecovery = false;
const authFetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.pathname === '/auth/v1/user') return json({ id: userId, email: `${userId}@club.local` });
  if (url.pathname === '/rest/v1/club_member_profiles') {
    assert.equal(url.searchParams.get('user_id'), `eq.${userId}`);
    return profileOk ? json([profile]) : json({ message: 'profile failed' }, 500);
  }
  throw new Error(`unexpected fetch ${url}`);
}) as typeof fetch;
const davFetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
  const request = input instanceof Request ? input : new Request(String(input), init);
  const headers = new Headers(request.headers);
  assert.equal(headers.get('authorization'), `Basic ${btoa('dav-user:dav-pass')}`);
  const url = new URL(request.url);
  assert.equal(url.origin, 'https://webdav.example');
  const body = request.method === 'PUT' ? new Uint8Array(await request.arrayBuffer()) : undefined;
  davCalls.push({ method: request.method, url: url.pathname, body, headers });
  if (davFail !== null) return new Response('dav failed', { status: davFail });
  if (request.method === 'PUT' && davPutRecovery) {
    // 模拟目录被外部删除：第一次 PUT 报 409，重建目录后第二次成功。
    davPutRecovery = false;
    return new Response('missing parent', { status: 409 });
  }
  const status = request.method === 'MKCOL' && davMkcolStatus !== null ? davMkcolStatus : 201;
  return new Response(null, { status });
}) as typeof fetch;
const archiveFetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.hostname === 'webdav.example') return await davFetch(input, init);
  return await authFetch(input, init);
}) as typeof fetch;

async function call(request: Request): Promise<Response> {
  const savedGet = Deno.env.get;
  Deno.env.get = ((key: string) => ({
    SUPABASE_URL: project,
    SUPABASE_ANON_KEY: anon,
    CLUB_SERVICE_ROLE_KEY: 'mock-service',
    WEBDAV_BASE_URL: 'https://webdav.example/root',
    WEBDAV_USERNAME: 'dav-user',
    WEBDAV_PASSWORD: 'dav-pass'
  }[key])) as typeof Deno.env.get;
  globalThis.fetch = archiveFetch;
  try { return await handler(request); }
  finally { globalThis.fetch = originalFetch; Deno.env.get = savedGet; }
}
function snapshot(user = userId, overrides: Row = {}): Uint8Array<ArrayBuffer> {
  return encoder.encode(JSON.stringify({
    schema: 'club-ai-chat-archive/1',
    user_id: user,
    source: 'chat',
    trigger: 'reply',
    uploaded_at: '2026-10-20T04:05:06.789Z',
    conversations: [{id: 'c1', store: 'chat', title: 'T', turns: [{id: 't1', prompt: '你好', text: '答复', status: 'success'}]}],
    ...overrides
  }));
}
function archiveRequest(body: Uint8Array<ArrayBuffer>, headers: Row = {}, token: string | null = member): Request {
  return new Request(`${project}/functions/v1/club-drive`, {
    method: 'POST',
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      'x-drive-action': 'chat-archive',
      'x-chat-archive-source': 'chat',
      'x-chat-archive-trigger': 'reply',
      ...headers
    },
    body
  });
}
const parse = async (response: Response) => ({ status: response.status, body: await response.json().catch(() => ({})) });

// --- Archive transcript -------------------------------------------------
{
  davCalls = []; davFail = null;
  const response = await call(archiveRequest(snapshot()));
  const result = await parse(response);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const directory = `/root/Chatdata/${userId}_xiaoming_${encodeURIComponent('张三')}/`;
  const mkcol = davCalls.filter(call => call.method === 'MKCOL').map(call => call.url);
  assert.deepEqual(mkcol, ['/root/Chatdata/', directory, `${directory}${new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)}/`]);
  const put = davCalls.find(call => call.method === 'PUT')!;
  assert.match(put.url, new RegExp(`^${directory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\d{4}-\\d{2}-\\d{2}/\\d{6}_\\d{3}_chat_[0-9a-f]{4}\\.json$`));
  const saved = JSON.parse(new TextDecoder().decode(put.body));
  assert.equal(saved.schema, 'club-ai-chat-archive/1');
  assert.equal(saved.user_id, userId);
  assert.equal(saved.account.username, 'xiaoming');
  assert.equal(saved.account.member_name, '张三');
  assert.equal(saved.server.timezone, 'Asia/Shanghai');
  assert.equal(saved.server.trigger, 'reply');
  assert.match(saved.server.generated_at_beijing, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+08:00$/);
  assert.match(put.url, new RegExp(saved.server.generated_at_beijing.slice(0, 10)));
  assert.equal(put.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(put.headers.get('content-length'), String(put.body!.byteLength));
  assert.deepEqual(JSON.parse(new TextDecoder().decode(put.body)).conversations[0].turns[0].prompt, '你好');
}

// --- Identity fallbacks -------------------------------------------------
{
  davCalls = []; profileOk = false;
  const response = await call(archiveRequest(snapshot()));
  assert.equal(response.status, 200);
  const put = davCalls.find(call => call.method === 'PUT')!;
  assert.match(put.url, new RegExp(`^/root/Chatdata/${userId}_${userId}/`), 'profile failure falls back to the auth username (here the mock email prefix)');
  profileOk = true;

  davCalls = []; profile = { username: '', member_name: '' };
  assert.equal((await call(archiveRequest(snapshot()))).status, 200);
  assert.match(davCalls.find(call => call.method === 'PUT')!.url, new RegExp(`^/root/Chatdata/${userId}_${userId}/`), 'unbound profile omits the member-name segment');
  profile = { username: 'xiaoming', member_name: '张三' };
}

// --- Request validation -------------------------------------------------
{
  davCalls = [];
  assert.equal((await parse(await call(archiveRequest(snapshot(), {}, null)))).status, 401);
  assert.equal(davCalls.length, 0, 'unauthenticated archive never touches WebDAV');

  assert.equal((await parse(await call(archiveRequest(snapshot(userId.replace(/.$/, 'd')))))).status, 403);
  assert.equal((await parse(await call(archiveRequest(snapshot(userId, { schema: 'other/1' }))))).status, 400);
  assert.equal((await parse(await call(archiveRequest(snapshot(userId, { source: 'other' }), { 'x-chat-archive-source': 'other' })))).status, 400);
  assert.equal((await parse(await call(archiveRequest(snapshot(userId, { trigger: 'other' }), { 'x-chat-archive-trigger': 'other' })))).status, 400);
  assert.equal((await parse(await call(archiveRequest(encoder.encode('not json'))))).status, 400);
  assert.equal((await parse(await call(archiveRequest(encoder.encode('[]'))))).status, 400);
  assert.equal((await parse(await call(archiveRequest(snapshot(userId, { part: { index: 3, total: 2 } }))))).status, 400);
  assert.equal(davCalls.length, 0, 'invalid archives never create directories or files');

  const oversized = new Request(`${project}/functions/v1/club-drive`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${member}`,
      'x-drive-action': 'chat-archive',
      'x-chat-archive-source': 'chat',
      'x-chat-archive-trigger': 'reply',
      'content-length': String(25 * 1024 * 1024)
    },
    body: snapshot()
  });
  assert.equal((await parse(await call(oversized))).status, 413);
  assert.equal(davCalls.length, 0);
}

// --- Parts --------------------------------------------------------------
{
  davCalls = [];
  assert.equal((await call(archiveRequest(snapshot(userId, { part: { index: 2, total: 3 } })))).status, 200);
  assert.match(davCalls.find(call => call.method === 'PUT')!.url, /_chat_p2of3_[0-9a-f]{4}\.json$/);
  assert.equal((await call(archiveRequest(snapshot(userId, { source: 'assistant' }), { 'x-chat-archive-source': 'assistant' }))).status, 200);
  assert.match(davCalls.at(-1)!.url, /_assistant_[0-9a-f]{4}\.json$/);
}

// --- Attachment bytes ---------------------------------------------------
{
  const bytes = encoder.encode('hello attachment');
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  davCalls = [];
  const request = new Request(`${project}/functions/v1/club-drive`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${member}`,
      'x-drive-action': 'chat-attachment',
      'x-chat-attachment-hash': digest,
      'x-chat-attachment-ext': 'txt',
      'x-chat-attachment-type': 'text/plain'
    },
    body: bytes
  });
  const response = await call(request);
  const result = await parse(response);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.sha256, digest);
  const put = davCalls.find(call => call.method === 'PUT')!;
  assert.equal(put.url, `/root/Chatdata/${userId}_xiaoming_%E5%BC%A0%E4%B8%89/attachments/${digest.slice(0, 2)}/${digest}.txt`);
  assert.deepEqual(put.body, bytes);
  assert.equal(put.headers.get('content-type'), 'text/plain');
  // Root/user dirs may already be cached from earlier archive calls; the new attachment dirs must be created.
  assert.deepEqual(davCalls.filter(call => call.method === 'MKCOL').map(call => call.url).filter(url => url.includes('/attachments/')), [
    `/root/Chatdata/${userId}_xiaoming_%E5%BC%A0%E4%B8%89/attachments/`,
    `/root/Chatdata/${userId}_xiaoming_%E5%BC%A0%E4%B8%89/attachments/${digest.slice(0, 2)}/`
  ]);

  // Same bytes again is idempotent: the same hashed path is overwritten.
  davCalls = [];
  assert.equal((await call(new Request(`${project}/functions/v1/club-drive`, {
    method: 'POST',
    headers: { authorization: `Bearer ${member}`, 'x-drive-action': 'chat-attachment', 'x-chat-attachment-hash': digest, 'x-chat-attachment-ext': 'txt' },
    body: bytes
  }))).status, 200);
  assert.equal(davCalls.find(call => call.method === 'PUT')!.url, put.url);

  for (const [headers, payload, status] of [
    [{ 'x-chat-attachment-hash': 'f'.repeat(64) }, bytes, 400],
    [{}, new Uint8Array(), 400],
    [{ 'x-chat-attachment-ext': 'exe' }, bytes, 400],
    [{ 'x-chat-attachment-hash': 'not-a-hash' }, bytes, 400]
  ] as const) {
    davCalls = [];
    const response = await call(new Request(`${project}/functions/v1/club-drive`, {
      method: 'POST',
      headers: { authorization: `Bearer ${member}`, 'x-drive-action': 'chat-attachment', 'x-chat-attachment-ext': 'txt', ...headers },
      body: payload
    }));
    assert.equal((await parse(response)).status, status);
    assert.equal(davCalls.length, 0);
  }
}

// --- Directory and upload failures -------------------------------------
{
  davFail = 500;
  // Today's folders are cached from the successful calls above, so the failure lands on PUT.
  assert.equal((await parse(await call(archiveRequest(snapshot())))).status, 502);
  davFail = null;

  // 目录被外部删除时，PUT 的 404/409 触发强制重建并重试一次。
  davCalls = []; davPutRecovery = true;
  assert.equal((await parse(await call(archiveRequest(snapshot())))).status, 200);
  assert.equal(davCalls.filter(call => call.method === 'PUT').length, 2, 'missing parent triggers one forced directory rebuild and retry');
  assert(davCalls.filter(call => call.method === 'MKCOL').length >= 3, 'rebuild recreates root, user and date directories');

  davCalls = [];
  // A 405 from MKCOL means "already exists" and must not fail the archive.
  davMkcolStatus = 405;
  assert.equal((await parse(await call(archiveRequest(snapshot())))).status, 200);
  davMkcolStatus = null;
}

globalThis.fetch = originalFetch;
console.log('Chat archive API: controlled paths, Beijing date folders, second-level filenames, dual-store parts, attachment hashing and validation passed.');
