// Offline: npm exec --yes deno -- run --allow-read tools/test-image-archive.ts
import { strict as assert } from 'node:assert';
const source = await Deno.readTextFile(new URL('../supabase/functions/club-drive/index.ts', import.meta.url));
const project = 'https://example.supabase.co', userId = '12345678-1234-1234-1234-123456789abc';
const env: Record<string, string> = { SUPABASE_URL: project, SUPABASE_ANON_KEY: 'anon', CLUB_SERVICE_ROLE_KEY: 'service', WEBDAV_BASE_URL: 'https://dav.example/root', WEBDAV_USERNAME: 'user', WEBDAV_PASSWORD: 'pass' };
let handler!: (request: Request) => Promise<Response>;
const serve = Deno.serve, get = Deno.env.get, originalFetch = globalThis.fetch;
try {
  Deno.serve = ((callback: typeof handler) => { handler = callback; return {} as Deno.HttpServer; }) as typeof Deno.serve;
  Deno.env.get = ((key: string) => env[key]) as typeof Deno.env.get;
  await import(`data:application/typescript,${encodeURIComponent(source)}`);
} finally { Deno.serve = serve; Deno.env.get = get; }
const files = new Map<string, Uint8Array>();
let calls: Array<{ method: string; path: string }> = [], blocked = false, headOverride: number | null = null, putFail = false;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const fetchMock = (async (input: string | URL | Request, init: RequestInit = {}) => {
  const request = input instanceof Request ? input : new Request(String(input), init), url = new URL(request.url);
  if (url.pathname === '/auth/v1/user') return request.headers.get('authorization') === 'Bearer member' ? json({ id: userId }) : json({}, 401);
  if (url.pathname === '/rest/v1/club_member_profiles') return json([{ username: 'alice', member_name: '张三' }]);
  if (url.pathname === '/rest/v1/rpc/get_club_drive_quota') return json({ max_bytes: blocked ? -1 : 0 });
  assert.equal(url.hostname, 'dav.example');
  assert.equal(request.headers.get('authorization'), `Basic ${btoa('user:pass')}`);
  calls.push({ method: request.method, path: url.pathname });
  if (request.method === 'MKCOL') return new Response(null, { status: 201 });
  if (request.method === 'PROPFIND') return new Response('', { status: 207 });
  if (request.method === 'HEAD') {
    if (headOverride !== null) return new Response(null, { status: headOverride });
    const data = files.get(url.pathname);
    return data ? new Response(null, { status: 200, headers: { 'content-length': String(data.length) } }) : new Response(null, { status: 404 });
  }
  if (request.method === 'PUT') {
    if (putFail) return new Response(null, { status: 500 });
    if (request.headers.get('if-none-match') === '*' && files.has(url.pathname)) return new Response(null, { status: 412 });
    files.set(url.pathname, new Uint8Array(await request.arrayBuffer()));
    return new Response(null, { status: 201 });
  }
  throw new Error(`unexpected request ${request.method} ${url}`);
}) as typeof fetch;
async function call(action: string, body: BodyInit, headers: Record<string, string> = {}, auth = true) {
  Deno.env.get = ((key: string) => env[key]) as typeof Deno.env.get;
  globalThis.fetch = fetchMock;
  try {
    const response = await handler(new Request(`${project}/functions/v1/club-drive`, { method: 'POST', headers: { ...(auth ? { authorization: 'Bearer member' } : {}), 'x-drive-action': action, ...headers }, body }));
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    return { status: response.status, body: await response.json() };
  } finally { Deno.env.get = get; globalThis.fetch = originalFetch; }
}
const enc = new TextEncoder();
const digest = async (data: Uint8Array<ArrayBuffer>) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(x => x.toString(16).padStart(2, '0')).join('');
const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aXcAAAAASUVORK5CYII='), c => c.charCodeAt(0));
const pngHash = await digest(png);
const attach = async (data: Uint8Array<ArrayBuffer>, hash: string, mime = 'image/png', ext = 'png', extra: Record<string, string> = {}) => call('image-attachment', data, { 'x-chat-attachment-hash': hash, 'x-chat-attachment-type': mime, 'x-chat-attachment-ext': ext, ...extra });
const record = { id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', prompt: 'draw a flower', model_id: 'model', model_name: 'Model', options: { size: '1024x1024', quality: 'high', background: 'auto' }, createdAt: Date.now(), references: [] as unknown[], images: [] as unknown[], status: 'partial' };
const snapshot = (r: unknown = record, uid = userId, extra: Record<string, unknown> = {}) => enc.encode(JSON.stringify({ schema: 'club-ai-image-archive/1', user_id: uid, record: r, ...extra }));
const archive = (r: unknown = record, uid = userId, extra: Record<string, unknown> = {}) => call('image-archive', snapshot(r, uid, extra));
const path = `/root/Chatdata/${userId}_alice_%E5%BC%A0%E4%B8%89/images/attachments/${pngHash.slice(0, 2)}/${pngHash}.png`;

assert.equal((await call('image-archive', snapshot(), {}, false)).status, 401);
assert.equal((await archive(record, 'another-user')).status, 403);
assert.equal(calls.length, 0);
const requestOnly = await archive();
assert.equal(requestOnly.status, 200);
assert.deepEqual(requestOnly.body, { ok: true }, 'request-only snapshots retain prompt');
assert.deepEqual((await archive()).body, { ok: true });
let snapshots = [...files].filter(([key]) => key.endsWith('.json'));
assert.equal(snapshots.length, 2, 'snapshots never overwrite');
assert.match(snapshots[0][0], /\/images\/\d{4}-\d\d-\d\d\/\d{6}_\d{3}_[0-9a-f-]{36}\.json$/);
const media = { slot: 0, sha256: pngHash, mime: 'image/png', bytes: png.length, width: 1, height: 1, archived: true };
assert.equal((await archive({ ...record, images: [media] })).status, 409, 'client claim is not proof');
const attached = await attach(png, pngHash);
assert.equal(attached.status, 200);
assert.deepEqual(attached.body, { ok: true }, 'attachment response contains no hash or byte fields');
assert.deepEqual(files.get(path), png);
const priorPuts = calls.filter(c => c.method === 'PUT' && c.path === path).length;
assert.deepEqual((await attach(png, pngHash)).body, { ok: true });
assert.equal(calls.filter(c => c.method === 'PUT' && c.path === path).length, priorPuts, 'dedup must not overwrite');
const full = { ...record, createdAt: '2026-11-23T00:00:00.000Z', finishedAt: Date.now(), count: 2, request_id: 'req-1', secret: 'must not persist', options: { ...record.options, secret: 'must not persist' }, references: [{ sha256: pngHash, mime: 'image/png', bytes: png.length, name: 'input.png', archived: false, secret: 'must not persist' }], images: [media] };
const complete = await archive({ ...full, status: 'completed' }, userId, { secret: 'must not persist' });
assert.equal(complete.status, 200);
assert.deepEqual(complete.body, { ok: true }, 'complete snapshot response contains no extra fields');
snapshots = [...files].filter(([key]) => key.endsWith('.json'));
const saved = new TextDecoder().decode(snapshots.at(-1)![1]);
assert(!saved.includes('must not persist'));
assert.deepEqual(JSON.parse(saved).record.images, [media]);
for (const [createdAt, finishedAt] of [[Date.now(), Date.now()], ['2026-11-23T00:00:00.000Z', '2026-11-23T00:01:00.000Z']] as const) {
  const result = await archive({ ...full, status: 'completed', createdAt, finishedAt });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true });
  const last = [...files].filter(([key]) => key.endsWith('.json')).at(-1)!;
  const stored = JSON.parse(new TextDecoder().decode(last[1]));
  assert.equal(stored.record.createdAt, createdAt);
  assert.equal(stored.record.finishedAt, finishedAt);
}
assert.equal((await archive({ ...full, images: [{ ...media, bytes: png.length + 1 }] })).status, 409);
assert.equal((await archive({ ...full, images: [{ ...media, sha256: 'f'.repeat(64), archived: false }] })).status, 409);
const snapshotCount = [...files.keys()].filter(key => key.endsWith('.json')).length;
for (const failure of [500, 200]) { // 200 without Content-Length is also unconfirmed.
  headOverride = failure;
  const unconfirmed = await archive({ ...full, status: 'completed' });
  assert.equal(unconfirmed.status, 409, 'HEAD failure is never success');
  assert.notDeepEqual(unconfirmed.body, { ok: true });
  assert.equal([...files.keys()].filter(key => key.endsWith('.json')).length, snapshotCount, 'unconfirmed completed archive must not be written');
}
const unconfirmedPng = new Uint8Array(png.length + 1); unconfirmedPng.set(png);
headOverride = 500;
const unconfirmedAttachment = await attach(unconfirmedPng, await digest(unconfirmedPng));
assert.equal(unconfirmedAttachment.status, 502, 'uploaded bytes require successful HEAD confirmation');
assert.notDeepEqual(unconfirmedAttachment.body, { ok: true });
headOverride = null;
for (const bad of [
  { ...record, id: '../escape' }, { ...record, prompt: 'x'.repeat(12001) }, { ...record, createdAt: 'invalid' },
  { ...record, images: [{ ...media, slot: -1 }] }, { ...record, images: [{ ...media, width: 4097 }] },
  { ...record, references: [{ ...media, name: 'x', mime: 'text/html' }] }
]) assert.equal((await archive(bad)).status, 400);
assert.equal((await attach(png, 'f'.repeat(64))).status, 400);
assert.equal((await attach(png, pngHash, 'image/jpeg', 'jpg')).status, 400);
assert.equal((await attach(png, pngHash, 'image/png', '../png')).status, 400);
const badPng = png.slice(); badPng[16] = 1;
assert.equal((await attach(badPng, await digest(badPng))).status, 400);
// Minimal SOF and WebP containers exercise actual dimension parsing rather than extension sniffing.
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, 0, 3, 0, 2, 1, 1, 0x11, 0, 0xff, 0xd9]);
assert.equal((await attach(jpeg, await digest(jpeg), 'image/jpeg', 'jpeg')).status, 200);
const badJpeg = jpeg.slice(); badJpeg[9] = 0x11; badJpeg[10] = 0;
assert.equal((await attach(badJpeg, await digest(badJpeg), 'image/jpeg', 'jpg')).status, 400);
const webp = Uint8Array.from([82, 73, 70, 70, 18, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 76, 5, 0, 0, 0, 0x2f, 0, 0, 0, 0, 0]);
assert.equal((await attach(webp, await digest(webp), 'image/webp', 'webp')).status, 200);
const badWebp = webp.slice(); badWebp[4] = 19;
assert.equal((await attach(badWebp, await digest(badWebp), 'image/webp', 'webp')).status, 400);
assert.equal((await attach(enc.encode('https://example.com/image.png'), 'f'.repeat(64))).status, 400);
assert.equal((await attach(png, pngHash, 'image/png', 'png', { 'content-length': String(16 * 1024 * 1024 + 1) })).status, 413);
const big = new Uint8Array(6 * 1024 * 1024 + 1); big.set(png);
assert.equal((await attach(big, await digest(big))).status, 200, 'generated output exceeds legacy 6 MiB limit');
const tooBig = new Uint8Array(16 * 1024 * 1024 + 1); tooBig.set(png);
assert.equal((await attach(tooBig, '0'.repeat(64))).status, 413);
blocked = true;
assert.equal((await archive()).status, 413);
assert.equal((await attach(png, pngHash)).status, 413);
blocked = false;
putFail = true;
assert.equal((await archive()).status, 502);
putFail = false;
console.log('Image archive offline tests passed.');
