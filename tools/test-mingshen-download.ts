// Real handler, no transpilation/extraction or remote dependencies:
// deno test --no-config --no-lock --cached-only --no-prompt --deny-net \
//   --allow-read=supabase/functions/club-drive/index.ts,supabase/site-service-control.sql tools/test-mingshen-download.ts
// Auth / PostgREST are mocked in-process; Deno.serve is captured, never bound.
import { strict as assert } from 'node:assert';

type Row = Record<string, unknown>;
type Call = { path: string; method: string; body: Row };
const project = 'https://supabase.example.test';
const serviceKey = 'test-service-key';
const column = 'mingshen_harness_windows_download_url';
const getAction = 'mingshen_harness_download_get';
const setAction = 'admin_mingshen_harness_download_set';
const getRpc = 'club_mingshen_harness_download_get';
const setRpc = 'club_mingshen_harness_download_set';
const superId = '11111111-1111-4111-8111-111111111111';
const memberId = '22222222-2222-4222-8222-222222222222';
const staffId = '33333333-3333-4333-8333-333333333333';
const download = 'https://downloads.example.test/Mingshen%20Harness.exe?signature=a%2Fb&expires=123';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' }
});
const env: Record<string, string> = {
  SUPABASE_URL: project, SUPABASE_ANON_KEY: 'test-anon-key', CLUB_SERVICE_ROLE_KEY: serviceKey
};
const users: Record<string, Row> = {
  super: { id: superId, email: 'super@example.test' },
  member: { id: memberId, email: 'member@example.test', user_metadata: { isSuperAdmin: true } },
  staff: { id: staffId, email: 'staff@example.test', app_metadata: { role: 'admin' } }
};

assert.equal((await Deno.permissions.query({ name: 'net' })).state, 'denied', 'run with --deny-net');
const source = await Deno.readTextFile(new URL('../supabase/functions/club-drive/index.ts', import.meta.url));
const sql = await Deno.readTextFile(new URL('../supabase/site-service-control.sql', import.meta.url));
let handler!: (request: Request) => Promise<Response>;
const originalServe = Deno.serve;
try {
  Deno.serve = ((callback: typeof handler) => {
    handler = callback;
    return {} as Deno.HttpServer;
  }) as typeof Deno.serve;
  // Import the entire unchanged production TypeScript in the real Deno runtime.
  await import(`data:application/typescript,${encodeURIComponent(source)}`);
} finally {
  Deno.serve = originalServe;
}
assert.equal(typeof handler, 'function');

function defaultSettings(): Row {
  return {
    singleton: true, enabled: true, random_enabled: false, report_zh: '', report_en: '',
    feature_settings: {}, display_mode: 'overlay', title_zh: '网站暂不可用', subtitle_zh: '网站暂不可用',
    title_en: 'Website temporarily unavailable', subtitle_en: 'Website temporarily unavailable',
    [column]: '', updated_at: '2026-11-01T00:00:00Z', updated_by: null
  };
}
function existingSettings(): Row {
  return {
    ...defaultSettings(), enabled: false, random_enabled: true, report_zh: '维护报告', report_en: 'Maintenance',
    title_zh: '暂停服务', subtitle_zh: '请稍后', title_en: 'Paused', subtitle_en: 'Please wait',
    feature_settings: { chat: { enabled: false }, events: { enabled: true, note: 'keep' } },
    display_mode: 'page', [column]: download, updated_by: memberId
  };
}
function withoutDownloadAudit(row: Row): Row {
  const copy = structuredClone(row);
  delete copy[column]; delete copy.updated_at; delete copy.updated_by;
  return copy;
}

class Backend {
  row: Row | null = existingSettings();
  calls: Call[] = [];
  writes: Call[] = [];
  unexpected: string[] = [];
  readFailure = false;
  writeFailure = false;
  replyOverride: { value: unknown } | null = null;

  fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const body = request.method === 'POST' ? await request.json() as Row : {};
    const call = { path: url.pathname, method: request.method, body };
    this.calls.push(call);
    try {
      assert.equal(url.origin, project, 'never probe or fetch the configured download URL');
      if (url.pathname === '/auth/v1/user') {
        assert.equal(request.headers.get('apikey'), env.SUPABASE_ANON_KEY);
        const token = (request.headers.get('authorization') || '').replace(/^Bearer /, '');
        return users[token] ? json(users[token]) : json({ error: 'invalid token' }, 401);
      }
      assert.equal(request.headers.get('apikey'), serviceKey);
      assert.equal(request.headers.get('authorization'), `Bearer ${serviceKey}`);
      if (url.pathname === '/rest/v1/club_super_admins') {
        assert.equal(request.method, 'GET');
        const hit = url.searchParams.get('user_id') === `eq.${superId}` ||
          url.searchParams.get('email') === 'eq.super@example.test';
        return json(hit ? [{ user_id: superId, email: 'super@example.test' }] : []);
      }
      if (url.pathname === '/rest/v1/club_staff_permissions') {
        // Even an administrator with every delegated permission is not a super admin.
        return json([{ user_id: staffId, ...Object.fromEntries(
          ['checkin', 'points', 'messages', 'invites', 'events', 'mall', 'members', 'join'].map(key => [`can_${key}`, true])
        ) }]);
      }
      assert.equal(request.method, 'POST');
      assert.equal(request.headers.get('content-type'), 'application/json');
      if (url.pathname === `/rest/v1/rpc/${getRpc}`) {
        assert.deepEqual(body, {});
        if (this.readFailure) return json({ message: 'read rejected' }, 503);
        return json(this.replyOverride ? this.replyOverride.value : this.row?.[column] ?? '');
      }
      if (url.pathname === `/rest/v1/rpc/${setRpc}`) {
        this.writes.push(call);
        assert.deepEqual(Object.keys(body).sort(), ['p_download_url', 'p_updated_by']);
        assert.equal(body.p_updated_by, superId, 'audit identity must come from verified Auth user');
        assert.equal(typeof body.p_download_url, 'string');
        if (this.writeFailure) return json({ message: 'write rejected' }, 503);
        if (this.replyOverride) return json(this.replyOverride.value);
        // Mirror the SQL's atomic INSERT ON CONFLICT: defaults only when absent,
        // and only download/audit columns may change on an existing singleton.
        this.row = {
          ...(this.row ?? defaultSettings()), [column]: body.p_download_url,
          updated_by: body.p_updated_by, updated_at: '2026-11-13T01:02:03Z'
        };
        return json(body.p_download_url);
      }
      throw new Error(`unexpected route ${request.method} ${url}`);
    } catch (error) {
      // The production handler catches errors; keep a separate record so mock
      // assertion failures cannot masquerade as an expected HTTP 400.
      this.unexpected.push(String(error));
      throw error;
    }
  }) as typeof fetch;

  async call(payload: unknown, token: string | null = null, extraHeaders: Record<string, string> = {}) {
    const response = await handler(new Request(`${project}/functions/v1/club-drive`, {
      method: 'POST', headers: {
        'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...extraHeaders
      }, body: JSON.stringify(payload)
    }));
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    assert.deepEqual(this.unexpected, [], 'all fetches must match the mock contract');
    return { status: response.status, body: await response.json() as Row };
  }
}
async function withBackend(run: (backend: Backend) => Promise<void>) {
  const backend = new Backend();
  const originalFetch = globalThis.fetch, originalEnv = Deno.env.get;
  globalThis.fetch = backend.fetch;
  Deno.env.get = ((key: string) => env[key]) as typeof Deno.env.get;
  try {
    await run(backend);
    assert.deepEqual(backend.unexpected, []);
  } finally {
    globalThis.fetch = originalFetch;
    Deno.env.get = originalEnv;
  }
}

Deno.test('SQL contract: additive, idempotent column; isolated atomic upsert; service-role-only RPCs', () => {
  assert.match(sql, /add column if not exists mingshen_harness_windows_download_url text not null default '';/i);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /revoke all on table public\.club_site_service_settings from anon, authenticated;/i);
  assert.match(sql, /values \(true, true\) on conflict \(singleton\) do nothing;/i);
  for (const signature of [`${getRpc}()`, `${setRpc}(text,uuid)`]) {
    assert.ok(sql.includes(`revoke execute on function public.${signature} from public, anon, authenticated;`));
    assert.ok(sql.includes(`grant execute on function public.${signature} to service_role;`));
  }
  const getter = sql.split(`function public.${getRpc}()`)[1].split('$$;')[0];
  assert.ok(getter.includes("where singleton), '')"), 'missing row returns empty without writing');
  assert.doesNotMatch(getter, /insert|update|select \*/i);
  const setter = sql.split(`function public.${setRpc}(`)[1].split('end $$;')[0];
  assert.match(setter, /\(singleton, mingshen_harness_windows_download_url, updated_at, updated_by\)/);
  const conflict = setter.split('on conflict (singleton) do update set')[1].split(';')[0];
  assert.deepEqual([...conflict.matchAll(/\b(\w+)\s*=/g)].map(match => match[1]), [column, 'updated_at', 'updated_by']);
  assert.doesNotMatch(sql.split('function public.club_site_service_set(')[1].split('end $$;')[0], /mingshen_harness/);
});

Deno.test('anonymous public read exposes only downloadUrl, without Auth, service gate, writes or URL probes', async () => {
  await withBackend(async db => {
    const before = structuredClone(db.row);
    assert.deepEqual(await db.call({ action: getAction }), { status: 200, body: { downloadUrl: download } });
    assert.deepEqual(db.calls.map(call => call.path), [`/rest/v1/rpc/${getRpc}`]);
    for (const token of ['member', 'staff', 'invalid-token']) {
      assert.deepEqual(await db.call({ action: getAction }, token), {
        status: 200, body: { downloadUrl: download }
      }, `public read also works with ${token}`);
    }
    assert.deepEqual(db.writes, []);
    assert.deepEqual(db.row, before);
    db.row![column] = '';
    assert.deepEqual(await db.call({ action: getAction }), { status: 200, body: { downloadUrl: '' } });
  });
});

Deno.test('anonymous, invalid-token, member and delegated admin writes are all forbidden and never reach settings', async () => {
  await withBackend(async db => {
    const before = structuredClone(db.row);
    for (const token of [null, 'invalid-token', 'member', 'staff']) {
      const denied = await db.call({ action: setAction, downloadUrl: download }, token, { 'x-user-id': superId });
      assert.equal(denied.status, 403, String(token));
      assert.equal(typeof denied.body.error, 'string');
    }
    assert.equal(db.writes.length, 0);
    assert.ok(db.calls.every(call => call.path === '/auth/v1/user' || call.path === '/rest/v1/club_super_admins'));
    assert.deepEqual(db.row, before);
  });
});

Deno.test('super admin saves, trims and clears with verified audit identity; every other setting is preserved', async () => {
  await withBackend(async db => {
    const before = withoutDownloadAudit(db.row!);
    const saved = await db.call({ action: setAction, downloadUrl: `  ${download}  ` }, 'super');
    assert.deepEqual(saved, { status: 200, body: { downloadUrl: download } });
    assert.equal(db.row!.updated_by, superId);
    assert.equal(db.row!.updated_at, '2026-11-13T01:02:03Z');
    assert.deepEqual(withoutDownloadAudit(db.row!), before);
    assert.deepEqual(await db.call({ action: getAction }), saved);
    for (const value of ['', '   ', '\u3000\u00a0']) {
      assert.deepEqual(await db.call({ action: setAction, downloadUrl: value }, 'super'), {
        status: 200, body: { downloadUrl: '' }
      });
      assert.equal(db.row![column], '');
      assert.deepEqual(withoutDownloadAudit(db.row!), before);
    }
    assert.equal(db.writes.length, 4);
    assert.ok(db.writes.every(call => call.path === `/rest/v1/rpc/${setRpc}`));
  });
});

Deno.test('strict field allowlist rejects aliases, client audit identity and site settings with zero writes', async () => {
  await withBackend(async db => {
    for (const extra of [
      { user: users.super }, { userId: superId }, { updated_by: superId }, { updatedBy: superId },
      { updated_at: '2026-01-01' }, { enabled: true }, { featureSettings: {} },
      { download_url: download }, { payload: { downloadUrl: download } }, { unexpected: null },
      JSON.parse('{"__proto__":{"isSuperAdmin":true}}') as Row
    ]) {
      assert.equal((await db.call({ action: setAction, downloadUrl: download, ...extra }, 'super')).status, 400);
      assert.equal((await db.call({ action: getAction, ...extra })).status, 400);
    }
    assert.equal((await db.call({ action: getAction, downloadUrl: download })).status, 400);
    assert.equal((await db.call({ action: setAction }, 'super')).status, 400);
    assert.equal(db.writes.length, 0);
    assert.ok(db.calls.every(call => call.path === '/auth/v1/user' || call.path === '/rest/v1/club_super_admins'));
  });
});

Deno.test('invalid URL/type/length/control/backslash inputs are rejected before any database write', async () => {
  await withBackend(async db => {
    const before = structuredClone(db.row);
    const invalid: unknown[] = [
      null, false, 123, {}, [], [download], '/latest.exe', '//example.test/latest.exe',
      'http://example.test/latest.exe', 'ftp://example.test/latest.exe', 'javascript:alert(1)',
      'data:application/octet-stream;base64,AA==', 'https://', 'https://?x=1',
      'https:example.test/latest.exe', 'https:/example.test/latest.exe',
      'https:///example.test/latest.exe', 'https:////example.test/latest.exe',
      'https://user@example.test/latest.exe', 'https://user:secret@example.test/latest.exe',
      'https://:secret@example.test/latest.exe', 'https://@example.test/latest.exe',
      'https://%75ser@example.test/latest.exe', 'https://example.test:99999/latest.exe',
      'https://[invalid]/latest.exe', 'https://exa mple.test/latest.exe',
      'https://example.test/latest file.exe', 'https://example.test/file?name=latest file',
      'https://example.test/file#latest file', 'https://example.test/latest\u3000file.exe',
      'https://example.test\\latest.exe', 'https:\\example.test/latest.exe',
      `https://example.test/${'x'.repeat(2048)}`, `${' '.repeat(2049)}`
    ];
    // Include all C0, DEL and C1 controls, both embedded and at trim boundaries.
    for (const code of [...Array.from({ length: 32 }, (_, i) => i), ...Array.from({ length: 33 }, (_, i) => i + 127)]) {
      const control = String.fromCharCode(code);
      invalid.push(`https://example.test/${control}latest.exe`, `${control}${download}${control}`);
    }
    for (const value of invalid) {
      const result = await db.call({ action: setAction, downloadUrl: value }, 'super');
      assert.equal(result.status, 400, JSON.stringify(value));
      assert.equal(typeof result.body.error, 'string');
    }
    assert.equal(db.writes.length, 0);
    assert.deepEqual(db.row, before);
  });
});

Deno.test('valid HTTPS URLs, signed query, case, ports, IP hosts and exact 2048-character boundary are accepted without probing', async () => {
  await withBackend(async db => {
    const prefix = 'https://example.test/';
    const valid = [
      download, 'HTTPS://Downloads.Example.test/Latest.exe', 'https://example.test:8443/file.exe',
      'https://127.0.0.1/private.exe', 'https://[::1]/file.exe', 'https://localhost/latest.exe',
      `${prefix}${'x'.repeat(2048 - prefix.length)}`
    ];
    for (const value of valid) {
      assert.deepEqual(await db.call({ action: setAction, downloadUrl: value }, 'super'), {
        status: 200, body: { downloadUrl: value }
      });
      assert.equal(db.row![column], value);
    }
    assert.equal(db.writes.length, valid.length);
    assert.equal((await db.call({ action: setAction, downloadUrl: `${valid.at(-1)}x` }, 'super')).status, 400);
    assert.equal(db.writes.length, valid.length, '2049 characters is rejected, never truncated');
  });
});

Deno.test('missing singleton reads empty without writing; super-admin save atomically seeds it with defaults', async () => {
  await withBackend(async db => {
    db.row = null;
    assert.deepEqual(await db.call({ action: getAction }), { status: 200, body: { downloadUrl: '' } });
    assert.equal(db.row, null);
    assert.equal(db.writes.length, 0);
    assert.deepEqual(await db.call({ action: setAction, downloadUrl: download }, 'super'), {
      status: 200, body: { downloadUrl: download }
    });
    assert.equal(db.writes.length, 1, 'one atomic RPC, not a read/overwrite or zero-row PATCH');
    assert.equal(db.row![column], download);
    assert.equal(db.row!.updated_by, superId);
    assert.deepEqual(withoutDownloadAudit(db.row!), withoutDownloadAudit(defaultSettings()));
    assert.deepEqual(await db.call({ action: getAction }), { status: 200, body: { downloadUrl: download } });
  });
});

Deno.test('missing singleton can also be cleared safely and repeated saves remain single-row and preserve settings', async () => {
  await withBackend(async db => {
    db.row = null;
    for (let i = 0; i < 2; i++) {
      assert.deepEqual(await db.call({ action: setAction, downloadUrl: '   ' }, 'super'), {
        status: 200, body: { downloadUrl: '' }
      });
      assert.deepEqual(withoutDownloadAudit(db.row!), withoutDownloadAudit(defaultSettings()));
    }
    db.row!.enabled = false;
    db.row!.feature_settings = { chat: { enabled: false } };
    const before = withoutDownloadAudit(db.row!);
    for (let i = 0; i < 2; i++) {
      assert.equal((await db.call({ action: setAction, downloadUrl: download }, 'super')).status, 200);
      assert.deepEqual(withoutDownloadAudit(db.row!), before);
    }
    assert.equal(db.writes.length, 4);
  });
});

Deno.test('PostgREST errors and malformed/empty RPC results never report successful reads or saves', async () => {
  await withBackend(async db => {
    const before = structuredClone(db.row);
    db.readFailure = true;
    assert.equal((await db.call({ action: getAction })).status, 400);
    db.readFailure = false;
    db.writeFailure = true;
    assert.equal((await db.call({ action: setAction, downloadUrl: download }, 'super')).status, 400);
    db.writeFailure = false;
    for (const value of [null, [], {}, true, { [column]: download }, [''], { downloadUrl: download }]) {
      db.replyOverride = { value };
      assert.equal((await db.call({ action: getAction })).status, 400);
      assert.equal((await db.call({ action: setAction, downloadUrl: download }, 'super')).status, 400);
    }
    db.replyOverride = { value: 'https://different.example.test/latest.exe' };
    assert.equal((await db.call({ action: setAction, downloadUrl: download }, 'super')).status, 400);
    assert.deepEqual(db.row, before);
  });
});
