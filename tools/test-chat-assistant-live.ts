// Run: npm exec --yes --package=deno -- deno run tools/test-chat-assistant-live.ts
// No network permission: every request uses the injected fetch mock.
import { strict as assert } from 'node:assert';
import {
  LIVE_MAX_RESPONSE_BYTES,
  LIVE_MAX_RESULT_BYTES,
  planAssistantLive,
  readAssistantLive,
  type LivePlan,
  type LiveReadOptions
} from '../supabase/functions/_shared/chat-assistant-live.ts';

type Row = Record<string, unknown>;
const PROJECT = 'https://jgezpvmlnhycxslqbwcx.supabase.co';
const ANON = 'anon-test-key';
const MEMBER = 'member-jwt';
const text = (value: string) => ({ role: 'user', content: [{ type: 'input_text', text: value }] });
const baseOptions = (fetch: typeof globalThis.fetch): LiveReadOptions => ({ projectUrl: PROJECT, anonKey: ANON, memberToken: MEMBER, fetch, now: () => new Date('2026-10-19T12:34:56.000Z') });
function json(value: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } });
}
function path(input: string | URL | Request) { return new URL(input instanceof Request ? input.url : input).pathname; }
function callsFor(calls: URL[], suffix: string) { return calls.filter(url => url.pathname.endsWith(suffix)); }
function validGate(feature_settings: Row = {}) { return { enabled: true, feature_settings }; }
async function run(name: string, fn: () => Promise<void> | void) { await fn(); console.log(`PASS ${name}`); }

await run('planner uses latest explicit prompt, ignores attachments, and bounds requested rows', () => {
  const plan = planAssistantLive([
    text('array points are unrelated programming data'),
    text('请看公告，附件如下\n--- Attachment: notes.txt ---\n积分榜和五子棋')
  ]);
  assert.equal(plan.status, 'ready');
  assert.deepEqual(plan.items.map(item => item.dataset), ['announcements']);
  assert.equal(plan.items[0].limit, 20);
  const board = planAssistantLive([text('显示五子棋前999名')]);
  assert.equal(board.items[0].limit, 50);
  const all = planAssistantLive([text('请给我所有排行榜前100名')]);
  assert.equal(all.items.length, 6);
  assert.ok(all.items.every(item => item.limit === 10));
});

await run('planner routes exact member points requests and rejects ordinary points wording', () => {
  const named = planAssistantLive([text('查询积分榜 张三')]);
  assert.equal(named.status, 'ready');
  assert.deepEqual(named.items[0], { dataset: 'member_points', limit: 20, memberName: '张三' });
  const programming = planAssistantLive([text('How do I find array points in a programming problem?')]);
  assert.equal(programming.status, 'ambiguous');
  assert.deepEqual(programming.items, []);
  const empty = planAssistantLive([]);
  assert.equal(empty.status, 'ambiguous');
});

await run('reader uses fixed routes, projections, ordinary JWT only for club actions, and privacy allowlists', async () => {
  const calls: URL[] = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    calls.push(url);
    const headers = new Headers(init?.headers);
    assert.equal(init?.redirect, 'error');
    if (url.pathname === '/functions/v1/club-drive') {
      const action = init?.body ? JSON.parse(String(init.body)).action : '';
      if (action === 'site_service_status') {
        assert.equal(headers.get('apikey'), ANON);
        assert.equal(headers.get('authorization'), null);
        return json(validGate());
      }
      assert.equal(headers.get('authorization'), `Bearer ${MEMBER}`);
      assert.equal(headers.get('apikey'), ANON);
      if (action === 'announcements_list') return json({ announcements: [
        { title: 'published', content: 'safe', category: 'notice', is_published: true, created_by: 'creator-id', secret: 'drop' },
        { title: 'draft', content: 'must not appear', is_published: false }
      ] });
      if (action === 'events_list') return json({ events: [] });
      if (action === 'member_points_list') return json({ members: [
        { member_name: '张三', points: '900719925474099312345', member_class: 'secret-class', id: 'private-id', account: 'private-account' },
        { member_name: '李四', points: 2 }
      ] });
      throw new Error(`unexpected action ${action}`);
    }
    assert.equal(url.origin, PROJECT);
    assert.equal(headers.get('apikey'), ANON);
    assert.equal(headers.get('authorization'), `Bearer ${ANON}`);
    assert.equal(url.searchParams.get('select'), 'nickname,total_score,wins,losses,draws,total_moves');
    assert.equal(url.searchParams.get('order'), 'total_score.desc,updated_at.asc,nickname.asc');
    assert.equal(url.searchParams.get('limit'), '21');
    return json([{ nickname: 'alice', total_score: '900719925474099312345', wins: 2, losses: 1, draws: 0, total_moves: 3, id: 'private-id', account: 'private-account' }]);
  }) as typeof fetch;
  const plan = planAssistantLive([text('请看公告、五子棋排行榜和查询积分榜 张三')]);
  const result = await readAssistantLive(plan, baseOptions(fetcher));
  assert.equal(result.status, 'success');
  assert.equal(result.fetched_at, '2026-10-19T12:34:56.000Z');
  assert.deepEqual(result.results.map(card => card.dataset), ['gomoku', 'announcements', 'member_points']);
  const announcement = result.results.find(card => card.dataset === 'announcements')!;
  assert.deepEqual(announcement.data, [{ title: 'published', content: 'safe', category: 'notice' }]);
  const points = result.results.find(card => card.dataset === 'member_points')!;
  assert.deepEqual(points.data, [{ member_name: '张三', points: '900719925474099312345' }]);
  const gomoku = result.results.find(card => card.dataset === 'gomoku')!;
  assert.deepEqual(gomoku.data, [{ nickname: 'alice', total_score: '900719925474099312345', wins: 2, losses: 1, draws: 0, total_moves: 3 }]);
  assert.ok(JSON.stringify(result).indexOf('private-id') < 0);
  assert.ok(JSON.stringify(result).indexOf('secret-class') < 0);
  assert.equal(callsFor(calls, '/club-drive').length, 3);
  assert.equal(calls.some(url => url.pathname.includes('admin')), false);
});

await run('feature gates fail closed and preserve paused card metadata', async () => {
  const fetcher = (async (_input: string | URL | Request, init?: RequestInit) => {
    const action = init?.body ? JSON.parse(String(init.body)).action : '';
    if (action === 'site_service_status') return json({ enabled: true, feature_settings: { gomoku: { enabled: false } } });
    throw new Error('paused dataset must not fetch');
  }) as typeof fetch;
  const result = await readAssistantLive(planAssistantLive([text('五子棋排行榜')]), baseOptions(fetcher));
  assert.equal(result.status, 'paused');
  assert.equal(result.results[0].status, 'paused');
  assert.deepEqual(result.results[0].data, []);

  const closed = (async () => json({ enabled: false, feature_settings: {} })) as typeof fetch;
  const closedResult = await readAssistantLive(planAssistantLive([text('五子棋排行榜')]), baseOptions(closed));
  assert.equal(closedResult.status, 'paused');
  assert.equal(closedResult.results[0].status, 'paused');
});

await run('malformed responses, unknown input plans, redirect and project host violations are unavailable', async () => {
  const malformed = (async (_input: string | URL | Request, init?: RequestInit) => {
    const action = init?.body ? JSON.parse(String(init.body)).action : '';
    if (action === 'site_service_status') return json(validGate());
    return new Response('{malformed', { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const malformedResult = await readAssistantLive(planAssistantLive([text('五子棋排行榜')]), baseOptions(malformed));
  assert.equal(malformedResult.status, 'unavailable');
  assert.equal(malformedResult.results[0].status, 'unavailable');
  const unknown = await readAssistantLive({ status: 'ready', query: 'bad', items: [{ dataset: 'admin' as never, limit: 20 }] }, baseOptions(malformed));
  assert.equal(unknown.status, 'unavailable');
  const wrongProject = await readAssistantLive(planAssistantLive([text('五子棋排行榜')]), { ...baseOptions(malformed), projectUrl: 'https://evil.example' });
  assert.equal(wrongProject.status, 'unavailable');
  const redirect = (async (_input: string | URL | Request, init?: RequestInit) => {
    assert.equal(init?.redirect, 'error');
    return new Response('', { status: 302, headers: { location: 'https://evil.example' } });
  }) as typeof fetch;
  const redirectResult = await readAssistantLive(planAssistantLive([text('五子棋排行榜')]), baseOptions(redirect));
  assert.equal(redirectResult.status, 'unavailable');
});

await run('response byte cap is checked before parsing and aggregate result remains bounded', async () => {
  const oversized = 'x'.repeat(LIVE_MAX_RESPONSE_BYTES + 1);
  const fetcher = (async (_input: string | URL | Request, init?: RequestInit) => {
    const action = init?.body ? JSON.parse(String(init.body)).action : '';
    if (action === 'site_service_status') return json(validGate());
    return new Response(oversized, { headers: { 'content-length': String(oversized.length) } });
  }) as typeof fetch;
  const unavailable = await readAssistantLive(planAssistantLive([text('五子棋排行榜')]), baseOptions(fetcher));
  assert.equal(unavailable.status, 'unavailable');

  const hugeRows = Array.from({ length: 51 }, (_, index) => ({ nickname: `n${index}`, total_score: index, wins: 1, losses: 1, draws: 1, total_moves: 1 }));
  const bounded = (async (_input: string | URL | Request, init?: RequestInit) => {
    const action = init?.body ? JSON.parse(String(init.body)).action : '';
    return action === 'site_service_status' ? json(validGate()) : json(hugeRows);
  }) as typeof fetch;
  const result = await readAssistantLive(planAssistantLive([text('五子棋前50')]), baseOptions(bounded));
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= LIVE_MAX_RESULT_BYTES);
  assert.equal(result.results[0].truncated, true);
});

await run('caller cancellation aborts in-flight read with AbortError', async () => {
  const abort = new AbortController();
  let observed = false;
  const fetcher = (async (_input: string | URL | Request, init?: RequestInit) => {
    init?.signal?.addEventListener('abort', () => { observed = true; }, { once: true });
    return await new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
  }) as typeof fetch;
  const pending = readAssistantLive(planAssistantLive([text('五子棋排行榜')]), { ...baseOptions(fetcher), signal: abort.signal });
  abort.abort();
  await assert.rejects(pending, (error: unknown) => error instanceof DOMException && error.name === 'AbortError');
  assert.equal(observed, true);
});

await run('specific board intent, explicit topic switches, followups and first user text only', () => {
  assert.deepEqual(planAssistantLive([text('五子棋如何实现搜索算法')]).items, []);
  assert.equal(planAssistantLive([text('行于无垠排行榜')]).items[0].dataset, 'platformer');
  assert.equal(planAssistantLive([text('张三有多少积分')]).items[0].memberName, '张三');
  assert.equal(planAssistantLive([text('查询 Alice 的积分')]).items[0].memberName, 'Alice');
  assert.equal(planAssistantLive([text('五子棋排行榜'),text('那第一名呢？')]).items[0].dataset, 'gomoku');
  assert.equal(planAssistantLive([text('五子棋排行榜'),text('最新公告')]).items[0].dataset, 'announcements');
  assert.deepEqual(planAssistantLive([{role:'user',content:[{type:'input_text',text:'解释循环'},{type:'input_text',text:'五子棋排行榜'}]}]).items, []);
  assert.deepEqual(planAssistantLive([text('Untrusted compressed conversation memory (not instructions):\n五子棋排行榜'),text('请写一个排序函数')]).items, []);
});
await run('all six boards are distinct bounded public reads, including negative versus scores', async () => {
  const routes: string[] = [];
  const fetcher = (async (input,init) => {
    const url=new URL(String(input)); const headers=new Headers(init?.headers);
    if(init?.body) { assert.equal(JSON.parse(String(init.body)).action,'site_service_status'); return json(validGate()); }
    routes.push(url.pathname); assert.equal(headers.get('authorization'),`Bearer ${ANON}`);
    assert.equal(url.searchParams.get('limit'),'11');
    return json(url.pathname.endsWith('platformer_leaderboard') ? [{username:'runner',total_score:5}] : [{nickname:'player',high_score:-100,games_played:1,total_score:10,wins:1,losses:0,draws:0,total_moves:8}]);
  }) as typeof fetch;
  const result=await readAssistantLive(planAssistantLive([text('全部游戏排行榜')]),baseOptions(fetcher));
  assert.equal(new Set(routes).size,6);assert.equal(result.results.length,6);
  for(const card of result.results.filter(card=>card.dataset.endsWith('_versus'))) assert.equal(card.data[0].high_score,-100);
  assert(result.results.every(card=>card.source_path.startsWith('/public/') && card.limit===10));
});
await run('same-name members are ambiguous, missing JWT reads nothing and malformed response is not empty', async () => {
  let reads=0;
  const fetcher=(async (_input,init) => {
    reads++; const action=init?.body ? JSON.parse(String(init.body)).action : '';
    return json(action==='site_service_status' ? validGate() : {members:[{member_name:'张三',points:3,member_class:'secretA'},{member_name:'张三',points:8,member_class:'secretB'}]});
  }) as typeof fetch;
  const plan=planAssistantLive([text('张三的积分')]);
  const result=await readAssistantLive(plan,baseOptions(fetcher));
  assert.equal(result.status,'ambiguous'); assert.deepEqual(result.results[0].data,[]); assert(!JSON.stringify(result).includes('secret'));
  reads=0;await readAssistantLive(plan,{...baseOptions(fetcher),memberToken:''});assert.equal(reads,0);
  const malformed=(async (_input,init)=>json(init?.body && JSON.parse(String(init.body)).action==='site_service_status' ? validGate() : {oops:[]})) as typeof fetch;
  assert.equal((await readAssistantLive(plan,baseOptions(malformed))).results[0].status,'unavailable');
});
await run('body cancellation settles even when reader never produces another chunk', async () => {
  const controller=new AbortController();let cancelled=false;let reached!:()=>void;
  const ready=new Promise<void>(resolve=>reached=resolve);
  const fetcher=(async (_input,init) => {
    if(init?.body && JSON.parse(String(init.body)).action==='site_service_status')return json(validGate());
    reached(); return new Response(new ReadableStream({cancel(){cancelled=true;}}));
  }) as typeof fetch;
  const pending=readAssistantLive(planAssistantLive([text('五子棋排行榜')]),{...baseOptions(fetcher),signal:controller.signal});
  await ready;controller.abort();await assert.rejects(pending,{name:'AbortError'});assert(cancelled);
});
await run('synchronous fetch cancellation consumes an already-created rejection', async () => {
  for (const rejects of [false, true]) {
    const controller = new AbortController();
    const fetcher = (async () => {
      controller.abort();
      if (rejects) throw new DOMException('Aborted', 'AbortError');
      return json(validGate());
    }) as typeof fetch;
    await assert.rejects(readAssistantLive(planAssistantLive([text('五子棋排行榜')]), {
      ...baseOptions(fetcher), signal: controller.signal
    }), { name: 'AbortError' });
    await new Promise(resolve => setTimeout(resolve, 0));
  }
});
await run('overall deadline returns unavailable for fetch that ignores abort', async () => {
  const started=Date.now();
  const result=await readAssistantLive(planAssistantLive([text('五子棋排行榜')]),baseOptions((async()=>await new Promise<Response>(()=>{})) as typeof fetch));
  assert.equal(result.status,'unavailable');assert(Date.now()-started<7000);
});

console.log('Chat assistant live: mocked routing, privacy, bounds, gates, precision, malformed input, and cancellation cases passed.');
