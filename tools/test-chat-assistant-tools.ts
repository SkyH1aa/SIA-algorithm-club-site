// Offline: deno run --allow-read tools/test-chat-assistant-tools.ts
// No network, environment, subprocess, or write permission. All HTTP/auth is mocked.
import { strict as assert } from 'node:assert';
import { ASSISTANT_READ_TOOLS, executeAssistantReadTool, type AssistantQueryCard } from '../supabase/functions/_shared/chat-assistant-tools.ts';
import { type LiveReadOptions, LIVE_MAX_RESPONSE_BYTES } from '../supabase/functions/_shared/chat-assistant-live.ts';

type Row = Record<string, unknown>;
const project = 'https://jgezpvmlnhycxslqbwcx.supabase.co';
const anon = 'mock-anon', member = 'mock-member';
const common = { order_by: 'points', direction: 'desc', page: 1, page_size: 20 };
const boardArgs = { ...common, board: 'gomoku', order_by: 'total_score' };
const publishedArgs = { ...common, kind: 'announcements', order_by: 'default' };
const gate = { enabled: true, feature_settings: {} };
const uuid = '12345678-1234-1234-1234-123456789abc';
const instant = '2026-10-19T12:34:56.000Z';
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const options = (fetch: typeof globalThis.fetch): LiveReadOptions => ({ projectUrl: project, anonKey: anon, memberToken: member, fetch, now: () => new Date(instant) });
const card = async (name: string, args: unknown, fetcher: typeof fetch) => (await executeAssistantReadTool(name, args, options(fetcher))).results[0] as AssistantQueryCard;
const mock = (value: unknown): typeof fetch => (async (_input, init) => init?.body && JSON.parse(String(init.body)).action === 'site_service_status' ? json(gate) : json(value)) as typeof fetch;
const gomoku = (name = 'player', score: number | string = 3) => ({ nickname: name, total_score: score, wins: 1, losses: 0, draws: 0, total_moves: 5 });
function published(kind = 'announcements', content = 'public'): Row {
  return { id: uuid, title: 'Public title', content, category: '社团通知', is_published: true, is_featured: false,
    created_at: instant, updated_at: instant, starts_at: null, ends_at: null,
    ...(kind === 'events' ? { summary: '', status: '报名中', location: '', signup_deadline: null, allow_signup: true, signup_limit: null } : { is_pinned: false }) };
}
const pass = async (name: string, fn: () => void | Promise<void>) => { await fn(); console.log(`PASS ${name}`); };

await pass('schemas are strict and invalid unknown keys/enums/ranges never call HTTP', async () => {
  assert.deepEqual(ASSISTANT_READ_TOOLS.map(tool => tool.name), ['read_member_points', 'read_game_leaderboard', 'read_published_content']);
  for (const tool of ASSISTANT_READ_TOOLS) assert.equal(tool.parameters.additionalProperties, false);
  const invalid: Array<[string, unknown]> = [
    ['arbitrary', common], ['read_member_points', null], ['read_member_points', []],
    ...['select', 'url', 'table', 'sql', 'dataset', 'class', 'member_class', 'or', 'limit', '__proto__'].map(key => ['read_member_points', JSON.parse(JSON.stringify(common).slice(0, -1) + `,"${key}":"evil"}`)] as [string, unknown]),
    ['read_member_points', { ...common, page: 101 }], ['read_member_points', { ...common, page: 0 }], ['read_member_points', { ...common, page: 1.5 }],
    ['read_member_points', { ...common, page_size: 51 }], ['read_member_points', { ...common, direction: ['asc'] }], ['read_member_points', { ...common, order_by: 'points.desc;DELETE' }],
    ['read_member_points', { ...common, member_name: '' }], ['read_member_points', { ...common, min_points: -1 }], ['read_member_points', { ...common, max_points: 1000001 }],
    ['read_member_points', { ...common, min_points: 5, max_points: 4 }], ['read_member_points', { ...common, min_points: '1' }],
    ['read_game_leaderboard', { ...boardArgs, board: 'private_players' }], ['read_game_leaderboard', { ...boardArgs, order_by: 'password_hash' }],
    ['read_game_leaderboard', { ...boardArgs, order_by: 'username' }], ['read_game_leaderboard', { ...boardArgs, min_score: '-1' }],
    ...['01', '+1', '-0', '1e4', '1.5', '9223372036854775808', '1&select=*', 7].map(min_score => ['read_game_leaderboard', { ...boardArgs, min_score }] as [string, unknown]),
    ['read_game_leaderboard', { ...boardArgs, min_score: '10', max_score: '2' }],
    ['read_published_content', { ...publishedArgs, kind: 'drafts' }], ['read_published_content', { ...publishedArgs, status: '报名中' }],
    ['read_published_content', { ...publishedArgs, kind: 'events', status: 'private' }], ['read_published_content', { ...publishedArgs, category: 'invalid' }],
    ['read_published_content', { ...publishedArgs, after: instant }], ['read_published_content', { ...publishedArgs, date_field: 'content' }],
    ['read_published_content', { ...publishedArgs, date_field: 'created_at', after: '2026-02-30T00:00:00Z' }],
    ['read_published_content', { ...publishedArgs, date_field: 'created_at', after: '2026-01-01' }],
    ['read_published_content', { ...publishedArgs, date_field: 'created_at', after: '2026-01-01T24:00:00Z' }],
    ['read_published_content', { ...publishedArgs, date_field: 'created_at', after: instant, before: '2025-01-01T00:00:00Z' }],
    ['read_published_content', { ...publishedArgs, id: 'bad-id' }], ['read_published_content', { ...publishedArgs, is_published: false }]
  ];
  for (const [name, args] of invalid) await assert.rejects(executeAssistantReadTool(name, args, options((() => { throw new Error('must not fetch'); }) as typeof fetch)), (error: unknown) => Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'tool_arguments'), `${name} ${JSON.stringify(args)}`);
});

await pass('all six boards use fixed anonymous routes and database highest/lowest ordering with stable ties', async () => {
  const boards = ['gomoku', 'tetris', 'tetris_versus', 'snake', 'snake_versus', 'platformer'];
  for (const board of boards) for (const direction of ['asc', 'desc']) {
    const score = ['gomoku', 'platformer'].includes(board) ? 'total_score' : 'high_score';
    const nameKey = board === 'platformer' ? 'username' : 'nickname';
    for (const order_by of [score, nameKey]) {
      let reads = 0;
      const requestedName = 'a,b)%_"';
      const fetcher = (async (input, init) => {
        const url = new URL(String(input)), headers = new Headers(init?.headers);
        assert.equal(url.origin, project); assert.equal(init?.redirect, 'error');
        if (url.pathname === '/functions/v1/club-drive') { assert.equal(JSON.parse(String(init?.body)).action, 'site_service_status'); return json(gate); }
        assert.equal(headers.get('authorization'), `Bearer ${anon}`); assert.equal(headers.get('apikey'), anon);
        if (url.pathname.endsWith('/rpc/platformer_service_status')) { assert.equal(init?.method, 'POST'); assert.equal(init?.body, '{}'); return json([{ enabled: true }]); }
        reads++; assert.equal(init?.method || 'GET', 'GET');
        assert.equal(url.pathname, `/rest/v1/${board === 'platformer' ? 'platformer_leaderboard' : `${board}_players`}`);
        assert.equal(url.searchParams.get('limit'), '3'); assert.equal(url.searchParams.get('offset'), '4');
        assert.equal(url.searchParams.get('order'), `${order_by}.${direction}.nullslast${board === 'platformer' ? order_by === 'username' ? '' : ',username.asc' : `,updated_at.asc${order_by === 'nickname' ? '' : ',nickname.asc'}`}`);
        assert.equal(url.searchParams.get(nameKey), `eq.${requestedName}`);
        assert.deepEqual(url.searchParams.getAll(score), [`gte.${board.endsWith('_versus') ? '-9223372036854775808' : '0'}`, 'lte.9223372036854775807']);
        const matching = board === 'gomoku' ? gomoku(requestedName) : board === 'platformer' ? { username: requestedName, total_score: '9007199254740993' } : { nickname: requestedName, games_played: 2, high_score: board.endsWith('_versus') ? -7 : 7 };
        const nearMiss = { ...matching, [nameKey]: `${requestedName}x` };
        const rows: Row[] = [matching, matching, matching, nearMiss];
        const filter = url.searchParams.get(nameKey);
        const decodedName = filter?.startsWith('eq.') ? filter.slice(3) : undefined;
        const filtered = decodedName === undefined ? rows : rows.filter(row => row[nameKey] === decodedName);
        return json(filtered.map(row => ({ ...row, id: 'private', password_hash: 'private', session_token: 'private' })));
      }) as typeof fetch;
      const result = await card('read_game_leaderboard', { ...boardArgs, board, order_by, direction, page: 3, page_size: 2, name: requestedName, min_score: board.endsWith('_versus') ? '-9223372036854775808' : '0', max_score: '9223372036854775807' }, fetcher);
      assert.equal(reads, 1); assert.equal(result.status, 'success'); assert.equal(result.has_more, true); assert.equal(result.returned_count, 2);
      assert(!JSON.stringify(result).includes('private')); assert.equal(result.query.page, 3);
    }
  }
});

await pass('exact board names use decoded equality for Unicode, separators and near misses', async () => {
  const names = ['小明', 'a,b)%_"', '反\\斜杠 & 其他', 'eq.a+b?#'];
  for (const board of ['gomoku', 'tetris', 'tetris_versus', 'snake', 'snake_versus', 'platformer']) for (const name of names) {
    const nameKey = board === 'platformer' ? 'username' : 'nickname';
    const target = board === 'gomoku' ? gomoku(name) : board === 'platformer' ? { username: name, total_score: 3 } : { nickname: name, games_played: 2, high_score: 3 };
    const rows: Row[] = [target, { ...target, [nameKey]: `${name}x` }];
    const urls: URL[] = [];
    const fetcher = (async input => {
      const url = new URL(String(input));
      if (url.pathname === '/functions/v1/club-drive') return json(gate);
      if (url.pathname.endsWith('/rpc/platformer_service_status')) return json([{ enabled: true }]);
      assert.equal(url.pathname, `/rest/v1/${board === 'platformer' ? 'platformer_leaderboard' : `${board}_players`}`);
      urls.push(url);
      const filter = url.searchParams.get(nameKey);
      const filtered = filter === null ? rows : rows.filter(row => filter === `eq.${row[nameKey]}`);
      const offset = Number(url.searchParams.get('offset'));
      return json(filtered.slice(offset, offset + Number(url.searchParams.get('limit'))));
    }) as typeof fetch;
    const args = { ...boardArgs, board, order_by: ['gomoku', 'platformer'].includes(board) ? 'total_score' : 'high_score', page_size: 2 };
    const broad = await card('read_game_leaderboard', args, fetcher);
    assert.equal(broad.status, 'success'); assert.equal(urls.at(-1)!.searchParams.has(nameKey), false);
    assert.deepEqual(broad.data, rows);
    const exact = await card('read_game_leaderboard', { ...args, name }, fetcher);
    assert.equal(urls.at(-1)!.searchParams.get(nameKey), `eq.${name}`);
    assert.equal(exact.status, 'success', `${board}: ${name}`); assert.deepEqual(exact.data, [broad.data[0]]); assert.equal(exact.has_more, false);
    const missing = await card('read_game_leaderboard', { ...args, name: `${name}不存在` }, fetcher);
    assert.equal(missing.status, 'empty'); assert.deepEqual(missing.data, []);
  }
});

await pass('bigint precision, complete row schemas, empty vs malformed, and lookahead validation', async () => {
  const precise = await card('read_game_leaderboard', boardArgs, (async (_input, init) => init?.body ? json(gate) : new Response('[{"nickname":"p","total_score":9007199254740993,"wins":1,"losses":0,"draws":0,"total_moves":2}]')) as typeof fetch);
  assert.equal(precise.data[0].total_score, '9007199254740993');
  assert.equal((await card('read_game_leaderboard', boardArgs, mock([]))).status, 'empty');
  for (const raw of [{}, [{ nickname: 'p' }], [gomoku(), { ...gomoku(), wins: '1.5' }], [gomoku(), { ...gomoku(), total_score: -1 }], [gomoku(), { ...gomoku(), nickname: '' }]]) assert.equal((await card('read_game_leaderboard', { ...boardArgs, page_size: 1 }, mock(raw))).status, 'unavailable');
});

await pass('gates, fixed HTTPS host, JWT requirements, redirects and response caps fail closed', async () => {
  let reads = 0;
  for (const payload of [{ enabled: false, feature_settings: {} }, { enabled: true, feature_settings: { gomoku: { enabled: false } } }, { enabled: true, feature_settings: { gomoku: {} } }, { enabled: true }, []]) {
    const result = await card('read_game_leaderboard', boardArgs, (async () => { reads++; return json(payload); }) as typeof fetch);
    assert.equal(result.status, reads <= 2 ? 'paused' : 'unavailable'); assert.equal(result.has_more, null);
  }
  for (const projectUrl of ['http://jgezpvmlnhycxslqbwcx.supabase.co', 'https://evil.example', `${project}/rest/v1`, `${project}/?x=1`, 'https://user@jgezpvmlnhycxslqbwcx.supabase.co']) {
    assert.equal((await executeAssistantReadTool('read_game_leaderboard', boardArgs, { ...options((() => { throw new Error('must not fetch'); }) as typeof fetch), projectUrl })).status, 'unavailable');
  }
  assert.equal((await executeAssistantReadTool('read_member_points', common, { ...options((() => { throw new Error('must not fetch'); }) as typeof fetch), memberToken: '' })).status, 'unavailable');
  for (const response of [() => new Response('', { status: 302 }), () => new Response('bad json'), () => new Response('x'.repeat(LIVE_MAX_RESPONSE_BYTES + 1)), () => new Response('[]', { headers: { 'content-length': String(LIVE_MAX_RESPONSE_BYTES + 1) } })]) {
    const result = await card('read_game_leaderboard', boardArgs, (async (_input, init) => init?.body ? json(gate) : response()) as typeof fetch); assert.equal(result.status, 'unavailable');
  }
  let platformReads = 0;
  const paused = await card('read_game_leaderboard', { ...boardArgs, board: 'platformer' }, (async (_input, init) => { platformReads++; return json(init?.body === '{}' ? [{ enabled: false }] : gate); }) as typeof fetch);
  assert.equal(paused.status, 'paused'); assert.equal(platformReads, 2);
});

// Import the actual full-source handler with only Deno.serve/env.get intercepted.
// Dynamic TypeScript data imports avoid adding a runtime compiler dependency or writing files.
const source = await Deno.readTextFile(new URL('../supabase/functions/club-drive/index.ts', import.meta.url));
let handler!: (request: Request) => Promise<Response>;
const originalServe = Deno.serve, originalGet = Deno.env.get;
try {
  Deno.serve = ((callback: (request: Request) => Promise<Response>) => { handler = callback; return {} as Deno.HttpServer; }) as typeof Deno.serve;
  Deno.env.get = ((key: string) => ({ SUPABASE_URL: project, SUPABASE_ANON_KEY: anon, CLUB_SERVICE_ROLE_KEY: 'mock-server-only' }[key])) as typeof Deno.env.get;
  await import(`data:application/typescript,${encodeURIComponent(source)}`);
} finally { Deno.serve = originalServe; Deno.env.get = originalGet; }
assert.equal(typeof handler, 'function');
const originalFetch = globalThis.fetch;
let dbRead: (url: URL) => unknown = () => [];
let serviceGate: unknown = gate;
let dbCalls: URL[] = [];
let authCalls = 0;
const backendFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(input)); assert.equal(url.origin, project);
  if (url.pathname === '/auth/v1/user') { authCalls++; return json({ id: uuid, email: 'mock@club.local' }); }
  assert.equal(init?.redirect, 'error');
  const headers = new Headers(init?.headers); assert.equal(headers.get('apikey'), 'mock-server-only');
  if (url.pathname === '/rest/v1/rpc/club_site_service_status') { assert.equal(init?.method, 'POST'); assert.equal(init?.body, '{}'); return json([serviceGate]); }
  assert.equal(init?.method || 'GET', 'GET');
  assert(['/rest/v1/club_member_points', '/rest/v1/club_announcements', '/rest/v1/club_events'].includes(url.pathname));
  assert(!url.searchParams.get('select')?.includes('*')); dbCalls.push(url); return json(dbRead(url));
}) as typeof fetch;
async function endpoint(payload: unknown, authenticated = true): Promise<Response> {
  const savedGet = Deno.env.get; Deno.env.get = ((key: string) => ({ SUPABASE_URL: project, SUPABASE_ANON_KEY: anon, CLUB_SERVICE_ROLE_KEY: 'mock-server-only' }[key])) as typeof Deno.env.get;
  globalThis.fetch = backendFetch;
  try { return await handler(new Request(`${project}/functions/v1/club-drive`, { method: 'POST', headers: { 'content-type': 'application/json', ...(authenticated ? { authorization: `Bearer ${member}` } : {}) }, body: JSON.stringify(payload) })); }
  finally { globalThis.fetch = originalFetch; Deno.env.get = savedGet; }
}
const integratedFetch = (async (_input, init) => {
  const payload = JSON.parse(String(init?.body));
  if (payload.action === 'site_service_status') return json(gate);
  assert.equal(payload.action, 'assistant_read_query'); assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${member}`);
  return await endpoint(payload);
}) as typeof fetch;

await pass('real handler independently rejects malicious schemas and unauthenticated calls without DB reads', async () => {
  dbCalls = []; const beforeAuth = authCalls;
  assert.equal((await endpoint({ action: 'assistant_read_query', query: { ...common, dataset: 'member_points' } }, false)).status, 401);
  assert.equal(authCalls, beforeAuth);
  for (const query of [null, { ...common, dataset: 'gomoku' }, { ...common, dataset: 'member_points', select: '*' }, { ...common, dataset: 'member_points', order_by: 'member_class' }, { ...common, dataset: 'member_points', direction: ['asc'] }, { ...common, dataset: 'events', status: 'private' }, { ...common, dataset: 'announcements', is_published: false }]) {
    const response = await endpoint({ action: 'assistant_read_query', query }); assert.equal(response.status, 400); assert.equal((await response.json()).code, 'tool_arguments');
  }
  assert.equal((await endpoint({ action: 'assistant_read_query', query: { ...common, dataset: 'member_points' }, table: 'private' })).status, 400);
  assert.equal(dbCalls.length, 0);
});

await pass('real handler database pagination highest/lowest and exact-name ambiguity before page and score filters', async () => {
  for (const direction of ['asc', 'desc']) {
    dbCalls = []; dbRead = () => [{ member_name: 'A', points: 1, id: 'secret', member_class: 'secret' }, { member_name: 'B', points: 2 }, { member_name: 'C', points: 3 }];
    const result = await card('read_member_points', { ...common, direction, page: 4, page_size: 2, min_points: 0, max_points: 9 }, integratedFetch);
    assert.equal(result.status, 'success'); assert.equal(result.has_more, true); assert.deepEqual(result.data, [{ member_name: 'A', points: 1 }, { member_name: 'B', points: 2 }]);
    assert.equal(dbCalls.length, 1); const url = dbCalls[0];
    assert.equal(url.searchParams.get('order'), `points.${direction}.nullslast,member_name.asc,id.asc`);
    assert.equal(url.searchParams.get('offset'), '6'); assert.equal(url.searchParams.get('limit'), '3'); assert.deepEqual(url.searchParams.getAll('points'), ['gte.0', 'lte.9']);
    assert.equal(url.searchParams.get('select'), 'member_name,points');
  }
  dbCalls = []; dbRead = url => {
    assert.equal(url.searchParams.get('member_name'), 'eq.Same');
    return [{ member_name: 'Same', points: 1 }, { member_name: 'Same', points: 999 }].filter(row => row.member_name === url.searchParams.get('member_name')?.slice(3));
  };
  const ambiguous = await card('read_member_points', { ...common, page: 90, page_size: 1, member_name: 'Same', min_points: 500 }, integratedFetch);
  assert.equal(ambiguous.status, 'ambiguous'); assert.deepEqual(ambiguous.data, []); assert.equal(ambiguous.has_more, null);
  assert.equal(dbCalls.length, 1); assert.equal(dbCalls[0].searchParams.get('member_name'), 'eq.Same'); assert.equal(dbCalls[0].searchParams.get('offset'), '0'); assert.equal(dbCalls[0].searchParams.get('limit'), '2'); assert.equal(dbCalls[0].searchParams.has('points'), false);
  dbCalls = []; dbRead = url => url.searchParams.get('limit') === '2' ? [{ member_name: 'Unique', points: 7 }] : [];
  const unique = await card('read_member_points', { ...common, page: 2, member_name: 'Unique' }, integratedFetch);
  assert.equal(unique.status, 'empty'); assert.equal(unique.has_more, false); assert.equal(dbCalls.length, 2); assert(dbCalls.every(url => url.searchParams.get('member_name') === 'eq.Unique'));
  dbRead = () => [{ member_name: 'Same', points: 1 }, { member_name: 'Same', points: 2 }];
  const listing = await card('read_member_points', common, integratedFetch); assert.equal(listing.data.length, 2); // No collapse of unfiltered same names.
});

await pass('published IDs always retain publication filters, literal substring escaping and date filters at DB', async () => {
  for (const kind of ['announcements', 'events']) for (const order_by of ['default', 'created_at', 'updated_at', 'starts_at', 'ends_at']) {
    dbCalls = []; dbRead = () => [{ ...published(kind), created_by: 'private', updated_by: 'private', signup_contact: 'private' }];
    const result = await card('read_published_content', { ...publishedArgs, kind, order_by, id: uuid, title_contains: '100%_*.(x),"\\|', category: '社团通知', ...(kind === 'events' ? { status: '报名中' } : {}), date_field: 'starts_at', after: '2026-01-01T00:00:00Z', before: '2027-01-01T00:00:00Z' }, integratedFetch);
    assert.equal(result.status, 'success'); assert.equal(result.has_more, false); assert(!JSON.stringify(result).includes('private'));
    const url = dbCalls[0]; assert.equal(url.searchParams.get('is_published'), 'eq.true'); assert.equal(url.searchParams.get('id'), `eq.${uuid}`);
    assert.equal(url.searchParams.get('category'), 'eq.社团通知'); assert.equal(url.searchParams.get('status'), kind === 'events' ? 'eq.报名中' : null);
    assert.equal(url.searchParams.get('title'), 'match."100%_\\\\*\\\\.\\\\(x\\\\),\\"\\\\\\\\\\\\|"');
    assert.deepEqual(url.searchParams.getAll('starts_at'), ['gte.2026-01-01T00:00:00Z', 'lte.2027-01-01T00:00:00Z']);
    assert.equal(url.searchParams.get('limit'), '21'); assert.equal(url.searchParams.get('offset'), '0');
    assert(url.searchParams.get('order')?.endsWith('id.asc'));
  }
  dbRead = () => [{ ...published(), is_published: false }]; assert.equal((await card('read_published_content', publishedArgs, integratedFetch)).status, 'unavailable');
  dbRead = () => [published(), { title: 'malformed' }]; assert.equal((await card('read_published_content', { ...publishedArgs, page_size: 1 }, integratedFetch)).status, 'unavailable');
  serviceGate = { enabled: false, feature_settings: {} }; dbCalls = []; dbRead = () => { throw new Error('paused'); };
  assert.equal((await endpoint({ action: 'assistant_read_query', query: { ...common, dataset: 'member_points' } })).status, 503); assert.equal(dbCalls.length, 0); serviceGate = gate;
});

await pass('announcement filters use database semantics and long content is shortened after validation', async () => {
  const categories = ['社团通知', '课程安排', '比赛信息', '活动报名', '其他'];
  const rows: Row[] = categories.map((category, index) => ({ ...published('announcements', `正文 ${category}`), id: `12345678-1234-1234-1234-123456789ab${index}`, category, title: `${category} 公告` }));
  const longRows: Row[] = categories.map((category, index) => ({ ...rows[index], content: (`正文 ${category} `).repeat(1500) }));
  const unpublished: Row = { ...rows[0], id: '12345678-1234-1234-1234-123456789999', is_published: false, title: '草稿公告' };
  dbRead = url => {
    const category = url.searchParams.get('category')?.slice('eq.'.length);
    const source = category ? longRows : rows;
    const title = url.searchParams.get('title');
    const publishedRows = [...source, unpublished].filter(row => row.is_published === true && (!category || row.category === category) && (!title || (title.includes('不存在') ? String(row.title).includes('不存在') : true)));
    return publishedRows.slice(Number(url.searchParams.get('offset') || 0), Number(url.searchParams.get('offset') || 0) + Number(url.searchParams.get('limit') || 0));
  };
  const all = await card('read_published_content', { ...publishedArgs, kind: 'announcements', page_size: 5 }, integratedFetch);
  assert.equal(all.status, 'success'); assert.equal(all.returned_count, 5); assert.equal(all.has_more, false); assert.equal(all.truncated, false);
  for (const category of categories) {
    const result = await card('read_published_content', { ...publishedArgs, page_size: 2, category }, integratedFetch);
    assert.equal(result.status, 'success', category); assert.equal(result.returned_count, 1, category);
    assert.equal(result.data[0].category, category); assert(String(result.data[0].content).length <= 5000); assert(String(result.data[0].content).length > 0);
    assert.equal(result.truncated, true); assert.equal(dbCalls.at(-1)!.searchParams.get('category'), `eq.${category}`);
  }
  const empty = await card('read_published_content', { ...publishedArgs, page_size: 2, category: '其他', title_contains: '不存在' }, integratedFetch);
  assert.equal(empty.status, 'empty'); assert.equal(empty.returned_count, 0);
  assert.equal(dbCalls.at(-1)!.searchParams.get('title'), 'match."不存在"');
  dbRead = () => [];
  assert.equal((await card('read_published_content', { ...publishedArgs, category: '其他' }, integratedFetch)).status, 'empty');
});

await pass('6000 byte envelope cap reports truncation without falsely declaring complete row retrieval', async () => {
  dbRead = () => Array.from({ length: 50 }, () => published('events', '汉'.repeat(8000)));
  // Server response itself is capped at 64KiB, so a huge upstream is unavailable.
  assert.equal((await card('read_published_content', { ...publishedArgs, kind: 'events', page_size: 50 }, integratedFetch)).status, 'unavailable');
  dbRead = () => [published('events', '汉'.repeat(8000))];
  const envelope = await executeAssistantReadTool('read_published_content', { ...publishedArgs, kind: 'events', page_size: 1 }, options(integratedFetch));
  const result = envelope.results[0] as AssistantQueryCard;
  assert.equal(result.status, 'success'); assert.equal(result.truncated, true); assert.equal(result.has_more, false); assert.equal(result.returned_count, 1);
  assert(new TextEncoder().encode(JSON.stringify(envelope)).byteLength <= 6000); assert(String(result.data[0].content).length <= 5000);
  const many = await executeAssistantReadTool('read_game_leaderboard', { ...boardArgs, page_size: 50 }, options(mock(Array.from({ length: 50 }, () => gomoku('汉'.repeat(40))))));
  const manyCard = many.results[0] as AssistantQueryCard;
  assert(new TextEncoder().encode(JSON.stringify(many)).byteLength <= 6000); assert(manyCard.returned_count < 50); assert.equal(manyCard.has_more, true); assert.equal(manyCard.truncated, true);
  assert.equal(many.fetched_at, instant);
});

await pass('caller abort propagates before fetch, during ignored fetch, stalled streams, and synchronous rejection', async () => {
  const pre = new AbortController(); pre.abort();
  await assert.rejects(executeAssistantReadTool('read_game_leaderboard', boardArgs, { ...options(mock([])), signal: pre.signal }), { name: 'AbortError' });
  for (const stream of [false, true]) {
    const controller = new AbortController(); let reached!: () => void; let cancelled = false;
    const ready = new Promise<void>(resolve => reached = resolve);
    const fetcher = (async (_input, init) => {
      if (init?.body) return json(gate);
      reached(); return stream ? new Response(new ReadableStream({ cancel() { cancelled = true; } })) : await new Promise<Response>(() => {});
    }) as typeof fetch;
    const pending = executeAssistantReadTool('read_game_leaderboard', boardArgs, { ...options(fetcher), signal: controller.signal });
    await ready; await Promise.resolve(); controller.abort(); await assert.rejects(pending, { name: 'AbortError' }); if (stream) assert(cancelled);
  }
  const controller = new AbortController();
  await assert.rejects(executeAssistantReadTool('read_game_leaderboard', boardArgs, { ...options((async () => { controller.abort(); throw new Error('abort race'); }) as typeof fetch), signal: controller.signal }), { name: 'AbortError' });
});

await pass('whole-call five second deadline covers fetch that ignores signal', async () => {
  const start = Date.now();
  const result = await card('read_game_leaderboard', boardArgs, (async () => await new Promise<Response>(() => {})) as typeof fetch);
  assert.equal(result.status, 'unavailable'); assert(Date.now() - start >= 4900 && Date.now() - start < 7000);
});

console.log('Semantic tools: strict schemas, all nine approved datasets, true handler auth/query mocks, privacy, completeness, gates, bigint, budgets and cancellation passed.');
