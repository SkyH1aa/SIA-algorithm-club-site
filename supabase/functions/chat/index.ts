type Json = Record<string, unknown>;
type AuthUser = { id: string; email?: string | null };
type Provider = {
  id: string;
  name: string;
  label: string;
  base_url: string;
  secret_name: string;
  auth_header: 'authorization' | 'x-api-key';
  enabled: boolean;
};
type Model = {
  id: string;
  provider_id: string;
  model_key: string;
  display_name: string;
  introduction: string | null;
  context_window: number;
  max_output_tokens: number;
  default_max_output_tokens: number;
  reasoning_efforts: unknown;
  default_reasoning_effort: string | null;
  supports_images: boolean;
  supports_pdf: boolean;
  preserve_reasoning: boolean;
  enabled: boolean;
};

type RequestContext = {
  user: AuthUser;
  isAdmin: boolean;
  profile: { username: string; member_name: string } | null;
};

const MAX_REQUEST_BYTES = 12 * 1024 * 1024;
const MAX_INPUT_ITEMS = 160;
const MAX_INPUT_TEXT = 1_000_000;
const MAX_CONTENT_PARTS = 5;
const MAX_ATTACHMENTS = 4;
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_REASONING_EFFORT = 40;
const IMAGE_TOKEN_ESTIMATE = { low: 1024, auto: 4096, high: 8192 };
const PDF_TOKEN_ESTIMATE = 8192;
const ACTIONS = new Set([
  'catalog', 'respond', 'admin_get', 'admin_save_provider', 'admin_save_model',
  'admin_usage', 'admin_test', 'quota', 'admin_quota_get', 'admin_quota_save',
  'admin_user_directory', 'admin_blacklist_list', 'admin_set_blacklist'
]);
const encoder = new TextEncoder();

function configuredOrigins(): Set<string> {
  return new Set((Deno.env.get('CHAT_CORS_ORIGINS') || '').split(',').map(x => x.trim()).filter(Boolean));
}

function corsHeaders(request: Request): Headers {
  const headers = new Headers({
    'access-control-allow-headers': 'authorization, apikey, content-type',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-expose-headers': 'X-Chat-Request-Id, X-Chat-Quota-Limited, X-Chat-Max-Output-Tokens',
    'access-control-max-age': '600',
    vary: 'Origin'
  });
  const origin = request.headers.get('origin');
  if (origin && configuredOrigins().has(origin)) headers.set('access-control-allow-origin', origin);
  return headers;
}

function json(request: Request, body: unknown, status = 200): Response {
  const headers = corsHeaders(request);
  headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(body), { status, headers });
}

function errorResponse(request: Request, code: string, status: number): Response {
  return json(request, { error: code }, status);
}

function requireConfig() {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('CLUB_SERVICE_ROLE_KEY');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !key || !anon) throw new Error('server_config');
  return { url: url.replace(/\/$/, ''), key, anon };
}

function authToken(request: Request): string | null {
  const raw = request.headers.get('authorization') || '';
  const match = raw.match(/^Bearer ([A-Za-z0-9._~+/=-]+)$/);
  return match?.[1] || null;
}

async function verifyBearer(request: Request): Promise<AuthUser> {
  const token = authToken(request);
  if (!token) throw new HttpError('login', 401);
  const { url, anon } = requireConfig();
  const response = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anon, authorization: `Bearer ${token}` },
    redirect: 'error'
  });
  if (!response.ok) throw new HttpError('login', 401);
  const user = await response.json().catch(() => null) as Partial<AuthUser> | null;
  if (!user?.id || !isUuid(user.id)) throw new HttpError('login', 401);
  return { id: user.id, email: typeof user.email === 'string' ? user.email : null };
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function rest(path: string, init: RequestInit = {}): Promise<Response> {
  const { url, key } = requireConfig();
  return fetch(`${url}/rest/v1/${path}`, {
    ...init,
    redirect: 'error',
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      ...(init.headers || {})
    }
  });
}

async function restJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await rest(path, init);
  if (!response.ok) throw new HttpError('database', 503);
  return await response.json() as T;
}

async function rpc(name: string, body: Json): Promise<unknown> {
  const response = await rest(`rpc/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new HttpError('database', 503);
  return await response.json().catch(() => null);
}

class HttpError extends Error {
  status: number;
  constructor(code: string, status: number) { super(code); this.name = 'HttpError'; this.status = status; }
}

async function getProfile(userId: string) {
  const rows = await restJson<Array<{ username: string; member_name: string }>>(
    `club_member_profiles?user_id=eq.${encodeURIComponent(userId)}&select=username,member_name&limit=1`
  );
  return rows[0] || null;
}

async function isDynamicSuperAdmin(userId: string): Promise<boolean> {
  const rows = await restJson<Array<{ user_id: string }>>(
    `club_super_admins?user_id=eq.${encodeURIComponent(userId)}&select=user_id&limit=1`
  );
  return rows.length === 1;
}

async function context(request: Request, admin = false): Promise<RequestContext> {
  const user = await verifyBearer(request);
  const isAdmin = admin ? await isDynamicSuperAdmin(user.id) : false;
  if (admin && !isAdmin) throw new HttpError('admin', 403);
  const profile = await getProfile(user.id);
  if (!admin && !profile) throw new HttpError('profile', 403);
  return { user, isAdmin, profile };
}

function text(value: unknown, max: number, required = false): string | null {
  if (typeof value !== 'string') {
    if (required) throw new HttpError('input', 400);
    return null;
  }
  const result = value.trim();
  if (required && !result) throw new HttpError('input', 400);
  if (result.length > max) throw new HttpError('input', 400);
  return result || null;
}

function integer(value: unknown, min: number, max: number, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) throw new HttpError('input', 400);
  return value as number;
}

function allowKeys(value: Json, keys: string[]) {
  const allowed = new Set(keys);
  if (Object.keys(value).some(key => !allowed.has(key))) throw new HttpError('input', 400);
}

function object(value: unknown): Json {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError('input', 400);
  return value as Json;
}

function boolean(value: unknown, fallback = false): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new HttpError('input', 400);
  return value;
}

function validateModel(model: Model) {
  const context = integer(model.context_window, 256, 1_000_000);
  const max = integer(model.max_output_tokens, 1, Math.min(131072, context));
  integer(model.default_max_output_tokens, 1, max);
  const efforts = model.reasoning_efforts;
  if (!Array.isArray(efforts) || efforts.length > 12 || new Set(efforts).size !== efforts.length ||
    efforts.some(x => typeof x !== 'string' || !/^[a-z][a-z0-9_-]{0,39}$/.test(x)) ||
    (model.default_reasoning_effort !== null && !efforts.includes(model.default_reasoning_effort))) throw new HttpError('input', 400);
  for (const key of ['supports_images', 'supports_pdf', 'preserve_reasoning', 'enabled'] as const) boolean(model[key]);
}

function isPublicIp(value: string): boolean {
  const ipv4 = value.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4) {
    const [a, b, c, d] = ipv4.slice(1).map(Number);
    if ([a, b, c, d].some(x => !Number.isInteger(x) || x < 0 || x > 255)) return false;
    return !(a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113) || a >= 224);
  }
  const sections = value.toLowerCase().split('::');
  if (!value.includes(':') || sections.length > 2) return false;
  const left = sections[0] ? sections[0].split(':') : [];
  const right = sections[1] ? sections[1].split(':') : [];
  const words = [...left, ...right];
  if (words.some(word => !/^[0-9a-f]{1,4}$/.test(word))) return false;
  if ((sections.length === 1 && words.length !== 8) || (sections.length === 2 && words.length >= 8)) return false;
  const expanded = [...left, ...Array(sections.length === 2 ? 8 - words.length : 0).fill('0'), ...right].map(x => parseInt(x, 16));
  // Accept global unicast only; exclude special-purpose, documentation and 6to4 ranges.
  const [first, second] = expanded;
  return first >= 0x2000 && first <= 0x3fff && !(first === 0x2001 && (second <= 0x01ff || second === 0x0db8)) &&
    first !== 0x2002 && !(first === 0x3fff && second <= 0x0fff);
}

async function publicHttpsUrl(value: unknown): Promise<string> {
  const raw = text(value, 2048, true)!;
  let url: URL;
  try { url = new URL(raw); } catch { throw new HttpError('provider_url', 400); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.port && url.port !== '443') ||
    !host || host.endsWith('.') || host.includes(':') || !host.includes('.') ||
    /(^|\.)(localhost|local|internal|test|invalid)$|(^|\.)home\.arpa$/i.test(host)) throw new HttpError('provider_url', 400);
  const path = url.pathname.replace(/\/+$/, '');
  if (/(^|\/)responses$/i.test(path)) throw new HttpError('provider_url', 400);
  if (/^[\d.]+$/.test(host)) {
    if (!isPublicIp(host)) throw new HttpError('provider_url', 400);
  } else {
    if (typeof Deno.resolveDns !== 'function') throw new HttpError('provider_url', 400);
    const results = await Promise.allSettled([Deno.resolveDns(host, 'A'), Deno.resolveDns(host, 'AAAA')]);
    const addresses: string[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled') addresses.push(...result.value);
      // An absent record family is normal for A-only/AAAA-only hosts. Timeouts,
      // permissions and resolver failures must not silently bypass validation.
      else if (!(result.reason instanceof Deno.errors.NotFound)) throw new HttpError('provider_url', 400);
    }
    if (!addresses.length || addresses.some(address => !isPublicIp(address))) throw new HttpError('provider_url', 400);
  }
  return `${url.origin}${path}`;
}

function secretName(value: unknown): string {
  const name = text(value, 90, true)!;
  if (!/^CHAT_KEY_[A-Z0-9_]{1,80}$/.test(name)) throw new HttpError('secret_name', 400);
  if (!Deno.env.get(name)) throw new HttpError('secret_missing', 503);
  return name;
}

function base64Bytes(value: string): number {
  const comma = value.indexOf(',');
  if (comma < 0) throw new HttpError('input', 400);
  const encoded = value.slice(comma + 1);
  if (!encoded || encoded.length % 4 !== 0) throw new HttpError('input', 400);
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  const bytes = Math.floor(encoded.length * 3 / 4) - padding;
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > MAX_ATTACHMENT_BYTES) throw new HttpError('file', 413);
  return bytes;
}

function validPdfFilename(value: string): boolean {
  if (!/^[^/\\]{1,156}\.pdf$/i.test(value)) return false;
  for (const character of value) if (character.charCodeAt(0) < 0x20) return false;
  return true;
}

function estimateInputTokens(input: Json[]): number {
  let tokens = 0;
  for (const raw of input) {
    const item = object(raw);
    if (item.type === 'reasoning') {
      tokens += Math.ceil(encoder.encode(String(item.encrypted_content || '')).byteLength / 3);
      continue;
    }
    if (!Array.isArray(item.content)) continue;
    for (const rawPart of item.content) {
      const part = object(rawPart);
      if (part.type === 'input_text' || part.type === 'output_text') {
        tokens += Math.ceil(encoder.encode(String(part.text || '')).byteLength / 3);
      } else if (part.type === 'input_image') {
        tokens += IMAGE_TOKEN_ESTIMATE[String(part.detail || 'auto') as keyof typeof IMAGE_TOKEN_ESTIMATE] || IMAGE_TOKEN_ESTIMATE.auto;
      } else if (part.type === 'input_file') {
        tokens += PDF_TOKEN_ESTIMATE;
      }
    }
  }
  return tokens;
}

function validateInput(input: unknown, model: Model): { input: Json[]; inputBytes: number } {
  if (!Array.isArray(input) || input.length < 1 || input.length > MAX_INPUT_ITEMS) throw new HttpError('input', 400);
  let textBytes = 0, attachmentBytes = 0;
  const countText = (value: unknown) => {
    if (typeof value !== 'string' || !value.length || value.length > MAX_INPUT_TEXT) throw new HttpError('input', 400);
    textBytes += encoder.encode(value).byteLength;
  };
  for (const item of input) {
    let turnAttachments = 0;
    const record = object(item);
    if (record.type === 'reasoning') {
      allowKeys(record, ['type', 'encrypted_content', 'summary']);
      if (!model.preserve_reasoning || !Array.isArray(record.summary) || record.summary.length !== 0) throw new HttpError('input', 400);
      countText(record.encrypted_content);
      continue;
    }
    allowKeys(record, ['type', 'role', 'content', 'status']);
    const role = record.role;
    if (!['user', 'assistant', 'system', 'developer'].includes(String(role)) ||
      (record.type !== undefined && record.type !== 'message') ||
      (record.status !== undefined && (role !== 'assistant' || record.status !== 'completed')) ||
      !Array.isArray(record.content) || record.content.length < 1 || record.content.length > MAX_CONTENT_PARTS) throw new HttpError('input', 400);
    for (const part of record.content) {
      const value = object(part);
      if (value.type === 'input_text' || value.type === 'output_text') {
        allowKeys(value, value.type === 'input_text' ? ['type', 'text'] : ['type', 'text', 'annotations']);
        if ((value.type === 'output_text') !== (role === 'assistant') ||
          (value.annotations !== undefined && (!Array.isArray(value.annotations) || value.annotations.length))) throw new HttpError('input', 400);
        countText(value.text);
      } else if (value.type === 'input_image') {
        allowKeys(value, ['type', 'image_url', 'detail']);
        if (role !== 'user' || !model.supports_images || typeof value.image_url !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value.image_url)) throw new HttpError('file', 400);
        if (value.detail !== undefined && !['auto', 'low', 'high'].includes(String(value.detail))) throw new HttpError('input', 400);
        if (++turnAttachments > MAX_ATTACHMENTS) throw new HttpError('file', 400);
        attachmentBytes += base64Bytes(value.image_url);
      } else if (value.type === 'input_file') {
        allowKeys(value, ['type', 'filename', 'file_data']);
        if (role !== 'user' || !model.supports_pdf || typeof value.filename !== 'string' || !validPdfFilename(value.filename) || typeof value.file_data !== 'string' || !/^data:application\/pdf;base64,[A-Za-z0-9+/]+={0,2}$/.test(value.file_data)) throw new HttpError('file', 400);
        if (++turnAttachments > MAX_ATTACHMENTS) throw new HttpError('file', 400);
        attachmentBytes += base64Bytes(value.file_data);
      } else throw new HttpError('input', 400);
    }
  }
  if (attachmentBytes > MAX_REQUEST_BYTES || textBytes > MAX_REQUEST_BYTES) throw new HttpError('input', 413);
  const serialized = encoder.encode(JSON.stringify(input)).byteLength;
  if (serialized > MAX_REQUEST_BYTES) throw new HttpError('request_too_large', 413);
  return { input: input as Json[], inputBytes: serialized };
}

async function providers(): Promise<Provider[]> {
  return await restJson<Provider[]>('chat_providers?select=id,name,label,base_url,secret_name,auth_header,enabled&order=name.asc');
}

async function models(): Promise<Model[]> {
  return await restJson<Model[]>('chat_models?select=id,provider_id,model_key,display_name,introduction,context_window,max_output_tokens,default_max_output_tokens,reasoning_efforts,default_reasoning_effort,supports_images,supports_pdf,preserve_reasoning,enabled&order=display_name.asc');
}

function catalogPayload(items: Model[], providerRows: Provider[]) {
  const enabledProviders = new Set(providerRows.filter(x => x.enabled).map(x => x.id));
  return items.filter(x => x.enabled && enabledProviders.has(x.provider_id)).map(x => ({
    id: x.id, display_name: x.display_name, introduction: x.introduction || null, context_window: x.context_window,
    max_output_tokens: x.max_output_tokens, default_max_output_tokens: x.default_max_output_tokens,
    reasoning_efforts: Array.isArray(x.reasoning_efforts) ? x.reasoning_efforts : [],
    default_reasoning_effort: x.default_reasoning_effort, supports_images: x.supports_images,
    supports_pdf: x.supports_pdf, preserve_reasoning: x.preserve_reasoning
  }));
}

async function modelWithProvider(modelId: unknown, enabledOnly = true): Promise<{ model: Model; provider: Provider }> {
  if (!isUuid(modelId)) throw new HttpError('model', 400);
  const [modelRows, providerRows] = await Promise.all([
    restJson<Model[]>(`chat_models?id=eq.${encodeURIComponent(modelId)}&select=id,provider_id,model_key,display_name,introduction,context_window,max_output_tokens,default_max_output_tokens,reasoning_efforts,default_reasoning_effort,supports_images,supports_pdf,preserve_reasoning,enabled&limit=1`),
    providers()
  ]);
  const model = modelRows[0];
  const provider = model && providerRows.find(x => x.id === model.provider_id);
  if (!model || !provider || (enabledOnly && (!model.enabled || !provider.enabled))) throw new HttpError('model', 400);
  validateModel(model);
  provider.base_url = await publicHttpsUrl(provider.base_url);
  secretName(provider.secret_name);
  return { model, provider };
}

async function saveProvider(payload: Json) {
  const id = payload.id == null ? undefined : payload.id;
  if (id !== undefined && !isUuid(id)) throw new HttpError('input', 400);
  const body = {
    ...(id ? { id } : {}),
    name: text(payload.name, 80, true),
    label: text(payload.label, 120) || '',
    base_url: await publicHttpsUrl(payload.base_url),
    secret_name: secretName(payload.secret_name),
    auth_header: payload.auth_header === undefined ? 'authorization' : payload.auth_header === 'x-api-key' ? 'x-api-key' : payload.auth_header === 'authorization' ? 'authorization' : (() => { throw new HttpError('input', 400); })(),
    enabled: payload.enabled === undefined ? true : boolean(payload.enabled, true),
    updated_at: new Date().toISOString()
  };
  const rows = await restJson<Provider[]>('chat_providers?on_conflict=id', { method: 'POST', headers: { 'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify(body) });
  return rows[0] ? { id: rows[0].id, name: rows[0].name, label: rows[0].label, base_url: rows[0].base_url, secret_name: rows[0].secret_name, auth_header: rows[0].auth_header, enabled: rows[0].enabled } : null;
}

async function saveModel(payload: Json) {
  const id = payload.id == null ? undefined : payload.id;
  if (id !== undefined && !isUuid(id)) throw new HttpError('input', 400);
  if (!isUuid(payload.provider_id)) throw new HttpError('input', 400);
  const modelKey = text(payload.model_key ?? payload.model_id, 160, true)!;
  const displayName = text(payload.display_name, 120, true)!;
  const introduction = payload.introduction == null ? null : text(payload.introduction, 1000, true);
  const max = integer(payload.max_output_tokens, 1, 131072);
  const defaultMax = integer(payload.default_max_output_tokens, 1, max);
  const efforts = payload.reasoning_efforts === undefined ? [] : payload.reasoning_efforts;
  if (!Array.isArray(efforts) || efforts.length > 12 || efforts.some(x => typeof x !== 'string' || x.length < 1 || x.length > MAX_REASONING_EFFORT)) throw new HttpError('input', 400);
  const body = {
    ...(id ? { id } : {}), provider_id: payload.provider_id, model_key: modelKey, display_name: displayName, introduction,
    context_window: integer(payload.context_window, 256, 1000000), max_output_tokens: max,
    default_max_output_tokens: defaultMax, reasoning_efforts: efforts,
    default_reasoning_effort: payload.default_reasoning_effort == null ? null : text(payload.default_reasoning_effort, MAX_REASONING_EFFORT, true),
    supports_images: boolean(payload.supports_images), supports_pdf: boolean(payload.supports_pdf),
    preserve_reasoning: boolean(payload.preserve_reasoning), enabled: payload.enabled === undefined ? true : boolean(payload.enabled, true),
    updated_at: new Date().toISOString()
  };
  validateModel(body as Model);
  const providerRows = await providers();
  if (!providerRows.some(x => x.id === body.provider_id)) throw new HttpError('input', 400);
  const rows = await restJson<Model[]>('chat_models?on_conflict=id', { method: 'POST', headers: { 'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify(body) });
  return rows[0] || null;
}

function quotaUserId(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (!isUuid(value)) throw new HttpError('input', 400);
  return value;
}

function quotaLimit(value: unknown): number | null {
  return value === null ? null : integer(value, 0, 1_000_000_000_000);
}

async function quotaSnapshot(userId: string | null): Promise<Json> {
  const result = await rpc('chat_quota_get', { p_user_id: userId });
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new HttpError('database', 503);
  return result as Json;
}

async function quotaAdmin(ctx: RequestContext, action: string, payload: Json): Promise<unknown> {
  if (action === 'admin_quota_get') return await quotaSnapshot(quotaUserId(payload.user_id));
  if (action === 'admin_quota_save') {
    const userId = quotaUserId(payload.user_id);
    const daily = quotaLimit(payload.daily_limit);
    const weekly = quotaLimit(userId === null && payload.weekly_limit === undefined ? null : payload.weekly_limit);
    const monthly = quotaLimit(userId === null && payload.monthly_limit === undefined ? null : payload.monthly_limit);
    if (userId === null && (weekly !== null || monthly !== null)) throw new HttpError('input', 400);
    const result = await rpc('chat_quota_save', {
      p_actor_user_id: ctx.user.id, p_user_id: userId, p_daily_limit: daily,
      p_weekly_limit: weekly, p_monthly_limit: monthly,
      p_expected_version: integer(payload.expected_version, 0, Number.MAX_SAFE_INTEGER)
    });
    if ((result as Json | null)?.code === 'conflict') throw new HttpError('conflict', 409);
    if (!result) throw new HttpError('database', 503);
    return result;
  }
  if (action === 'admin_set_blacklist') {
    if (!isUuid(payload.user_id) || typeof payload.blocked !== 'boolean' ||
      (payload.reason !== undefined && typeof payload.reason !== 'string')) throw new HttpError('input', 400);
    return await rpc('chat_blacklist_set', {
      p_actor_user_id: ctx.user.id, p_user_id: payload.user_id, p_blocked: payload.blocked,
      p_reason: text(payload.reason, 1000) || null
    });
  }
  const directory = await rpc('chat_user_directory', { p_actor_user_id: ctx.user.id }) as Json | null;
  if (!directory || !Array.isArray(directory.users) || !Array.isArray(directory.blacklist)) throw new HttpError('database', 503);
  return action === 'admin_blacklist_list' ? { blacklist: directory.blacklist } : directory;
}

async function finishGeneration(requestId: string, patch: Json, refund = false) {
  const result = await rpc('chat_finish_generation', {
    p_request_id: requestId, p_patch: { ...patch, finished_at: new Date().toISOString() }, p_refund: refund
  });
  if (result === false || result === null || (result as Json)?.code) throw new HttpError('database', 503);
}

async function updateUsage(requestId: string, patch: Json) {
  const response = await rest(`chat_usage?request_id=eq.${encodeURIComponent(requestId)}&status=in.(audited,upstream_started)`, { method: 'PATCH', headers: { 'content-type': 'application/json', prefer: 'return=representation' }, body: JSON.stringify(patch) });
  if (!response.ok) throw new HttpError('database', 503);
  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length !== 1) throw new HttpError('database', 503);
}

function upstreamHeaders(provider: Provider, key: string): Headers {
  const headers = new Headers({ accept: 'text/event-stream', 'content-type': 'application/json' });
  headers.set(provider.auth_header, provider.auth_header === 'authorization' ? `Bearer ${key}` : key);
  return headers;
}

async function callResponses(request: Request, ctx: RequestContext, payload: Json, test = false): Promise<Response> {
  const { model, provider } = await modelWithProvider(payload.model_id);
  const rawInput = test ? [{ role: 'user', content: [{ type: 'input_text', text: text(payload.prompt, MAX_INPUT_TEXT, true) }] }] : payload.input;
  const { input } = validateInput(rawInput, model);
  if (!test && payload.max_output_tokens !== undefined) integer(payload.max_output_tokens, 1, model.max_output_tokens);
  const outputTokens = test
    ? integer(payload.max_output_tokens, 1, model.max_output_tokens, model.default_max_output_tokens)
    : model.default_max_output_tokens;
  const effort = payload.reasoning_effort == null ? model.default_reasoning_effort : text(payload.reasoning_effort, MAX_REASONING_EFFORT, true);
  if (effort !== null && !(model.reasoning_efforts as string[]).includes(effort)) throw new HttpError('effort', 400);
  const requestId = crypto.randomUUID();
  const body = { model: model.model_key, input, reasoning: effort ? { effort } : undefined, include: model.preserve_reasoning ? ['reasoning.encrypted_content'] : undefined, max_output_tokens: outputTokens, store: false, stream: true };
  let serialized = JSON.stringify(body);
  const inputTokens = estimateInputTokens(input);
  if (inputTokens + outputTokens > model.context_window) throw new HttpError('context', 413);
  if (encoder.encode(serialized).byteLength > MAX_REQUEST_BYTES) throw new HttpError('request_too_large', 413);
  // Reservations use estimates, not a hard guarantee about provider billing (especially files).
  const admission = await rpc('chat_begin_generation', {
    p_user_id: ctx.user.id, p_request_id: requestId, p_input_tokens: inputTokens, p_output_tokens: outputTokens,
    p_audit: { member_name: ctx.profile?.member_name || null, username: ctx.profile?.username || ctx.user.email || ctx.user.id,
      provider_name: provider.label || provider.name, model_name: model.display_name, action: test ? 'admin_test' : 'respond',
      provider_id: provider.id, model_id: model.id, model_key: model.model_key,
      input_bytes: encoder.encode(serialized).byteLength, max_output_tokens: outputTokens, reasoning_effort: effort, status: 'audited' }
  }) as Json | null;
  if (!admission || typeof admission.allowed !== 'boolean') throw new HttpError('database', 503);
  if (!admission.allowed) {
    if (admission.code === 'quota' || admission.code === 'quota_exceeded') return json(request, { error: 'quota', quota: admission.quota }, 429);
    if (admission.code === 'busy') throw new HttpError('busy', 409);
    if (admission.code === 'blacklisted') throw new HttpError('blacklisted', 403);
    throw new HttpError('database', 503);
  }
  if (!Number.isInteger(admission.max_output_tokens) || (admission.max_output_tokens as number) < 1 ||
    (admission.max_output_tokens as number) > outputTokens) {
    await finishGeneration(requestId, { status: 'failed', error_code: 'database' }, true);
    throw new HttpError('database', 503);
  }
  body.max_output_tokens = admission.max_output_tokens as number;
  serialized = JSON.stringify(body);
  if (request.signal.aborted) {
    await finishGeneration(requestId, { status: 'cancelled', error_code: 'client_cancelled' }, true);
    throw new HttpError('cancelled', 499);
  }
  try {
    // Persist the transition before fetch. Any later uncertainty retains reservation.
    await updateUsage(requestId, { status: 'upstream_started' });
  } catch (error) {
    await finishGeneration(requestId, { status: 'failed', error_code: 'database' }).catch(() => undefined);
    throw error;
  }
  const upstreamController = new AbortController();
  const cancelUpstream = () => upstreamController.abort();
  request.signal.addEventListener('abort', cancelUpstream, { once: true });
  if (request.signal.aborted) upstreamController.abort();
  let upstream: Response;
  try {
    upstream = await fetch(`${provider.base_url}/responses`, { method: 'POST', headers: upstreamHeaders(provider, Deno.env.get(provider.secret_name)!), body: serialized, redirect: 'error', signal: upstreamController.signal });
  } catch {
    request.signal.removeEventListener('abort', cancelUpstream);
    await finishGeneration(requestId, { status: request.signal.aborted ? 'cancelled' : 'failed', error_code: request.signal.aborted ? 'client_cancelled' : 'upstream_network' }).catch(() => undefined);
    throw new HttpError(request.signal.aborted ? 'cancelled' : 'upstream', request.signal.aborted ? 499 : 502);
  }
  if (!upstream.ok || !upstream.body || !/^text\/event-stream(?:\s*;|$)/i.test(upstream.headers.get('content-type') || '')) {
    request.signal.removeEventListener('abort', cancelUpstream);
    upstreamController.abort();
    await finishGeneration(requestId, { status: 'failed', upstream_status: upstream.status, error_code: 'upstream_http' }).catch(() => undefined);
    throw new HttpError('upstream', 502);
  }
  try {
    await updateUsage(requestId, { status: 'upstream_started', upstream_status: upstream.status });
  } catch (error) {
    request.signal.removeEventListener('abort', cancelUpstream);
    upstreamController.abort();
    await upstream.body.cancel().catch(() => undefined);
    await finishGeneration(requestId, { status: 'failed', error_code: 'database' }).catch(() => undefined);
    throw error;
  }
  request.signal.removeEventListener('abort', cancelUpstream);
  const response = proxyStream(request, upstream.body, upstreamController, requestId);
  if (body.max_output_tokens < outputTokens) response.headers.set('x-chat-quota-limited', 'true');
  response.headers.set('x-chat-max-output-tokens', String(body.max_output_tokens));
  return response;
}

function parseSse(onEvent: (event: Json) => void) {
  let buffer = '', data: string[] = [], eventName = '', eventBytes = 0;
  const dispatch = () => {
    if (!data.length) { data = []; eventName = ''; eventBytes = 0; return; }
    const raw = data.join('\n');
    if (raw !== '[DONE]') {
      const event = object(JSON.parse(raw));
      if (event.type === undefined && eventName) event.type = eventName;
      onEvent(event);
    }
    data = []; eventName = ''; eventBytes = 0;
  };
  const line = (value: string) => {
    if (!value) return dispatch();
    if (value.startsWith(':')) return;
    const index = value.indexOf(':');
    const field = index < 0 ? value : value.slice(0, index);
    let content = index < 0 ? '' : value.slice(index + 1);
    if (content.startsWith(' ')) content = content.slice(1);
    if (field === 'event') eventName = content;
    if (field === 'data') { data.push(content); eventBytes += content.length + 1; }
    if (eventBytes > 16 * 1024 * 1024) throw new Error('stream_limit');
  };
  return (chunk: string, eof = false) => {
    buffer += chunk;
    if (buffer.length + eventBytes > 16 * 1024 * 1024) throw new Error('stream_limit');
    let start = 0;
    for (let index = 0; index < buffer.length; index++) {
      if (buffer[index] !== '\r' && buffer[index] !== '\n') continue;
      if (buffer[index] === '\r' && index === buffer.length - 1 && !eof) break;
      line(buffer.slice(start, index));
      if (buffer[index] === '\r' && buffer[index + 1] === '\n') index++;
      start = index + 1;
    }
    buffer = buffer.slice(start);
    // SSE does not dispatch an incomplete event at EOF; this avoids inventing a
    // successful response when an upstream disconnects before its blank line.
    if (eof) { buffer = ''; data = []; eventName = ''; eventBytes = 0; }
  };
}

function terminalUsage(event: Json): Json | null {
  const type = String(event.type || '');
  if (!['response.completed', 'response.incomplete', 'response.failed', 'error'].includes(type)) return null;
  const source = event.response && typeof event.response === 'object' ? event.response as Json : event;
  const usage = source.usage && typeof source.usage === 'object' ? source.usage as Json : {};
  const token = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0 ? value : null;
  return { status: type === 'response.completed' ? 'completed' : type === 'response.incomplete' ? 'incomplete' : 'failed', input_tokens: token(usage.input_tokens), output_tokens: token(usage.output_tokens), total_tokens: token(usage.total_tokens), error_code: type === 'response.completed' ? null : type };
}

function proxyStream(request: Request, body: ReadableStream<Uint8Array>, upstream: AbortController, requestId: string): Response {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let terminal: Json | null = null, cancelled = false;
  let finishing: Promise<void> | null = null;
  const parser = parseSse(event => { terminal ||= terminalUsage(event); });
  const finish = (patch: Json): Promise<void> => {
    if (finishing) return finishing;
    request.signal.removeEventListener('abort', onAbort);
    finishing = finishGeneration(requestId, patch);
    return finishing;
  };
  const cancel = async () => {
    cancelled = true;
    upstream.abort();
    await reader.cancel().catch(() => undefined);
    await finish(terminal || { status: 'cancelled', error_code: 'client_cancelled' });
  };
  let downstream: ReadableStreamDefaultController<Uint8Array>;
  const onAbort = () => {
    void cancel().then(() => downstream.error(new Error('cancelled')), () => downstream.error(new Error('database')));
  };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      downstream = controller;
      request.signal.addEventListener('abort', onAbort, { once: true });
      if (request.signal.aborted) onAbort();
    },
    async pull(controller) {
      try {
        const next = await reader.read();
        if (cancelled) return;
        parser(next.done ? decoder.decode() : decoder.decode(next.value, { stream: true }), next.done);
        if (next.done || terminal) {
          // Persist the terminal metadata before exposing success to the client.
          await finish(terminal || { status: 'interrupted', error_code: 'upstream_eof' });
          upstream.abort();
          await reader.cancel().catch(() => undefined);
          if (cancelled) return;
          if (!next.done) controller.enqueue(next.value);
          controller.close();
        } else controller.enqueue(next.value);
      } catch {
        upstream.abort();
        await reader.cancel().catch(() => undefined);
        await finish(terminal || { status: cancelled ? 'cancelled' : 'failed', error_code: cancelled ? 'client_cancelled' : 'stream' }).catch(() => undefined);
        if (!cancelled) controller.error(new Error('stream'));
      }
    },
    cancel
  });
  const headers = corsHeaders(request);
  headers.set('content-type', 'text/event-stream; charset=utf-8');
  headers.set('cache-control', 'no-cache, no-transform');
  headers.set('x-chat-request-id', requestId);
  return new Response(stream, { status: 200, headers });
}

async function adminGet(request: Request) {
  await context(request, true);
  const [providerRows, modelRows] = await Promise.all([providers(), models()]);
  return { providers: providerRows.map(x => ({ id: x.id, name: x.name, label: x.label, base_url: x.base_url, secret_name: x.secret_name, auth_header: x.auth_header, enabled: x.enabled })), models: modelRows.map(x => ({ ...x, model_id: x.model_key })) };
}

function isoFilter(value: unknown): string | null {
  if (value == null || value === '') return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new HttpError('input', 400);
  return parsed.toISOString();
}

async function adminUsage(request: Request, payload: Json) {
  await context(request, true);
  const page = integer(payload.page, 1, 100000, 1);
  const limit = integer(payload.pageSize ?? payload.limit, 1, 200, 50);
  const from = isoFilter(payload.from);
  const to = isoFilter(payload.to);
  if (from && to && from > to) throw new HttpError('input', 400);
  const filters = [
    from ? `started_at=gte.${encodeURIComponent(from)}` : '',
    to ? `started_at=lte.${encodeURIComponent(to)}` : ''
  ].filter(Boolean);
  const offset = (page - 1) * limit;
  const query = [
    'select=request_id,user_id,member_name,username,model_key,model_name,provider_name,action,input_bytes,max_output_tokens,reasoning_effort,status,upstream_status,input_tokens,output_tokens,total_tokens,error_code,started_at,finished_at',
    'order=started_at.desc', `limit=${limit}`, `offset=${offset}`
  ];
  const response = await rest(`chat_usage?${[...filters, ...query].join('&')}`, { headers: { prefer: 'count=exact' } });
  if (!response.ok) throw new HttpError('database', 503);
  const range = response.headers.get('content-range')?.match(/^(?:\d+-\d+|\*)\/(\d+)$/);
  if (!range) throw new HttpError('database', 503);
  const total = Number(range[1]);
  if (!Number.isSafeInteger(total)) throw new HttpError('database', 503);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new HttpError('database', 503);
  return { usage: rows, page, pageSize: limit, total };
}

async function main(request: Request, payload: Json): Promise<Response> {
  const action = ({ save_provider: 'admin_save_provider', save_model: 'admin_save_model', usage: 'admin_usage', test: 'admin_test' } as Record<string, string>)[String(payload.action)] || payload.action;
  if (typeof action !== 'string' || !ACTIONS.has(action)) throw new HttpError('action', 400);
  const allowed: Record<string, string[]> = {
    catalog: [], quota: [], admin_quota_get: ['user_id'],
    admin_quota_save: ['user_id', 'daily_limit', 'weekly_limit', 'monthly_limit', 'expected_version'],
    admin_user_directory: [], admin_blacklist_list: [], admin_set_blacklist: ['user_id', 'blocked', 'reason'],
    admin_get: [], respond: ['model_id', 'input', 'max_output_tokens', 'reasoning_effort'],
    admin_test: ['model_id', 'prompt', 'max_output_tokens', 'reasoning_effort'],
    admin_usage: ['page', 'pageSize', 'limit', 'from', 'to'],
    admin_save_provider: ['id', 'name', 'label', 'base_url', 'secret_name', 'auth_header', 'enabled'],
    admin_save_model: ['id', 'provider_id', 'model_key', 'model_id', 'display_name', 'introduction', 'context_window', 'max_output_tokens', 'default_max_output_tokens', 'reasoning_efforts', 'default_reasoning_effort', 'supports_images', 'supports_pdf', 'preserve_reasoning', 'enabled']
  };
  allowKeys(payload, ['action', ...allowed[action]]);
  if (action === 'admin_get') return json(request, await adminGet(request));
  if (action === 'admin_save_provider') return json(request, { provider: await saveProviderAfterAuth(request, payload) });
  if (action === 'admin_save_model') return json(request, { model: await saveModelAfterAuth(request, payload) });
  if (action === 'admin_usage') return json(request, await adminUsage(request, payload));
  if (action === 'quota') return json(request, await quotaSnapshot((await context(request)).user.id));
  if (['admin_quota_get', 'admin_quota_save', 'admin_user_directory', 'admin_blacklist_list', 'admin_set_blacklist'].includes(action)) {
    return json(request, await quotaAdmin(await context(request, true), action, payload));
  }
  if (action === 'catalog') {
    const ctx = await context(request);
    const quota = await quotaSnapshot(ctx.user.id);
    if (quota.blacklisted === true) throw new HttpError('blacklisted', 403);
    const [all, providerRows] = await Promise.all([models(), providers()]);
    return json(request, { models: catalogPayload(all, providerRows), bound: Boolean(ctx.profile), member_name: ctx.profile?.member_name || null, quota });
  }
  if (action === 'respond') return await callResponses(request, await context(request), payload);
  if (action === 'admin_test') return await callResponses(request, await context(request, true), payload, true);
  throw new HttpError('action', 400);
}

async function saveProviderAfterAuth(request: Request, payload: Json) {
  await context(request, true);
  return saveProvider(payload);
}

async function saveModelAfterAuth(request: Request, payload: Json) {
  await context(request, true);
  return saveModel(payload);
}

async function handle(request: Request): Promise<Response> {
  const origin = request.headers.get('origin');
  if (origin && !configuredOrigins().has(origin)) return errorResponse(request, 'cors', 403);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request) });
  if (request.method !== 'POST') return errorResponse(request, 'method', 405);
  const length = Number(request.headers.get('content-length') || 0);
  if (length > MAX_REQUEST_BYTES) return errorResponse(request, 'request_too_large', 413);
  try {
    const raw = await request.text();
    if (encoder.encode(raw).byteLength > MAX_REQUEST_BYTES) throw new HttpError('request_too_large', 413);
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { throw new HttpError('input', 400); }
    return await main(request, object(parsed));
  } catch (error) {
    if (error instanceof HttpError) return errorResponse(request, error.message, error.status);
    return errorResponse(request, 'server', 500);
  }
}

export const handler = handle;

if (typeof Deno.serve === 'function' && !Deno.env.get('CHAT_TEST_MODE')) Deno.serve(handle);
