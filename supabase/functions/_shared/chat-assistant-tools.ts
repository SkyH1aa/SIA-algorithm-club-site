// Bounded semantic reads only. Keep the art prefix: this source may be bundled for Dashboard.
import {
  LIVE_PROJECT_HOST, LIVE_TIMEOUT_MS, LIVE_MAX_RESPONSE_BYTES,
  type LiveReadOptions, type LiveEnvelope, type LiveCard, type LiveDataset, type LiveStatus
} from '../_shared/chat-assistant-live.ts';

type artRecord = Record<string, unknown>;
type artQuery = artRecord & { dataset: LiveDataset; order_by: string; direction: 'asc' | 'desc'; page: number; page_size: number };
export type AssistantQueryCard = LiveCard & {
  query: { order_by: string; direction: 'asc' | 'desc'; page: number; page_size: number; filters: Record<string, unknown> };
  has_more: boolean | null;
  returned_count: number;
};
const artBoards = ['gomoku', 'tetris', 'tetris_versus', 'snake', 'snake_versus', 'platformer'];
const artDates = ['created_at', 'updated_at', 'starts_at', 'ends_at'];
const artStatuses = ['草稿', '报名中', '进行中', '已截止', '已结束', '已取消'];
const artCategories = ['社团通知', '课程安排', '比赛信息', '活动报名', '其他'];
const artFields: Record<string, string[]> = {
  gomoku: ['nickname', 'total_score', 'wins', 'losses', 'draws', 'total_moves'],
  tetris: ['nickname', 'games_played', 'high_score'], tetris_versus: ['nickname', 'games_played', 'high_score'],
  snake: ['nickname', 'games_played', 'high_score'], snake_versus: ['nickname', 'games_played', 'high_score'],
  platformer: ['username', 'total_score'], member_points: ['member_name', 'points'],
  announcements: ['id', 'title', 'content', 'category', 'is_pinned', 'is_featured', 'is_published', ...artDates],
  events: ['id', 'title', 'summary', 'content', 'category', 'status', 'location', 'signup_deadline', 'allow_signup', 'signup_limit', 'is_featured', 'is_published', ...artDates]
};
const artTables: Record<string, string> = { gomoku: 'gomoku_players', tetris: 'tetris_players', tetris_versus: 'tetris_versus_players', snake: 'snake_players', snake_versus: 'snake_versus_players', platformer: 'platformer_leaderboard' };
const artEncoder = new TextEncoder();
const artDecoder = new TextDecoder('utf-8', { fatal: true });
const artToolAllowedKeys: Record<string, string[]> = {
  read_member_points: ['order_by', 'direction', 'page', 'page_size', 'member_name', 'min_points', 'max_points'],
  read_game_leaderboard: ['board', 'order_by', 'direction', 'page', 'page_size', 'name', 'min_score', 'max_score'],
  read_published_content: ['kind', 'order_by', 'direction', 'page', 'page_size', 'title_contains', 'category', 'status', 'date_field', 'after', 'before', 'id']
};
const artCommonSchema = {
  direction: { type: 'string', enum: ['asc', 'desc'] },
  page: { type: 'integer', minimum: 1, maximum: 100 }, page_size: { type: 'integer', minimum: 1, maximum: 50 }
};
const artStringSchema = (maxLength: number) => ({ type: 'string', minLength: 1, maxLength });
const artScoreSchema = { type: 'string', maxLength: 20, pattern: '^(?:0|[1-9][0-9]*|-[1-9][0-9]*)$' };
export const ASSISTANT_READ_TOOLS: Array<{ name: string; description: string; parameters: Record<string, unknown> }> = [
  { name: 'read_member_points', description: 'Read public member names and points with database ordering, exact-name or points filters, and bounded pages. Exact duplicate names are ambiguous; never infer a class or identity. Pages are not a full population count. If returned_count is below page_size with truncated=true, retry the same page with a smaller page_size before traversing further.', parameters: {
    type: 'object', additionalProperties: false, required: ['order_by', 'direction', 'page', 'page_size'], properties: {
      ...artCommonSchema, order_by: { type: 'string', enum: ['points', 'member_name'] }, member_name: artStringSchema(40),
      min_points: { type: 'integer', minimum: 0, maximum: 1000000 }, max_points: { type: 'integer', minimum: 0, maximum: 1000000 }
    }
  } },
  { name: 'read_game_leaderboard', description: 'Read one of six public leaderboards. Database asc/desc supports actual lowest/highest and pages. Score bounds are canonical decimal strings in bigint range; only versus boards permit negative scores. Order fields must belong to the chosen board. No private player data.', parameters: {
    type: 'object', additionalProperties: false, required: ['board', 'order_by', 'direction', 'page', 'page_size'], properties: {
      ...artCommonSchema, board: { type: 'string', enum: artBoards }, order_by: { type: 'string', enum: [...new Set(artBoards.flatMap(board => artFields[board]))] },
      name: artStringSchema(80), min_score: artScoreSchema, max_score: artScoreSchema
    }
  } },
  { name: 'read_published_content', description: 'Read only published announcements/events, including by public UUID. Database ordering and filters apply before pagination; title_contains is a literal substring. status is events-only. Date bounds require date_field, with ISO timestamps including timezone. Content may be truncated to fit the result; check has_more/truncated.', parameters: {
    type: 'object', additionalProperties: false, required: ['kind', 'order_by', 'direction', 'page', 'page_size'], properties: {
      ...artCommonSchema, kind: { type: 'string', enum: ['announcements', 'events'] }, order_by: { type: 'string', enum: ['default', ...artDates] },
      title_contains: artStringSchema(120), category: { type: 'string', enum: artCategories }, status: { type: 'string', enum: artStatuses },
      date_field: { type: 'string', enum: artDates }, after: { type: 'string', format: 'date-time', maxLength: 35 }, before: { type: 'string', format: 'date-time', maxLength: 35 },
      id: { type: 'string', format: 'uuid', maxLength: 36 }
    }
  } }
];

// Pure club validation/projection helpers are copied with artc prefixes into club-drive.
function artIsRecord(value: unknown): value is artRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function artInvalid(): never { throw Object.assign(new Error('Invalid assistant read tool arguments'), { code: 'tool_arguments' }); }
function artText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}
function artIso(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 35 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
  if (Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59) return false;
  const day = value.slice(0, 10), parsed = new Date(`${day}T00:00:00Z`);
  return Number.isFinite(Date.parse(value)) && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day;
}
function artInteger(value: unknown, signed = false): number | string | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && !Object.is(value, -0) && (signed || value >= 0) ? value : null;
  if (typeof value !== 'string' || value.length > 20 || !(signed ? /^(?:0|[1-9][0-9]*|-[1-9][0-9]*)$/ : /^(?:0|[1-9][0-9]*)$/).test(value)) return null;
  const number = BigInt(value);
  return number >= (signed ? -9223372036854775808n : 0n) && number <= 9223372036854775807n ? value : null;
}
function artValidateQuery(input: unknown, clubOnly = false): artQuery {
  if (!artIsRecord(input)) artInvalid();
  const dataset = input.dataset;
  if (typeof dataset !== 'string' || !Object.hasOwn(artFields, dataset) || clubOnly && !['member_points', 'announcements', 'events'].includes(dataset)) artInvalid();
  const member = dataset === 'member_points', board = artBoards.includes(dataset);
  const extras = member ? ['member_name', 'min_points', 'max_points'] : board ? ['name', 'min_score', 'max_score'] : ['title_contains', 'category', 'status', 'date_field', 'after', 'before', 'id'];
  const allowed = ['dataset', 'order_by', 'direction', 'page', 'page_size', ...extras];
  if (Reflect.ownKeys(input).some(key => typeof key !== 'string' || !allowed.includes(key)) || ['dataset', 'order_by', 'direction', 'page', 'page_size'].some(key => !Object.hasOwn(input, key))) artInvalid();
  if (typeof input.direction !== 'string' || !['asc', 'desc'].includes(input.direction) || !Number.isInteger(input.page) || Number(input.page) < 1 || Number(input.page) > 100 || !Number.isInteger(input.page_size) || Number(input.page_size) < 1 || Number(input.page_size) > 50) artInvalid();
  const order = member || board ? artFields[dataset] : ['default', ...artDates];
  if (typeof input.order_by !== 'string' || !order.includes(input.order_by)) artInvalid();
  for (const [key, max] of [['member_name', 40], ['name', 80], ['title_contains', 120], ['category', 40]] as const) if (Object.hasOwn(input, key) && !artText(input[key], max)) artInvalid();
  for (const key of ['min_points', 'max_points']) if (Object.hasOwn(input, key) && (!Number.isInteger(input[key]) || Number(input[key]) < 0 || Number(input[key]) > 1000000)) artInvalid();
  for (const key of ['min_score', 'max_score']) if (Object.hasOwn(input, key) && (typeof input[key] !== 'string' || artInteger(input[key], dataset.endsWith('_versus')) === null)) artInvalid();
  for (const [min, max] of [['min_points', 'max_points'], ['min_score', 'max_score']]) if (input[min] !== undefined && input[max] !== undefined && BigInt(String(input[min])) > BigInt(String(input[max]))) artInvalid();
  if (Object.hasOwn(input, 'category') && (typeof input.category !== 'string' || !artCategories.includes(input.category))) artInvalid();
  if (Object.hasOwn(input, 'status') && (dataset !== 'events' || typeof input.status !== 'string' || !artStatuses.includes(input.status))) artInvalid();
  if (Object.hasOwn(input, 'date_field') && (typeof input.date_field !== 'string' || !artDates.includes(input.date_field) || !Object.hasOwn(input, 'after') && !Object.hasOwn(input, 'before'))) artInvalid();
  for (const key of ['after', 'before']) if (Object.hasOwn(input, key) && (!artIso(input[key]) || !Object.hasOwn(input, 'date_field'))) artInvalid();
  if (input.after !== undefined && input.before !== undefined && Date.parse(String(input.after)) > Date.parse(String(input.before))) artInvalid();
  if (Object.hasOwn(input, 'id') && (typeof input.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.id))) artInvalid();
  return { ...input } as artQuery;
}
function artLiteral(value: string) { return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`; }
function artOrder(query: artQuery) {
  if (query.order_by === 'default') return query.dataset === 'announcements'
    ? `is_pinned.${query.direction},updated_at.desc,id.asc`
    : `is_featured.${query.direction},starts_at.asc.nullslast,updated_at.desc,id.asc`;
  const ties = query.dataset === 'member_points' ? ['member_name', 'id'] : artBoards.includes(query.dataset) ? query.dataset === 'platformer' ? ['username'] : ['updated_at', 'nickname'] : ['id'];
  return [`${query.order_by}.${query.direction}.nullslast`, ...ties.filter(key => key !== query.order_by).map(key => `${key}.asc`)].join(',');
}
function artParams(query: artQuery, duplicateProbe = false) {
  const params = new URLSearchParams({ select: artFields[query.dataset].join(','), order: artOrder(query), limit: String(duplicateProbe ? 2 : query.page_size + 1), offset: String(duplicateProbe ? 0 : (query.page - 1) * query.page_size) });
  if (query.dataset === 'member_points') {
    if (query.member_name !== undefined) params.set('member_name', `eq.${artLiteral(String(query.member_name))}`);
    if (!duplicateProbe) {
      if (query.min_points !== undefined) params.append('points', `gte.${query.min_points}`);
      if (query.max_points !== undefined) params.append('points', `lte.${query.max_points}`);
    }
  } else if (artBoards.includes(query.dataset)) {
    if (query.name !== undefined) params.set(query.dataset === 'platformer' ? 'username' : 'nickname', `eq.${artLiteral(String(query.name))}`);
    const score = ['gomoku', 'platformer'].includes(query.dataset) ? 'total_score' : 'high_score';
    if (query.min_score !== undefined) params.append(score, `gte.${query.min_score}`);
    if (query.max_score !== undefined) params.append(score, `lte.${query.max_score}`);
  } else {
    params.set('is_published', 'eq.true');
    if (query.id !== undefined) params.set('id', `eq.${query.id}`);
    if (query.category !== undefined) params.set('category', `eq.${artLiteral(String(query.category))}`);
    if (query.status !== undefined) params.set('status', `eq.${artLiteral(String(query.status))}`);
    // A quoted, escaped POSIX regex is a literal substring. LIKE cannot represent a
    // literal * reliably because PostgREST aliases it to %, even inside quotes.
    if (query.title_contains !== undefined) {
      const literal = String(query.title_contains).replace(/[\\^$.*+?()[\]{}|]/g, char => `\\${char}`);
      params.set('title', `match.${artLiteral(literal)}`);
    }
    if (query.after !== undefined) params.append(String(query.date_field), `gte.${query.after}`);
    if (query.before !== undefined) params.append(String(query.date_field), `lte.${query.before}`);
  }
  return params;
}
function artPublicRow(dataset: string, raw: unknown): artRecord {
  if (!artIsRecord(raw)) throw new Error('row_schema');
  const output: artRecord = {};
  for (const key of artFields[dataset]) {
    const value = raw[key];
    if (artBoards.includes(dataset) || dataset === 'member_points') {
      if (['member_name', 'nickname', 'username'].includes(key)) { if (!artText(value, key === 'member_name' ? 40 : 80)) throw new Error('row_schema'); output[key] = value; }
      else { const integer = artInteger(value, key === 'high_score' && dataset.endsWith('_versus')); if (integer === null || key === 'points' && BigInt(String(integer)) > 1000000n) throw new Error('row_schema'); output[key] = integer; }
    } else if (['is_published', 'is_pinned', 'is_featured', 'allow_signup'].includes(key)) {
      if (typeof value !== 'boolean' || key === 'is_published' && value !== true) throw new Error('row_schema'); output[key] = value;
    } else if (artDates.includes(key) || key === 'signup_deadline') {
      if (value !== null && !artIso(value) || ['created_at', 'updated_at'].includes(key) && value === null) throw new Error('row_schema'); output[key] = value;
    } else if (key === 'signup_limit') {
      if (value !== null && (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)) throw new Error('row_schema'); output[key] = value;
    } else {
      const max = key === 'content' ? (dataset === 'events' ? 8000 : 5000) : key === 'summary' ? 500 : key === 'category' ? 40 : key === 'status' ? 20 : key === 'id' ? 36 : 120;
      if (typeof value !== 'string' || value.length > max || ['title', 'category', 'id', 'status'].includes(key) && !value.trim()) throw new Error('row_schema');
      if (key === 'id' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) || key === 'status' && !artStatuses.includes(value)) throw new Error('row_schema');
      output[key] = key === 'content' ? value.slice(0, 5000) : value;
    }
  }
  return output;
}
// End pure club helpers.

function artToolQuery(name: string, args: unknown): artQuery {
  if (!artIsRecord(args)) artInvalid();
  if (!Object.hasOwn(artToolAllowedKeys, name) || Reflect.ownKeys(args).some(key => typeof key !== 'string' || !artToolAllowedKeys[name].includes(key))) artInvalid();
  if (name === 'read_member_points') return artValidateQuery({ ...args, dataset: 'member_points' });
  if (name === 'read_game_leaderboard') {
    if (!Object.hasOwn(args, 'board') || typeof args.board !== 'string' || !artBoards.includes(args.board)) artInvalid();
    const { board, ...rest } = args; return artValidateQuery({ ...rest, dataset: board });
  }
  if (name === 'read_published_content') {
    if (!Object.hasOwn(args, 'kind') || !['announcements', 'events'].includes(String(args.kind))) artInvalid();
    const { kind, ...rest } = args; return artValidateQuery({ ...rest, dataset: kind });
  }
  return artInvalid();
}
function artAbort() { return new DOMException('The operation was aborted', 'AbortError'); }
function artRace<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) { void pending.catch(() => undefined); return Promise.reject(artAbort()); }
  return new Promise<T>((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(artAbort()); };
    signal.addEventListener('abort', abort, { once: true });
    pending.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}
function artParse(text: string): unknown {
  // Preserve bare JSON bigint integers before JSON.parse loses precision. Strings stay untouched.
  return JSON.parse(text.replace(/"(?:[^"\\]|\\.)*"|(-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/g, (token, numeric) => {
    if (!numeric || /[.eE]/.test(token)) return token;
    const number = BigInt(token); return number > BigInt(Number.MAX_SAFE_INTEGER) || number < BigInt(Number.MIN_SAFE_INTEGER) ? JSON.stringify(token) : token;
  }));
}
async function artRead(fetcher: typeof fetch, url: string, init: RequestInit, signal: AbortSignal): Promise<unknown> {
  const response = await artRace(Promise.resolve().then(() => {
    if (signal.aborted) throw artAbort();
    return fetcher(url, { ...init, redirect: 'error', signal });
  }).then(response => {
    if (signal.aborted) { void response.body?.cancel().catch(() => undefined); throw artAbort(); } return response;
  }), signal);
  if (!response.ok) { void response.body?.cancel().catch(() => undefined); throw new Error('http'); }
  const length = response.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > LIVE_MAX_RESPONSE_BYTES)) { void response.body?.cancel().catch(() => undefined); throw new Error('response_limit'); }
  if (!response.body) return artParse('');
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const part = await artRace(reader.read(), signal); if (part.done) break;
      size += part.value.byteLength; if (size > LIVE_MAX_RESPONSE_BYTES) throw new Error('response_limit'); chunks.push(part.value);
    }
  } finally { void reader.cancel().catch(() => undefined); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return artParse(artDecoder.decode(bytes));
}
function artFit(envelope: LiveEnvelope, card: AssistantQueryCard) {
  // Reserve 200 bytes under the 6000-byte tool budget for source-card id/fetched_at.
  while (artEncoder.encode(JSON.stringify(envelope)).length > 5800 && card.data.length) {
    const row = card.data.at(-1)!;
    if (typeof row.content === 'string' && row.content.length > 64) row.content = row.content.slice(0, Math.floor(row.content.length / 2));
    else { card.data.pop(); card.has_more = true; }
    card.truncated = true;
  }
  card.returned_count = card.data.length;
  return envelope;
}
export async function executeAssistantReadTool(name: string, args: unknown, options: LiveReadOptions): Promise<LiveEnvelope> {
  const query = artToolQuery(name, args);
  if (options.signal?.aborted) throw artAbort();
  const club = !artBoards.includes(query.dataset), dataset = query.dataset;
  const filters = Object.fromEntries(Object.entries(query).filter(([key]) => !['dataset', 'order_by', 'direction', 'page', 'page_size'].includes(key)));
  const card: AssistantQueryCard = {
    dataset, status: 'unavailable', title: dataset.replaceAll('_', ' '), source_path: `/public/${club ? dataset === 'member_points' ? 'member-points' : 'events' : dataset.replace('_versus', '')}.html`,
    metric: dataset === 'member_points' ? 'points' : ['gomoku', 'platformer'].includes(dataset) ? 'total_score' : club ? 'published content' : dataset.endsWith('_versus') ? 'highest player score minus AI score' : 'high_score',
    limit: query.page_size, truncated: false, data: [], query: { order_by: query.order_by, direction: query.direction, page: query.page, page_size: query.page_size, filters }, has_more: null, returned_count: 0
  };
  let timestamp = new Date().toISOString();
  try { const now = options.now?.(); if (now !== undefined) timestamp = new Date(now).toISOString(); } catch { /* Use real observation time on invalid injected clock. */ }
  const envelope: LiveEnvelope = { status: 'unavailable', fetched_at: timestamp, results: [card] };
  const finish = (status: LiveStatus) => { envelope.status = card.status = status; return artFit(envelope, card); };
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), LIVE_TIMEOUT_MS);
  const abort = () => controller.abort(); options.signal?.addEventListener('abort', abort, { once: true });
  try {
    const base = new URL(options.projectUrl);
    if (base.href !== `https://${LIVE_PROJECT_HOST}/` || !artText(options.anonKey, 500) || club && !artText(options.memberToken, 8000)) throw new Error('options');
    const fetcher = options.fetch || globalThis.fetch, origin = base.origin;
    const anonHeaders = { apikey: options.anonKey, authorization: `Bearer ${options.anonKey}` };
    const post = (body: artRecord, authenticated = false) => artRead(fetcher, `${origin}/functions/v1/club-drive`, {
      method: 'POST', headers: { 'content-type': 'application/json', apikey: options.anonKey, ...(authenticated ? { authorization: `Bearer ${options.memberToken}` } : {}) }, body: JSON.stringify(body)
    }, controller.signal);
    const gatePayload = await post({ action: 'site_service_status' });
    const gate = Array.isArray(gatePayload) && gatePayload.length === 1 ? gatePayload[0] : gatePayload;
    if (!artIsRecord(gate) || typeof gate.enabled !== 'boolean' || !artIsRecord(gate.feature_settings)) throw new Error('gate');
    const feature = gate.feature_settings[dataset === 'member_points' ? 'points' : club ? 'events' : dataset.replace('_versus', '')];
    if (feature !== undefined && (!artIsRecord(feature) || typeof feature.enabled !== 'boolean')) throw new Error('gate');
    if (!gate.enabled || artIsRecord(feature) && feature.enabled === false) return finish('paused');
    if (dataset === 'platformer') {
      const payload = await artRead(fetcher, `${origin}/rest/v1/rpc/platformer_service_status`, { method: 'POST', headers: { ...anonHeaders, 'content-type': 'application/json' }, body: '{}' }, controller.signal);
      if (!Array.isArray(payload) || payload.length !== 1 || !artIsRecord(payload[0]) || typeof payload[0].enabled !== 'boolean') throw new Error('gate');
      if (!payload[0].enabled) return finish('paused');
    }
    let rows: unknown[], hasMore: boolean;
    if (club) {
      const payload = await post({ action: 'assistant_read_query', query }, true);
      if (!artIsRecord(payload) || !Array.isArray(payload.rows) || typeof payload.has_more !== 'boolean' || !artIsRecord(payload.query) || Object.keys(artValidateQuery(payload.query, true)).length !== Object.keys(query).length || Object.entries(query).some(([key, value]) => !artIsRecord(payload.query) || payload.query[key] !== value)) throw new Error('shape');
      if (payload.ambiguous === true && dataset === 'member_points' && query.member_name !== undefined && payload.rows.length === 0) return finish('ambiguous');
      if (Object.hasOwn(payload, 'ambiguous') && payload.ambiguous !== false) throw new Error('shape');
      if (payload.content_truncated !== undefined && typeof payload.content_truncated !== 'boolean') throw new Error('shape');
      card.truncated = payload.content_truncated === true;
      rows = payload.rows; hasMore = payload.has_more;
      if (rows.length > query.page_size) throw new Error('shape');
    } else {
      const payload = await artRead(fetcher, `${origin}/rest/v1/${artTables[dataset]}?${artParams(query)}`, { headers: anonHeaders }, controller.signal);
      if (!Array.isArray(payload) || payload.length > query.page_size + 1) throw new Error('shape'); rows = payload; hasMore = rows.length > query.page_size;
    }
    // Validate every upstream row, including the lookahead: never report partial malformed data as complete.
    const mapped = rows.map(row => artPublicRow(dataset, row));
    card.data = mapped.slice(0, query.page_size); card.has_more = hasMore; card.returned_count = card.data.length;
    card.truncated = card.truncated || hasMore || rows.some(row => artIsRecord(row) && typeof row.content === 'string' && row.content.length > 5000);
    return finish(card.data.length ? 'success' : 'empty');
  } catch {
    if (options.signal?.aborted) throw artAbort();
    card.data = []; card.returned_count = 0; card.has_more = null; return finish('unavailable');
  } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
}
