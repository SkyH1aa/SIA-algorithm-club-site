// Offline: npm exec --yes deno -- run --allow-read tools/test-club-donations.ts
// No network: Supabase auth, super-admin lookup and PostgREST are mocked in-process.
import { strict as assert } from 'node:assert';

type Row = Record<string, unknown>;
const project = 'https://jgezpvmlnhycxslqbwcx.supabase.co';
const anon = 'mock-anon';
const memberId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const donationId = '33333333-3333-4333-8333-333333333333';
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

const source = await Deno.readTextFile(new URL('../supabase/functions/club-drive/index.ts', import.meta.url));
let handler!: (request: Request) => Promise<Response>;
const originalServe = Deno.serve, originalGet = Deno.env.get;
try {
  Deno.serve = ((callback: (request: Request) => Promise<Response>) => { handler = callback; return {} as Deno.HttpServer; }) as typeof Deno.serve;
  Deno.env.get = ((key: string) => ({ SUPABASE_URL: project, SUPABASE_ANON_KEY: anon, CLUB_SERVICE_ROLE_KEY: 'mock-service' }[key])) as typeof Deno.env.get;
  await import(`data:application/typescript,${encodeURIComponent(source)}`);
} finally { Deno.serve = originalServe; Deno.env.get = originalGet; }
assert.equal(typeof handler, 'function');

const originalFetch = globalThis.fetch;
let tokenUser: Row | null = { id: memberId, email: 'member@club.local' };
let superAdmins: Row[] = [{ user_id: memberId, email: 'member@club.local' }];
let rows: Row[] = [];
let writes: Array<{ method: string; url: URL; body: unknown }> = [];
let failWrite = false;

const db = (async (input: string | URL | Request, init: RequestInit = {}) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.pathname === '/auth/v1/user') {
    return tokenUser ? json(tokenUser) : json({ error: 'unauthorized' }, 401);
  }
  if (url.pathname === '/rest/v1/club_super_admins') {
    const byId = url.searchParams.get('user_id');
    const byEmail = url.searchParams.get('email');
    const hit = superAdmins.find(row => (byId && row.user_id === byId.slice(3)) || (byEmail && String(row.email) === byEmail.slice(3)));
    return json(hit ? [hit] : []);
  }
  if (url.pathname === '/rest/v1/club_donations') {
    if (!init.method || init.method === 'GET') {
      assert.equal(url.searchParams.get('select'), 'id,donor_name,donated_on,amount,created_at,updated_at');
      assert.equal(url.searchParams.get('order'), 'amount.desc,donated_on.desc,created_at.desc', 'default order must be amount descending');
    }
    if (init.method === 'POST') {
      if (failWrite) return json({ message: 'insert rejected' }, 400);
      const body = JSON.parse(String(init.body)) as Row;
      writes.push({ method: 'POST', url, body });
      const saved = { id: donationId, ...body, created_at: '2026-10-20T00:00:00Z', updated_at: '2026-10-20T00:00:00Z' };
      rows.push(saved);
      return json([saved], 201);
    }
    if (init.method === 'PATCH') {
      if (failWrite) return json({ message: 'update rejected' }, 400);
      const id = url.searchParams.get('id')!.slice(3);
      const body = JSON.parse(String(init.body)) as Row;
      writes.push({ method: 'PATCH', url, body });
      const target = rows.find(row => row.id === id);
      if (!target) return json([], 200);
      Object.assign(target, body);
      return json([target], 200);
    }
    if (init.method === 'DELETE') {
      writes.push({ method: 'DELETE', url, body: null });
      const id = url.searchParams.get('id')!.slice(3);
      const found = rows.filter(row => row.id === id);
      rows = rows.filter(row => row.id !== id);
      return json(found, 200);
    }
    // Serve rows exactly as PostgREST would, ordered by amount desc then date desc.
    const sorted = [...rows].sort((a, b) => Number(b.amount) - Number(a.amount) || String(b.donated_on).localeCompare(String(a.donated_on)));
    return json(sorted);
  }
  throw new Error(`unexpected fetch ${url}`);
}) as typeof fetch;

async function call(payload: unknown, authenticated = true): Promise<{ status: number; body: Row }> {
  const savedGet = Deno.env.get;
  Deno.env.get = ((key: string) => ({ SUPABASE_URL: project, SUPABASE_ANON_KEY: anon, CLUB_SERVICE_ROLE_KEY: 'mock-service' }[key])) as typeof Deno.env.get;
  try {
    const response = await handler(new Request(`${project}/functions/v1/club-drive`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(authenticated ? { authorization: 'Bearer mock-token' } : {}) },
      body: JSON.stringify(payload)
    }));
    return { status: response.status, body: await response.json().catch(() => ({})) as Row };
  } finally {
    Deno.env.get = savedGet;
  }
}

globalThis.fetch = db;
try {
  // Unauthenticated visitors never see amounts.
  tokenUser = null;
  const anonCall = await call({ action: 'donations_list' }, false);
  assert.equal(anonCall.status, 401);
  tokenUser = { id: memberId, email: 'member@club.local' };

  // Signed-in non-super-admin member can read.
  superAdmins = [];
  const read = await call({ action: 'donations_list' });
  assert.equal(read.status, 200);
  assert.deepEqual(read.body.donations, []);

  // Every write action is super-admin only.
  for (const action of ['admin_donations_list', 'admin_donations_save', 'admin_donations_delete']) {
    const denied = await call({ action, donorName: 'A', donatedOn: '2026-10-20', amount: 10, id: donationId });
    assert.equal(denied.status, 403, action);
  }
  assert.equal(writes.length, 0, 'denied writes must not reach PostgREST');

  // A staff permission (e.g. can_members) does not grant donation write access.
  superAdmins = [];
  const staffOnly = await call({ action: 'admin_donations_save', donorName: 'A', donatedOn: '2026-10-20', amount: 10 });
  assert.equal(staffOnly.status, 403);

  superAdmins = [{ user_id: memberId, email: 'member@club.local' }];
  const listed = await call({ action: 'admin_donations_list' });
  assert.equal(listed.status, 200);

  // Validation: name, date and amount are all strict.
  for (const [change, label] of [
    [{ donorName: '' }, 'empty name'],
    [{ donorName: 'x'.repeat(61) }, 'long name'],
    [{ donatedOn: '2026-13-01' }, 'bad month'],
    [{ donatedOn: '2026-02-30' }, 'bad day'],
    [{ donatedOn: '2026/10/20' }, 'wrong shape'],
    [{ donatedOn: '1899-12-31' }, 'too old'],
    [{ amount: 0 }, 'zero amount'],
    [{ amount: -5 }, 'negative amount'],
    [{ amount: 'abc' }, 'non-numeric amount'],
    [{ amount: 1.234 }, 'three decimals'],
    [{ amount: 10000000000 }, 'over limit']
  ] as Array<[Row, string]>) {
    const bad = await call({ action: 'admin_donations_save', donorName: 'Valid Name', donatedOn: '2026-10-20', amount: 10, ...change });
    assert.equal(bad.status, 400, label);
  }
  assert.equal(writes.length, 0, 'invalid records never reach PostgREST');

  // Create: amount is normalised to two decimals and the creator is recorded.
  const created = await call({ action: 'admin_donations_save', donorName: 'Alice', donatedOn: '2026-09-01', amount: '1234.5' });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const createdRow = created.body.donation as Row;
  assert.equal(createdRow.donor_name, 'Alice');
  assert.equal(createdRow.donated_on, '2026-09-01');
  assert.equal(createdRow.amount, '1234.50');
  assert.equal((writes[0].body as Row).created_by, memberId);
  assert.equal((writes[0].body as Row).updated_by, memberId);
  assert.equal((writes[0].body as Row).updated_at instanceof String || typeof (writes[0].body as Row).updated_at === 'string', true);

  // Update keeps created_by out of the patch and still stamps updated_by.
  const updated = await call({ action: 'admin_donations_save', id: donationId, donorName: 'Alice Zhang', donatedOn: '2026-09-02', amount: 999.999999 + 0.000001 });
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  assert.equal((updated.body.donation as Row).amount, '1000.00');
  const patch = writes.at(-1)!;
  assert.equal(patch.method, 'PATCH');
  assert.equal(Object.hasOwn(patch.body as Row, 'created_by'), false, 'update must not overwrite created_by');
  assert.equal((patch.body as Row).updated_by, memberId);

  // Missing target is reported instead of silently succeeding.
  const missing = await call({ action: 'admin_donations_save', id: otherId, donorName: 'Ghost', donatedOn: '2026-09-02', amount: 5 });
  assert.equal(missing.status, 400);
  assert.match(String(missing.body.error), /未找到/);

  // Delete requires a UUID and reports a missing row.
  assert.equal((await call({ action: 'admin_donations_delete', id: 'not-a-uuid' })).status, 400);
  assert.equal((await call({ action: 'admin_donations_delete', id: otherId })).status, 400);
  const removed = await call({ action: 'admin_donations_delete', id: donationId });
  assert.equal(removed.status, 200);
  assert.equal(rows.length, 0);

  // Upstream rejection surfaces as an error, not a fake success.
  failWrite = true;
  const failed = await call({ action: 'admin_donations_save', donorName: 'Bob', donatedOn: '2026-10-20', amount: 20 });
  failWrite = false;
  assert.equal(failed.status, 400);
  assert.match(String(failed.body.error), /insert rejected/);

  // Server-side ordering: the list is returned largest amount first.
  rows = [
    { id: otherId, donor_name: 'Small', donated_on: '2026-10-01', amount: '10.00' },
    { id: donationId, donor_name: 'Large', donated_on: '2026-09-01', amount: '900.00' }
  ];
  const ordered = await call({ action: 'donations_list' });
  assert.deepEqual((ordered.body.donations as Row[]).map(row => row.donor_name), ['Large', 'Small']);
  // numeric columns may arrive as strings; the API always returns two decimals.
  assert.equal((ordered.body.donations as Row[])[0].amount, '900.00');
} finally {
  globalThis.fetch = originalFetch;
}

console.log('Club donations API: sign-in gate, super-admin-only writes, strict name/date/amount validation, ordering and error mapping passed.');
