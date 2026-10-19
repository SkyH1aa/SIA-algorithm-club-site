// Read-only, fixed-route live data adapter for the chat assistant.
// This module deliberately contains no model calls, writes, retries, or service-role credentials.

export const LIVE_PROJECT_HOST = 'jgezpvmlnhycxslqbwcx.supabase.co';
export const LIVE_TIMEOUT_MS = 5000;
export const LIVE_MAX_DATASETS = 8;
export const LIVE_DEFAULT_LIMIT = 20;
export const LIVE_MAX_LIMIT = 50;
export const LIVE_ALL_BOARD_LIMIT = 10;
export const LIVE_MAX_RESPONSE_BYTES = 64 * 1024;
export const LIVE_MAX_RESULT_BYTES = 16 * 1024;
export const LIVE_MAX_QUERY_CHARS = 4000;

type liveJsonRecord = Record<string, unknown>;
export type LiveStatus = 'success' | 'empty' | 'unavailable' | 'paused' | 'ambiguous';
export type LiveDataset =
  | 'announcements'
  | 'events'
  | 'member_points'
  | 'gomoku'
  | 'tetris'
  | 'tetris_versus'
  | 'snake'
  | 'snake_versus'
  | 'platformer';
export type LivePlanItem = { dataset: LiveDataset; limit: number; memberName?: string };
export type LivePlan = {
  status: 'ready' | 'ambiguous';
  query: string;
  items: LivePlanItem[];
};
export type LiveCard = {
  dataset: LiveDataset;
  status: LiveStatus;
  title: string;
  source_path: string;
  metric: string;
  limit: number;
  truncated: boolean;
  data: liveJsonRecord[];
};
export type LiveEnvelope = {
  status: LiveStatus;
  fetched_at: string;
  results: LiveCard[];
};
export type LiveReadOptions = {
  projectUrl: string;
  anonKey: string;
  memberToken: string;
  signal?: AbortSignal;
  fetch?: typeof globalThis.fetch;
  now?: () => Date | number;
};

const liveEncoder = new TextEncoder();
const liveDecoder = new TextDecoder("utf-8", {fatal:true});
const liveCLUB_DATASETS = new Set<LiveDataset>(['announcements', 'events', 'member_points']);
const liveGATE_BY_DATASET: Record<LiveDataset, string> = {
  announcements: 'events', events: 'events', member_points: 'points',
  gomoku: 'gomoku', tetris: 'tetris', tetris_versus: 'tetris',
  snake: 'snake', snake_versus: 'snake', platformer: 'platformer'
};
const liveTITLES: Record<LiveDataset, string> = {
  announcements: 'Published announcements', events: 'Published events', member_points: 'Member points',
  gomoku: 'Gomoku leaderboard', tetris: 'Tetris leaderboard', tetris_versus: 'Tetris versus leaderboard',
  snake: 'Snake leaderboard', snake_versus: 'Snake versus leaderboard', platformer: 'Platformer leaderboard'
};
const liveSOURCES: Record<LiveDataset, string> = {
  announcements: '/public/events.html', events: '/public/events.html', member_points: '/public/member-points.html',
  gomoku: '/public/gomoku.html', tetris: '/public/tetris.html', tetris_versus: '/public/tetris.html',
  snake: '/public/snake.html', snake_versus: '/public/snake.html', platformer: '/public/platformer.html'
};
const liveMETRICS: Record<LiveDataset, string> = {
  announcements: 'published announcements', events: 'published events', member_points: 'points',
  gomoku: 'total_score', tetris: 'high_score', tetris_versus: 'highest player score minus AI score',
  snake: 'high_score', snake_versus: 'highest player score minus AI score', platformer: 'total_score'
};
const liveSELECTS: Record<Extract<LiveDataset, 'gomoku' | 'tetris' | 'tetris_versus' | 'snake' | 'snake_versus' | 'platformer'>, string> = {
  gomoku: 'nickname,total_score,wins,losses,draws,total_moves',
  tetris: 'nickname,games_played,high_score',
  tetris_versus: 'nickname,games_played,high_score',
  snake: 'nickname,games_played,high_score',
  snake_versus: 'nickname,games_played,high_score',
  platformer: 'username,total_score'
};
const liveTABLES: Record<Extract<LiveDataset, 'gomoku' | 'tetris' | 'tetris_versus' | 'snake' | 'snake_versus' | 'platformer'>, string> = {
  gomoku: 'gomoku_players', tetris: 'tetris_players', tetris_versus: 'tetris_versus_players',
  snake: 'snake_players', snake_versus: 'snake_versus_players', platformer: 'platformer_leaderboard'
};
const liveORDER_BY: Record<Extract<LiveDataset, 'gomoku' | 'tetris' | 'tetris_versus' | 'snake' | 'snake_versus' | 'platformer'>, string> = {
  gomoku: 'total_score.desc,updated_at.asc,nickname.asc', tetris: 'high_score.desc,updated_at.asc,nickname.asc', tetris_versus: 'high_score.desc,updated_at.asc,nickname.asc',
  snake: 'high_score.desc,updated_at.asc,nickname.asc', snake_versus: 'high_score.desc,updated_at.asc,nickname.asc', platformer: 'total_score.desc,username.asc'
};

function liveIsRecord(value: unknown): value is liveJsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function liveBytes(value: string) { return liveEncoder.encode(value).byteLength; }
function liveClampLimit(value: unknown) {
  if (!Number.isSafeInteger(value) || (value as number) < 1) return LIVE_DEFAULT_LIMIT;
  return Math.min(LIVE_MAX_LIMIT, value as number);
}
function liveTrimText(value: unknown, max: number) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
}
function liveCanonicalInteger(value: unknown, signed = false): number | string | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && (signed || value >= 0) ? value : null;
  if (typeof value === 'string' && (signed ? /^-?(?:0|[1-9][0-9]*)$/ : /^(?:0|[1-9][0-9]*)$/).test(value) && value.length <= 80) return value;
  return null;
}
function liveQueryText(input: unknown[]): { latest: string; previous: string[] } {
  if (!Array.isArray(input)) return { latest: '', previous: [] };
  const prompts: string[] = [];
  for (const message of input) {
    if (!liveIsRecord(message) || message.role !== 'user' || !Array.isArray(message.content)) continue;
    const first = message.content.find(part => liveIsRecord(part) && part.type === 'input_text');
    if (!liveIsRecord(first) || typeof first.text !== 'string') continue;
    if (/^(?:Earlier in this conversation|Untrusted compressed conversation memory)\b/i.test(first.text)) continue;
    const prompt = first.text.split(/(?:^|\r?\n)--- Attachment: [^\r\n]* ---\r?\n/, 1)[0].trim().slice(0, LIVE_MAX_QUERY_CHARS);
    if (prompt) prompts.push(prompt);
  }
  return { latest: prompts.at(-1) || '', previous: prompts.slice(-3, -1) };
}
function liveNormalized(value: string) { return value.normalize('NFKC').toLowerCase(); }
function liveExactName(text: string): string | undefined {
  const quoted = text.match(/[“"「]([^”"」]{1,40})[”"」].{0,10}积分/);
  const match = quoted || text.match(/(?:查询积分榜|积分榜|查询|查看|看看)\s*[:：]?\s*([\u3400-\u9fffA-Za-z][\u3400-\u9fffA-Za-z0-9_ -]{0,38}?)(?:的?(?:有多少|多少|当前|现在)?积分|[，。?!！？]|$)/i)
    || text.match(/^([\u3400-\u9fffA-Za-z][\u3400-\u9fffA-Za-z0-9_ -]{1,38}?)(?:的|有多少|多少)积分/);
  const candidate = match?.[1]?.trim();
  return candidate && !/^(?:榜|排行|排名|查询|member|points|积分榜|社员|成员|我的|我|当前|现在|所有|最新|前\d+名)$/i.test(candidate) ? candidate : undefined;
}
function liveRequestedLimit(text: string) {
  const match = text.match(/(?:top|前|取|显示|列出|排行)\s*(\d{1,3})/i);
  return match ? Math.max(1, Math.min(LIVE_MAX_LIMIT, Number(match[1]))) : LIVE_DEFAULT_LIMIT;
}
function liveQueryItems(raw: string): LivePlanItem[] {
  const text = liveNormalized(raw), selected: LivePlanItem[] = [];
  const boardIntent = /排行榜|排名|排行|榜单|积分榜|最高分|前\s*\d+|第[一二三四五六七八九十\d]+名|leaderboard|ranking|\btop\s*\d+|high\s*score/i.test(text);
  const allBoards = boardIntent && /所有|全部|各个|all\s+(?:game\s+)?(?:leaderboards|boards|rankings)/i.test(text) && (/游戏|对战|排行榜|榜单|leaderboards|boards|rankings/i.test(text)) && !/社员积分|成员积分|(?:所有|全部)积分榜/i.test(text);
  const limit = allBoards ? Math.min(liveRequestedLimit(text), LIVE_ALL_BOARD_LIMIT) : liveRequestedLimit(text);
  const add = (dataset: LiveDataset, memberName?: string) => { if (!selected.some(x => x.dataset === dataset)) selected.push({dataset,limit,...(memberName ? {memberName} : {})}); };
  if (allBoards) for (const dataset of ['gomoku','tetris','tetris_versus','snake','snake_versus','platformer'] as LiveDataset[]) add(dataset);
  else if (boardIntent) {
    const versus = /人机|对战|versus|\bvs\b/i.test(text);
    const both = /两[种个类]|两个榜|普通.*人机|人机.*普通|both/i.test(text);
    const normal = /普通|normal|regular/i.test(text);
    if (/五子棋|gomoku/i.test(text)) add('gomoku');
    if (/俄罗斯方块|方块游戏|tetris/i.test(text)) { if (normal || both) add('tetris'); if (versus) add('tetris_versus'); }
    if (/贪吃蛇|snake/i.test(text)) { if (normal || both) add('snake'); if (versus) add('snake_versus'); }
    if (/行于无垠|平台跳跃|平台游戏|platformer|boundless run/i.test(text)) add('platformer');
  }
  const howTo = /怎么|如何|哪里|在哪|入口|how (?:do|to)|where/i.test(text) && !/最新|当前|今天|现在|查询|帮我查|latest|current|today/i.test(text);
  if (!howTo && /公告|通知|announcement|\bnews\b/i.test(text)) add('announcements');
  if (!howTo && /活动|课程安排|日程|\bevents?\b|\bschedule\b/i.test(text)) add('events');
  const memberName = liveExactName(raw);
  if ((!/五子棋|俄罗斯方块|贪吃蛇|行于无垠|平台游戏|gomoku|tetris|snake|platformer/i.test(text) || /社员|成员|member points|查询积分榜/i.test(text)) && (/积分榜|社员积分|成员积分|积分排名|member points|points leaderboard/i.test(text) || memberName && /积分/.test(text))) add('member_points', memberName);
  return selected;
}
export function planAssistantLive(input: unknown[]): LivePlan {
  const query = liveQueryText(input);
  let items = liveQueryItems(query.latest);
  if (!items.length && query.latest.length < 150 && /^(?:那|再|还有|第|前|后|现在|今天|最新|查|看|top|what about|and |who|show)/i.test(query.latest) && /第|前\s*\d+|最新|第一|top|what about|现在|今天|呢/i.test(query.latest)) {
    const prior = query.previous.toReversed().find(value => liveQueryItems(value).length);
    if (prior) items = liveQueryItems(`${prior}\n${query.latest}`);
  }
  return {status:items.length ? 'ready' : 'ambiguous',query:query.latest,items:items.slice(0,LIVE_MAX_DATASETS)};
}

function liveProjectUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 300) throw new Error('project');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== LIVE_PROJECT_HOST || url.username || url.password || url.port || url.search || url.hash || !/^\/?$/.test(url.pathname)) throw new Error('project');
  return `https://${LIVE_PROJECT_HOST}`;
}
function liveAssertOptions(options: LiveReadOptions) {
  const base = liveProjectUrl(options.projectUrl);
  if (typeof options.anonKey !== 'string' || !options.anonKey.trim() || options.anonKey.length > 500) throw new Error('credentials');
  if (typeof options.memberToken !== 'string' || !options.memberToken.trim() || options.memberToken.length > 8000) throw new Error('credentials');
  return base;
}
function liveAbortError() { return new DOMException('The operation was aborted', 'AbortError'); }
function liveTimestamp(now?: () => Date | number) {
  const value = now ? now() : new Date();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}
function liveSafeJsonWithIntegers(text: string): unknown {
  // Quote oversized integer tokens before JSON.parse so bigint values never pass through a Number.
  let out = '', inString = false, escaped = false;
  for (let i = 0; i < text.length;) {
    const char = text[i];
    if (inString) {
      out += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      i += 1; continue;
    }
    if (char === '"') { inString = true; out += char; i += 1; continue; }
    if (char === '-' || (char >= '0' && char <= '9')) {
      const rest = text.slice(i);
      const match = rest.match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/);
      if (match) {
        const token = match[0];
        if (/^-?(?:0|[1-9][0-9]*)$/.test(token)) {
          try {
            const integer = BigInt(token);
            if (integer > BigInt(Number.MAX_SAFE_INTEGER) || integer < BigInt(Number.MIN_SAFE_INTEGER)) out += `"${token}"`;
            else out += token;
          } catch { out += token; }
        } else out += token;
        i += token.length; continue;
      }
    }
    out += char; i += 1;
  }
  return JSON.parse(out);
}
async function liveReadBounded(response: Response, signal: AbortSignal): Promise<string> {
  const length = response.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > LIVE_MAX_RESPONSE_BYTES)) throw new Error('response_limit');
  if (!response.body) {
    const text = await response.text();
    if (liveBytes(text) > LIVE_MAX_RESPONSE_BYTES) throw new Error('response_limit');
    return text;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      if (signal.aborted) throw liveAbortError();
      const next = await liveAbortable(reader.read(), signal);
      if (next.done) break;
      total += next.value.byteLength;
      if (total > LIVE_MAX_RESPONSE_BYTES) throw new Error('response_limit');
      chunks.push(next.value);
    }
  } finally { void reader.cancel().catch(() => undefined); }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
  return liveDecoder.decode(merged);
}
function liveTextField(row: liveJsonRecord, key: string, max = 200) { return liveTrimText(row[key], max); }
function livePublicRow(dataset: LiveDataset, raw: unknown): liveJsonRecord | null {
  if (!liveIsRecord(raw)) return null;
  const nameKey = dataset === 'platformer' ? 'username' : 'nickname';
  const name = liveTextField(raw, nameKey, 80);
  if (!name) return null;
  const output: liveJsonRecord = { [nameKey]: name };
  const keys = dataset === 'gomoku' ? ['total_score', 'wins', 'losses', 'draws', 'total_moves'] : dataset === 'platformer' ? ['total_score'] : ['games_played', 'high_score'];
  for (const key of keys) {
    const value = liveCanonicalInteger(raw[key], key === 'high_score' && (dataset === 'tetris_versus' || dataset === 'snake_versus'));
    if (value !== null) output[key] = value;
  }
  return output;
}
function liveClubRow(dataset: 'announcements' | 'events' | 'member_points', raw: unknown): liveJsonRecord | null {
  if (!liveIsRecord(raw)) return null;
  if (dataset === 'member_points') {
    const memberName = liveTextField(raw, 'member_name', 80), points = liveCanonicalInteger(raw.points);
    return memberName && points !== null ? { member_name: memberName, points } : null;
  }
  const keys = dataset === 'announcements'
    ? ['title', 'content', 'category', 'is_pinned', 'is_featured', 'starts_at', 'ends_at', 'updated_at']
    : ['title', 'summary', 'content', 'category', 'status', 'location', 'starts_at', 'ends_at', 'signup_deadline', 'allow_signup', 'signup_limit', 'is_featured', 'updated_at'];
  const output: liveJsonRecord = {};
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === 'string') { const text = liveTrimText(value, key === 'content' ? 3000 : 300); if (text) output[key] = text; }
    else if (typeof value === 'boolean') output[key] = value;
    else if (key === 'signup_limit') { const number = liveCanonicalInteger(value); if (number !== null) output[key] = number; }
  }
  return typeof output.title === 'string' ? output : null;
}
function liveStatusForCards(cards: LiveCard[]): LiveStatus {
  if (!cards.length) return 'empty';
  if (cards.every(card => card.status === 'paused')) return 'paused';
  if (cards.every(card => card.status === 'unavailable')) return 'unavailable';
  if (cards.every(card => card.status === 'empty')) return 'empty';
  if (cards.every(card => card.status === 'ambiguous')) return 'ambiguous';
  return 'success';
}
function liveFitEnvelope(envelope: LiveEnvelope): LiveEnvelope {
  const fits = () => liveBytes(JSON.stringify(envelope)) <= LIVE_MAX_RESULT_BYTES;
  for (const card of envelope.results) {
    while (!fits() && card.data.length) { card.data.pop(); card.truncated = true; }
  }
  if (!fits()) return { ...envelope, results: envelope.results.map(card => ({ ...card, data: [], truncated: true })) };
  return envelope;
}

function liveAbortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void pending.catch(() => undefined);
    return Promise.reject(liveAbortError());
  }
  return new Promise<T>((resolve,reject) => {
    const abort = () => { signal.removeEventListener('abort',abort); reject(liveAbortError()); };
    signal.addEventListener('abort',abort,{once:true});
    pending.then(value => { signal.removeEventListener('abort',abort); resolve(value); }, error => { signal.removeEventListener('abort',abort); reject(error); });
  });
}
async function liveReadJson(fetcher: typeof globalThis.fetch, url: string, init: RequestInit, signal: AbortSignal): Promise<unknown> {
  const response = await liveAbortable(fetcher(url, { ...init, redirect: 'error', signal }).then(response => { if (signal.aborted) { void response.body?.cancel().catch(() => undefined); throw liveAbortError(); } return response; }), signal);
  if (!response.ok) { void response.body?.cancel().catch(() => undefined); throw new Error('http'); }
  const text = await liveReadBounded(response, signal);
  return liveSafeJsonWithIntegers(text);
}

export async function readAssistantLive(plan: LivePlan, options: LiveReadOptions): Promise<LiveEnvelope> {
  const fetchedAt = liveTimestamp(options.now);
  if (!plan || plan.status !== 'ready' || !Array.isArray(plan.items) || !plan.items.length || plan.items.length > LIVE_MAX_DATASETS || plan.items.some(request => !request || !liveCLUB_DATASETS.has(request.dataset) && !['gomoku', 'tetris', 'tetris_versus', 'snake', 'snake_versus', 'platformer'].includes(request.dataset) || liveClampLimit(request.limit) !== request.limit || request.memberName !== undefined && (request.dataset !== 'member_points' || typeof request.memberName !== 'string' || !request.memberName.trim() || request.memberName.length > 40))) {
    return { status: plan?.status === 'ready' ? 'unavailable' : 'ambiguous', fetched_at: fetchedAt, results: [] };
  }
  let base: string;
  try { base = liveAssertOptions(options); } catch { return { status: 'unavailable', fetched_at: fetchedAt, results: [] }; }
  const fetcher = options.fetch || globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIVE_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  if (options.signal?.aborted) { clearTimeout(timer); throw liveAbortError(); }
  options.signal?.addEventListener('abort', onAbort, { once: true });
  const results: LiveCard[] = [];
    try {
      let gate: liveJsonRecord;
      try {
        gate = {};
        const payload = await liveReadJson(fetcher, `${base}/functions/v1/club-drive`, {
          method: 'POST', headers: { 'content-type': 'application/json', apikey: options.anonKey },
          body: JSON.stringify({ action: 'site_service_status' })
        }, controller.signal);
      gate = Array.isArray(payload) ? (liveIsRecord(payload[0]) ? payload[0] : {}) : (liveIsRecord(payload) ? payload : {});
      if (typeof gate.enabled !== 'boolean' || !liveIsRecord(gate.feature_settings)) throw new Error('gate');
    } catch (error) {
      if (options.signal?.aborted) throw liveAbortError();
      return { status: 'unavailable', fetched_at: fetchedAt, results: [] };
    }
    if (gate.enabled === false) {
      for (const request of plan.items.slice(0, LIVE_MAX_DATASETS)) results.push({ dataset: request.dataset, status: 'paused', title: liveTITLES[request.dataset], source_path: liveSOURCES[request.dataset], metric: liveMETRICS[request.dataset], limit: request.limit, truncated: false, data: [] });
      return liveFitEnvelope({ status: 'paused', fetched_at: fetchedAt, results });
    }
    const features = gate.feature_settings as liveJsonRecord;
    for (const request of plan.items.slice(0, LIVE_MAX_DATASETS)) {
      const cardBase = { dataset: request.dataset, title: liveTITLES[request.dataset], source_path: liveSOURCES[request.dataset], metric: liveMETRICS[request.dataset], limit: request.limit };
      const feature = features[liveGATE_BY_DATASET[request.dataset]];
      if (feature !== undefined && (!liveIsRecord(feature) || typeof feature.enabled !== 'boolean' || feature.enabled === false)) {
        results.push({ ...cardBase, status: 'paused', truncated: false, data: [] }); continue;
      }
      try {
        let payload: unknown;
        if (liveCLUB_DATASETS.has(request.dataset)) {
          payload = await liveReadJson(fetcher, `${base}/functions/v1/club-drive`, {
            method: 'POST', headers: { 'content-type': 'application/json', apikey: options.anonKey, ...(options.memberToken ? { authorization: `Bearer ${options.memberToken}` } : {}) },
            body: JSON.stringify({ action: request.dataset === 'announcements' ? 'announcements_list' : request.dataset === 'events' ? 'events_list' : 'member_points_list' })
          }, controller.signal);
        } else {
          const dataset = request.dataset as Extract<LiveDataset, 'gomoku' | 'tetris' | 'tetris_versus' | 'snake' | 'snake_versus' | 'platformer'>;
          const url = `${base}/rest/v1/${liveTABLES[dataset]}?select=${encodeURIComponent(liveSELECTS[dataset])}&order=${encodeURIComponent(liveORDER_BY[dataset])}&limit=${request.limit + 1}`;
          payload = await liveReadJson(fetcher, url, { headers: { apikey: options.anonKey, authorization: `Bearer ${options.anonKey}` } }, controller.signal);
        }
        const listKey = request.dataset === 'announcements' ? 'announcements' : request.dataset === 'events' ? 'events' : request.dataset === 'member_points' ? 'members' : '';
        if (listKey ? !liveIsRecord(payload) || !Array.isArray(payload[listKey]) : !Array.isArray(payload)) throw new Error('shape');
        const rawRows: unknown[] = request.dataset === 'announcements' ? (liveIsRecord(payload) && Array.isArray(payload.announcements) ? payload.announcements : [])
          : request.dataset === 'events' ? (liveIsRecord(payload) && Array.isArray(payload.events) ? payload.events : [])
          : request.dataset === 'member_points' ? (liveIsRecord(payload) && Array.isArray(payload.members) ? payload.members : [])
          : Array.isArray(payload) ? payload : [];
        const publishedRows = request.dataset === 'announcements' || request.dataset === 'events'
          ? rawRows.filter(row => liveIsRecord(row) && row.is_published === true)
          : rawRows;
        const memberRows = request.dataset === 'member_points' && request.memberName
          ? publishedRows.filter(row => liveIsRecord(row) && typeof row.member_name === 'string' && liveNormalized(row.member_name) === liveNormalized(request.memberName!))
          : publishedRows;
        const mapped = memberRows.map(row => liveCLUB_DATASETS.has(request.dataset) ? liveClubRow(request.dataset as 'announcements' | 'events' | 'member_points', row) : livePublicRow(request.dataset, row)).filter((row): row is liveJsonRecord => Boolean(row));
        if (request.dataset === 'member_points') mapped.sort((a,b) => { const x=BigInt(String(a.points)), y=BigInt(String(b.points)); return x===y ? String(a.member_name).localeCompare(String(b.member_name)) : x>y ? -1 : 1; });
        const truncated = mapped.length > request.limit || rawRows.length > request.limit && !request.memberName || memberRows.some(row => liveIsRecord(row) && Object.entries(row).some(([key,value]) => typeof value === 'string' && value.length > (key === 'content' ? 3000 : 300)));
        if (request.memberName && mapped.length > 1) { results.push({...cardBase,status:'ambiguous',truncated:false,data:[]}); continue; }
        results.push({ ...cardBase, status: mapped.length ? 'success' : 'empty', truncated, data: mapped.slice(0, request.limit) });
      } catch (error) {
        if (options.signal?.aborted) throw liveAbortError();
        results.push({ ...cardBase, status: 'unavailable', truncated: false, data: [] });
      }
    }
    return liveFitEnvelope({ status: liveStatusForCards(results), fetched_at: fetchedAt, results });
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}
