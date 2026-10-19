import { AssistantError, assistantConfigData, assistantDocument, assistantInput, assistantPrompt, assistantPlanPrompt, assistantPlanAnswerPrompt, assistantToolSource, type AssistantRelease } from '../_shared/chat-assistant.ts';
import { ASSISTANT_READ_TOOLS, executeAssistantReadTool } from '../_shared/chat-assistant-tools.ts';
import { assistantPlanBudget, runAssistantPlan, AssistantPlanError } from '../_shared/chat-assistant-plan.ts';
import { hashKey, newKey, proxyBase, proxySecret, ProxyError, ROUTE_FIELDS } from '../_shared/chat-api-proxy.ts';
import { ChatBodyError, readChatBody } from '../_shared/chat-body.ts';
import { chatEndpoint, ChatProtocolError, parseProtocolSse, protocolEvents, protocolRequest, normalizeClaudeThinking, validateProtocolCapabilities, type ChatProtocol, type ChatProtocolSetting } from '../_shared/chat-protocol.ts';

type Json = Record<string, unknown>;
type AuthUser = { id: string; email?: string | null };
type Provider = {
  id: string;
  name: string;
  label: string;
  base_url: string;
  api_protocol: ChatProtocolSetting;
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
  claude_thinking?: unknown;
  supports_images: boolean;
  supports_pdf: boolean;
  preserve_reasoning: boolean;
  enabled: boolean;
  visibility: 'all' | 'assigned';
  updated_at?: string;
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
  'assistant_catalog', 'assistant_respond', 'assistant_compact',
  'assistant_admin_get', 'assistant_admin_config_save', 'assistant_admin_document_save', 'assistant_admin_document_archive',
  'assistant_admin_publish', 'assistant_admin_rollback', 'assistant_admin_import',
  'catalog', 'respond', 'admin_get', 'admin_save_provider', 'admin_save_model',
  'admin_delete_provider', 'admin_delete_model',
  'admin_usage', 'admin_test', 'quota', 'admin_quota_get', 'admin_quota_save',
  'admin_user_directory', 'admin_blacklist_list', 'admin_set_blacklist',
  'admin_model_access_get', 'admin_model_access_save',
  'custom_model_list', 'custom_model_save', 'custom_model_delete',
  'admin_proxy_list', 'admin_proxy_save', 'admin_proxy_route_state', 'admin_proxy_route_delete', 'admin_proxy_route_hard_delete',
  'admin_proxy_key_create', 'admin_proxy_key_state', 'admin_proxy_key_hard_delete'
]);
const encoder = new TextEncoder();

function configuredOrigins(): Set<string> {
  return new Set((Deno.env.get('CHAT_CORS_ORIGINS') || '').split(',').map(x => x.trim()).filter(Boolean));
}

// 本地用 file:// 打开页面时浏览器发送的 Origin 是字面量 "null"。
// 这是 CORS 层放行，不是授权：请求仍必须携带有效成员 JWT 与超管身份，
// 因此不会因为放行 null 而让匿名请求获得任何能力。
// 可用 CHAT_CORS_ALLOW_FILE=true 显式开启，默认关闭，线上保持严格白名单。
function allowsFileOrigin(): boolean {
  return String(Deno.env.get('CHAT_CORS_ALLOW_FILE') || '').toLowerCase() === 'true';
}

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  if (origin === 'null') return allowsFileOrigin();
  return configuredOrigins().has(origin);
}

function corsHeaders(request: Request): Headers {
  const headers = new Headers({
    'access-control-allow-headers': 'authorization, apikey, content-type',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-expose-headers': 'X-Chat-Request-Id, X-Chat-Quota-Limited, X-Chat-Max-Output-Tokens, X-Chat-Assistant-Sources, X-Chat-Assistant-Release',
    'access-control-max-age': '600',
    vary: 'Origin'
  });
  const origin = request.headers.get('origin');
  if (isAllowedOrigin(origin)) headers.set('access-control-allow-origin', origin === 'null' ? 'null' : origin!);
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

// Chat 管理权限与 SQL chat_quota_assert_admin 一致：仅信任动态 user_id 名单。
// 名单为空、缺失或读取失败均关闭权限；初始管理员邮箱不构成授权。
async function isDynamicSuperAdmin(userId: string): Promise<boolean> {
  try {
    const rows = await restJson<Array<{ user_id: string }>>(
      `club_super_admins?user_id=eq.${encodeURIComponent(userId)}&select=user_id&limit=1`
    );
    return Array.isArray(rows) && rows.length === 1 && rows[0]?.user_id === userId;
  } catch (_error) {
    return false;
  }
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
  return await restJson<Provider[]>('chat_providers?deleted_at=is.null&select=id,name,label,base_url,api_protocol,secret_name,auth_header,enabled&order=name.asc');
}

async function models(): Promise<Model[]> {
  return await restJson<Model[]>('chat_models?deleted_at=is.null&select=id,provider_id,model_key,display_name,introduction,context_window,max_output_tokens,default_max_output_tokens,reasoning_efforts,default_reasoning_effort,claude_thinking,supports_images,supports_pdf,preserve_reasoning,enabled,visibility,updated_at&order=display_name.asc');
}

async function modelAccess(modelId: string, userId: string): Promise<boolean> {
  const rows = await restJson<Array<{ visibility: string }>>(
    `chat_models?id=eq.${encodeURIComponent(modelId)}&select=visibility&limit=1`
  );
  if (!rows[0]) return false;
  if (rows[0].visibility !== 'assigned') return true;
  const grants = await restJson<Array<{ user_id: string }>>(
    `chat_model_access?model_id=eq.${encodeURIComponent(modelId)}&user_id=eq.${encodeURIComponent(userId)}&select=user_id&limit=1`
  );
  return grants.length === 1;
}

function modelVisible(item: Model, userId: string, granted: Set<string>): boolean {
  return item.visibility !== 'assigned' || granted.has(item.id);
}

async function visibleModelIds(items: Model[], userId: string): Promise<Set<string>> {
  const assigned = items.filter(x => x.visibility === 'assigned').map(x => x.id);
  if (!assigned.length) return new Set(items.map(x => x.id));
  const rows = await restJson<Array<{ model_id: string }>>(
    `chat_model_access?user_id=eq.${encodeURIComponent(userId)}&model_id=in.(${assigned.map(encodeURIComponent).join(',')})&select=model_id`
  );
  return new Set(items.filter(x => x.visibility !== 'assigned').map(x => x.id).concat(rows.map(x => x.model_id)));
}

function effectiveReasoning(model: Model, protocol: ChatProtocol) {
  const config = normalizeClaudeThinking(model.claude_thinking, model.default_max_output_tokens);
  return {
    claude_thinking: config,
    reasoning_efforts: protocol === 'messages' ? config.mode === 'adaptive' ? config.efforts : [] : Array.isArray(model.reasoning_efforts) ? model.reasoning_efforts as string[] : [],
    default_reasoning_effort: protocol === 'messages' ? config.mode === 'adaptive' ? config.default_effort : null : model.default_reasoning_effort
  };
}

async function catalogPayload(items: Model[], providerRows: Provider[], userId: string) {
  const enabledProviders = new Map(providerRows.filter(x => x.enabled).map(x => [x.id, x]));
  const visible = await visibleModelIds(items, userId);
  return items.filter(x => x.enabled && enabledProviders.has(x.provider_id) && visible.has(x.id)).map(x => {
    const provider = enabledProviders.get(x.provider_id)!;
    const protocol = chatEndpoint(provider.base_url, provider.api_protocol).protocol;
    return {
      id: x.id, display_name: x.display_name, introduction: x.introduction || null, context_window: x.context_window,
      max_output_tokens: x.max_output_tokens, default_max_output_tokens: x.default_max_output_tokens,
      api_protocol: protocol, ...effectiveReasoning(x, protocol), supports_images: x.supports_images,
      supports_pdf: x.supports_pdf, preserve_reasoning: x.preserve_reasoning
    };
  });
}

async function modelWithProvider(modelId: unknown, enabledOnly = true, userId?: string, admin = false): Promise<{ model: Model; provider: Provider }> {
  if (!isUuid(modelId)) throw new HttpError('model', 400);
  const [modelRows, providerRows] = await Promise.all([
    restJson<Model[]>(`chat_models?id=eq.${encodeURIComponent(modelId)}&deleted_at=is.null&select=id,provider_id,model_key,display_name,introduction,context_window,max_output_tokens,default_max_output_tokens,reasoning_efforts,default_reasoning_effort,claude_thinking,supports_images,supports_pdf,preserve_reasoning,enabled,visibility&limit=1`),
    providers()
  ]);
  const model = modelRows[0];
  const provider = model && providerRows.find(x => x.id === model.provider_id);
  if (!model || !provider || (enabledOnly && (!model.enabled || !provider.enabled))) throw new HttpError('model', 400);
  if (!admin && userId && !(await modelAccess(model.id, userId))) throw new HttpError('model', 403);
  validateModel(model);
  provider.base_url = await publicHttpsUrl(provider.base_url);
  validateProtocolCapabilities(chatEndpoint(provider.base_url, provider.api_protocol).protocol, model, model.claude_thinking);
  secretName(provider.secret_name);
  return { model, provider };
}

async function saveProvider(payload: Json) {
  const id = payload.id == null ? undefined : payload.id;
  if (id !== undefined && !isUuid(id)) throw new HttpError('input', 400);
  let apiProtocol: ChatProtocolSetting = 'auto';
  if (Object.prototype.hasOwnProperty.call(payload, 'api_protocol')) {
    if (payload.api_protocol !== 'auto' && payload.api_protocol !== 'responses' && payload.api_protocol !== 'messages' && payload.api_protocol !== 'chat') throw new HttpError('api_protocol', 400);
    apiProtocol = payload.api_protocol;
  } else if (id) {
    const existing = await restJson<Array<Pick<Provider, 'api_protocol'>>>(`chat_providers?id=eq.${encodeURIComponent(id)}&deleted_at=is.null&select=api_protocol&limit=1`);
    apiProtocol = existing[0]?.api_protocol ?? 'auto';
  }
  const body = {
    ...(id ? { id } : {}),
    api_protocol: apiProtocol,
    name: text(payload.name, 80, true),
    label: text(payload.label, 120) || '',
    base_url: await publicHttpsUrl(payload.base_url),
    secret_name: secretName(payload.secret_name),
    auth_header: payload.auth_header === undefined ? 'authorization' : payload.auth_header === 'x-api-key' ? 'x-api-key' : payload.auth_header === 'authorization' ? 'authorization' : (() => { throw new HttpError('input', 400); })(),
    enabled: payload.enabled === undefined ? true : boolean(payload.enabled, true),
    updated_at: new Date().toISOString()
  };
  if (id) {
    const attached = await restJson<Model[]>(`chat_models?provider_id=eq.${encodeURIComponent(String(id))}&deleted_at=is.null&select=preserve_reasoning,reasoning_efforts,default_max_output_tokens,claude_thinking`);
    for (const model of attached) validateProtocolCapabilities(chatEndpoint(body.base_url, body.api_protocol).protocol, model, model.claude_thinking);
  }
  const rows = await restJson<Provider[]>('chat_providers?on_conflict=id', { method: 'POST', headers: { 'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify(body) });
  return rows[0] ? { id: rows[0].id, name: rows[0].name, label: rows[0].label, base_url: rows[0].base_url, api_protocol: rows[0].api_protocol, secret_name: rows[0].secret_name, auth_header: rows[0].auth_header, enabled: rows[0].enabled } : null;
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
  let visibility: 'all' | 'assigned' = 'all';
  let claudeThinking = payload.claude_thinking;
  if (id && (payload.visibility === undefined || payload.claude_thinking === undefined)) {
    const existing = await restJson<Array<{ visibility?: string; claude_thinking?: unknown }>>(`chat_models?id=eq.${encodeURIComponent(id)}&select=visibility,claude_thinking&limit=1`);
    const value = existing[0]?.visibility;
    if (value === 'all' || value === 'assigned') visibility = value;
    if (payload.claude_thinking === undefined) claudeThinking = existing[0]?.claude_thinking;
  }
  if (payload.visibility !== undefined) visibility = payload.visibility as 'all' | 'assigned';
  const body = {
    ...(id ? { id } : {}), provider_id: payload.provider_id, model_key: modelKey, display_name: displayName, introduction,
    context_window: integer(payload.context_window, 256, 1000000), max_output_tokens: max,
    default_max_output_tokens: defaultMax, claude_thinking: normalizeClaudeThinking(claudeThinking, defaultMax), reasoning_efforts: efforts,
    default_reasoning_effort: payload.default_reasoning_effort == null ? null : text(payload.default_reasoning_effort, MAX_REASONING_EFFORT, true),
    supports_images: boolean(payload.supports_images), supports_pdf: boolean(payload.supports_pdf),
    preserve_reasoning: boolean(payload.preserve_reasoning), enabled: payload.enabled === undefined ? true : boolean(payload.enabled, true),
    visibility,
    updated_at: new Date().toISOString()
  };
  if (body.visibility !== 'all' && body.visibility !== 'assigned') throw new HttpError('input', 400);
  validateModel(body as Model);
  const providerRows = await providers();
  const provider = providerRows.find(x => x.id === body.provider_id);
  if (!provider) throw new HttpError('input', 400);
  const protocol = chatEndpoint(provider.base_url, provider.api_protocol).protocol;
  validateProtocolCapabilities(protocol, body, body.claude_thinking);
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

async function updateUsage(requestId: string, patch: Json, signal?: AbortSignal) {
  const response = await rest(`chat_usage?request_id=eq.${encodeURIComponent(requestId)}&status=in.(audited,upstream_started)`, { method: 'PATCH', headers: { 'content-type': 'application/json', prefer: 'return=representation' }, body: JSON.stringify(patch), signal });
  if (!response.ok) throw new HttpError('database', 503);
  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length !== 1) throw new HttpError('database', 503);
}

function upstreamHeaders(provider: Provider, key: string): Headers {
  const headers = new Headers({ accept: 'text/event-stream', 'content-type': 'application/json' });
  headers.set(provider.auth_header, provider.auth_header === 'authorization' ? `Bearer ${key}` : key);
  if (chatEndpoint(provider.base_url, provider.api_protocol).protocol === 'messages') headers.set('anthropic-version', '2023-06-01');
  return headers;
}

type DeferredAssistant = {
  reserveTokens: number;
  prepare: (signal: AbortSignal) => Promise<{ input: Json[]; sources: Json[] }>;
};

async function callResponses(request: Request, ctx: RequestContext, payload: Json, test = false, selected?: { model: Model; provider: Provider }, auditAction?: 'assistant_respond' | 'assistant_compact', deferred?: DeferredAssistant): Promise<Response> {
  const { model, provider } = selected || await modelWithProvider(payload.model_id, true, ctx.user.id, test && ctx.isAdmin);
  const rawInput = test ? [{ role: 'user', content: [{ type: 'input_text', text: text(payload.prompt, MAX_INPUT_TEXT, true) }] }] : payload.input;
  const { input: initialInput } = validateInput(rawInput, model);
  let input = initialInput;
  if (!test && payload.max_output_tokens !== undefined) integer(payload.max_output_tokens, 1, model.max_output_tokens);
  const outputTokens = test
    ? integer(payload.max_output_tokens, 1, model.max_output_tokens, model.default_max_output_tokens)
    : model.default_max_output_tokens;
  const { protocol, url: endpoint } = chatEndpoint(provider.base_url, provider.api_protocol);
  const effective = effectiveReasoning(model, protocol);
  if (protocol === 'messages' && payload.reasoning_effort != null && typeof payload.reasoning_effort !== 'string') throw new HttpError('claude_effort', 400);
  const effort = payload.reasoning_effort == null ? effective.default_reasoning_effort : protocol === 'messages' ? payload.reasoning_effort as string : text(payload.reasoning_effort, MAX_REASONING_EFFORT, true);
  if (effort !== null && !effective.reasoning_efforts.includes(effort)) throw new HttpError(protocol === 'messages' ? 'claude_effort' : 'effort', 400);
  const requestId = crypto.randomUUID();
  const body: Json = { model: model.model_key, input, reasoning: effort ? { effort } : undefined, include: model.preserve_reasoning ? ['reasoning.encrypted_content'] : undefined, max_output_tokens: outputTokens, store: false, stream: true };
  let serialized = JSON.stringify(protocolRequest(protocol, body, model.claude_thinking));
  const baseInputTokens = estimateInputTokens(input);
  const reservedInputTokens = baseInputTokens + (deferred?.reserveTokens || 0);
  if (reservedInputTokens + outputTokens > model.context_window) throw new HttpError('context', 413);
  if (encoder.encode(serialized).byteLength > MAX_REQUEST_BYTES) throw new HttpError('request_too_large', 413);
  // Reservations use estimates, including the bounded hidden assistant/live budget.
  const admission = await rpc('chat_begin_generation', {
    p_user_id: ctx.user.id, p_request_id: requestId, p_input_tokens: reservedInputTokens, p_output_tokens: outputTokens,
    p_audit: { member_name: ctx.profile?.member_name || null, username: ctx.profile?.username || ctx.user.email || ctx.user.id,
      provider_name: provider.label || provider.name, model_name: model.display_name, action: auditAction || (test ? 'admin_test' : 'respond'),
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
  try {
    if (deferred) {
      if (request.signal.aborted) throw new HttpError('cancelled', 499);
      const prepared = await deferred.prepare(request.signal);
      if (!Array.isArray(prepared.input) || !Array.isArray(prepared.sources)) throw new Error('assistant_prepare');
      input = prepared.input;
      validateInput(input, model);
      body.input = input;
      if (request.signal.aborted) throw new HttpError('cancelled', 499);
    }
    serialized = JSON.stringify(protocolRequest(protocol, body, model.claude_thinking));
    const finalInputTokens = estimateInputTokens(input);
    if (finalInputTokens + Number(body.max_output_tokens) > model.context_window) throw new HttpError('context', 413);
    if (encoder.encode(serialized).byteLength > MAX_REQUEST_BYTES) throw new HttpError('request_too_large', 413);
    if (deferred && finalInputTokens > reservedInputTokens) throw new HttpError('context', 413);
    if (deferred) await updateUsage(requestId, { input_bytes: encoder.encode(serialized).byteLength });
  } catch (error) {
    // Deferred live reads and all final validation happen after admission. Before
    // dispatch, every such failure is refunded and the lease is released.
    const cancelled = (error instanceof HttpError && error.message === 'cancelled') ||
      (error instanceof DOMException && error.name === 'AbortError') || request.signal.aborted;
    await finishGeneration(requestId, {
      status: cancelled ? 'cancelled' : 'failed',
      error_code: cancelled ? 'client_cancelled' : error instanceof HttpError ? error.message : error instanceof ChatProtocolError ? error.message : 'assistant_prepare'
    }, true);
    if (cancelled) throw new HttpError('cancelled', 499);
    throw error;
  }
  if (request.signal.aborted) {
    await finishGeneration(requestId, { status: 'cancelled', error_code: 'client_cancelled' }, true);
    throw new HttpError('cancelled', 499);
  }
  try {
    // Persist the transition before fetch. A failed marker may be refunded only
    // when the database still proves that no upstream request started.
    await updateUsage(requestId, { status: 'upstream_started' });
  } catch (error) {
    await finishGeneration(requestId, { status: 'failed', error_code: 'database' }, true).catch(() => undefined);
    throw error;
  }
  const upstreamController = new AbortController();
  const cancelUpstream = () => upstreamController.abort();
  request.signal.addEventListener('abort', cancelUpstream, { once: true });
  if (request.signal.aborted) upstreamController.abort();
  let upstream: Response;
  try {
    upstream = await fetch(endpoint, { method: 'POST', headers: upstreamHeaders(provider, Deno.env.get(provider.secret_name)!), body: serialized, redirect: 'error', signal: upstreamController.signal });
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
  const response = proxyStream(request, upstream.body, upstreamController, requestId, protocol);
  if (Number(body.max_output_tokens) < outputTokens) response.headers.set('x-chat-quota-limited', 'true');
  response.headers.set('x-chat-max-output-tokens', String(body.max_output_tokens));
  return response;
}

async function callAssistantTools(request: Request, ctx: RequestContext, release: AssistantRelease, selected: { model: Model; provider: Provider }, safe: Json[]): Promise<Response> {
  const { model, provider } = selected;
  const { protocol, url: endpoint } = chatEndpoint(provider.base_url, provider.api_protocol);
  const prepared = assistantPlanPrompt(release, safe, ASSISTANT_READ_TOOLS);
  const input = prepared.input as Json[];
  validateInput(input, model);
  const baseTokens = estimateInputTokens(input);
  const budget = assistantPlanBudget(baseTokens);
  const outputTokens = model.default_max_output_tokens;
  if (budget.perTurnInputTokens + outputTokens > model.context_window) throw new HttpError('context', 413);
  const effective = effectiveReasoning(model, protocol);
  const effort = effective.default_reasoning_effort;
  const body: Json = { model: model.model_key, input, reasoning: effort ? { effort } : undefined,
    include: model.preserve_reasoning ? ['reasoning.encrypted_content'] : undefined,
    max_output_tokens: outputTokens, store: false, stream: true };
  // Both stages use ordinary model requests inside one admission.
  const initialBytes = encoder.encode(JSON.stringify(protocolRequest(protocol, body, model.claude_thinking))).byteLength;
  if (initialBytes > MAX_REQUEST_BYTES) throw new HttpError('request_too_large', 413);
  const requestId = crypto.randomUUID();
  const admission = await rpc('chat_begin_generation', {
    p_user_id: ctx.user.id, p_request_id: requestId,
    p_input_tokens: budget.reservedInputTokens, p_output_tokens: outputTokens,
    p_audit: { member_name: ctx.profile?.member_name || null, username: ctx.profile?.username || ctx.user.email || ctx.user.id,
      provider_name: provider.label || provider.name, model_name: model.display_name, action: 'assistant_respond',
      provider_id: provider.id, model_id: model.id, model_key: model.model_key,
      input_bytes: initialBytes, max_output_tokens: outputTokens, reasoning_effort: effort, status: 'audited' }
  }) as Json | null;
  if (!admission || typeof admission.allowed !== 'boolean') throw new HttpError('database', 503);
  if (!admission.allowed) {
    if (admission.code === 'quota' || admission.code === 'quota_exceeded') return json(request, { error: 'quota', quota: admission.quota }, 429);
    if (admission.code === 'busy') throw new HttpError('busy', 409);
    if (admission.code === 'blacklisted') throw new HttpError('blacklisted', 403);
    throw new HttpError('database', 503);
  }
  const sources: Json[] = [...prepared.sources] as Json[];
  let started = false, settled = false, inputBytes = 0;
  try {
    const maximum = admission.max_output_tokens;
    if (!Number.isInteger(maximum) || Number(maximum) < 1 || Number(maximum) > outputTokens) throw new HttpError('database', 503);
    const memberToken = authToken(request);
    if (!memberToken) throw new HttpError('login', 401);
    if (request.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const result = await runAssistantPlan({
      protocol, body, claudeThinking: model.claude_thinking,
      signal: request.signal, maxRequestBytes: MAX_REQUEST_BYTES,
      maxInputTokens: model.context_window - Number(maximum), outputBudget: Number(maximum),
      estimate: stageInput => {
        validateInput(stageInput, model);
        const tokens = estimateInputTokens(stageInput);
        if (tokens > budget.perTurnInputTokens) throw new AssistantPlanError('assistant_context');
        return tokens;
      },
      dispatch: async (serialized, signal) => {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        inputBytes += encoder.encode(serialized).byteLength;
        await updateUsage(requestId, { input_bytes: inputBytes }, signal);
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        if (!started) {
          await updateUsage(requestId, { status: 'upstream_started' }, signal);
          // The flag follows the persisted transition. If that PATCH failed,
          // the guarded outer settlement can refund a definitely unstarted call.
          started = true;
        }
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const response = await fetch(endpoint, { method: 'POST', headers: upstreamHeaders(provider, Deno.env.get(provider.secret_name)!),
          body: serialized, redirect: 'error', signal });
        if (signal.aborted) { void response.body?.cancel().catch(() => undefined); throw new DOMException('Aborted', 'AbortError'); }
        try { await updateUsage(requestId, { upstream_status: response.status }, signal); }
        catch (error) { void response.body?.cancel().catch(() => undefined); throw error; }
        return response;
      },
      execute: async (plan, signal) => {
        const evidence: Json[] = [];
        if (plan.action !== 'query') return evidence;
        for (const query of plan.queries) {
          const envelope = await executeAssistantReadTool(query.tool, query.arguments, {
            projectUrl: Deno.env.get('SUPABASE_URL') || '', anonKey: Deno.env.get('SUPABASE_ANON_KEY') || '',
            memberToken, signal
          });
          const citation = assistantToolSource(envelope, `S${sources.length + 1}`);
          if (!citation.source || sources.length >= 12 || encodeURIComponent(JSON.stringify([...sources, citation.source])).length >= 12000) {
            evidence.push({ status: 'unavailable', error: 'source_unavailable', data: [] });
          } else {
            sources.push(citation.source as Json);
            evidence.push(citation.result);
          }
        }
        return evidence;
      },
      answerInput: (plan, evidence) => assistantPlanAnswerPrompt(release, safe,
        { action: plan.action, ...(plan.action === 'clarify' ? { question: plan.question } : {}), evidence,
          static_references: JSON.parse(prepared.knowledge) }).input as Json[]
    });
    if (request.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const finalPatch = { status: result.status, ...result.usage,
      error_code: result.status === 'completed' ? null : `response.${result.status}` };
    try {
      await finishGeneration(requestId, finalPatch);
    } catch (error) {
      try { await finishGeneration(requestId, finalPatch); }
      catch { throw error; }
    }
    settled = true;
    const headers = corsHeaders(request);
    headers.set('content-type', 'text/event-stream; charset=utf-8');
    headers.set('cache-control', 'no-store, no-transform');
    headers.set('x-chat-request-id', requestId);
    headers.set('x-chat-max-output-tokens', String(maximum));
    if (Number(maximum) < outputTokens) headers.set('x-chat-quota-limited', 'true');
    headers.set('x-chat-assistant-release', release.id);
    headers.set('x-chat-assistant-sources', encodeURIComponent(JSON.stringify(sources)));
    const events = result.events.map(event => {
      if (!['response.completed', 'response.incomplete', 'response.failed'].includes(String(event.type))) return event;
      return { ...event, response: { ...object(event.response), usage: result.usage } };
    });
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
      controller.close();
    } });
    return new Response(stream, { status: 200, headers });
  } catch (error) {
    const cancelled = request.signal.aborted || error instanceof DOMException && error.name === 'AbortError';
    if (!settled) await finishGeneration(requestId, { status: cancelled ? 'cancelled' : 'failed',
      error_code: cancelled ? 'client_cancelled' : error instanceof HttpError || error instanceof AssistantPlanError || error instanceof ChatProtocolError ? error.message : 'assistant_plan_failed' }, !started).catch(() => undefined);
    if (cancelled) throw new HttpError('cancelled', 499);
    if (error instanceof HttpError || error instanceof ChatProtocolError) throw error;
    throw new HttpError('upstream', 502);
  }
}

function terminalUsage(event: Json): Json | null {
  const type = String(event.type || '');
  if (!['response.completed', 'response.incomplete', 'response.failed', 'error'].includes(type)) return null;
  const source = event.response && typeof event.response === 'object' ? event.response as Json : event;
  const usage = source.usage && typeof source.usage === 'object' ? source.usage as Json : {};
  const token = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0 ? value : null;
  return { status: type === 'response.completed' ? 'completed' : type === 'response.incomplete' ? 'incomplete' : 'failed', input_tokens: token(usage.input_tokens), output_tokens: token(usage.output_tokens), total_tokens: token(usage.total_tokens), error_code: type === 'response.completed' ? null : type };
}

function proxyStream(request: Request, body: ReadableStream<Uint8Array>, upstream: AbortController, requestId: string, protocol: ChatProtocol): Response {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let terminal: Json | null = null, cancelled = false;
  let finishing: Promise<void> | null = null;
  let converted: string[] = [];
  const adapter = protocolEvents(protocol, requestId, event => {
    if (terminal) return;
    terminal = terminalUsage(event);
    if (protocol !== 'responses') converted.push(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  });
  const parser = parseProtocolSse(adapter.event, adapter.done);
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
        while (true) {
          const next = await reader.read();
          if (cancelled) return;
          parser(next.done ? decoder.decode() : decoder.decode(next.value, { stream: true }), next.done);
          const data = protocol === 'responses' ? (next.done ? null : next.value) : (converted.length ? encoder.encode(converted.join('')) : null);
          converted = [];
          if (next.done || terminal) {
            // Persist the terminal metadata before exposing success to the client.
            await finish(terminal || { status: 'interrupted', error_code: 'upstream_eof' });
            upstream.abort();
            await reader.cancel().catch(() => undefined);
            if (cancelled) return;
            if (data) controller.enqueue(data);
            controller.close();
            return;
          } else if (data) { controller.enqueue(data); return; }
        }
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
  return {
    providers: providerRows.map(x => ({ id: x.id, name: x.name, label: x.label, base_url: x.base_url, api_protocol: x.api_protocol, secret_name: x.secret_name, auth_header: x.auth_header, enabled: x.enabled })),
    // version 与 chat_model_delete 的乐观并发校验一致（updated_at 毫秒）。
    models: modelRows.map(x => ({ ...x, model_id: x.model_key, version: x.updated_at ? Date.parse(x.updated_at) : 0 }))
  };
}

async function modelAccessAdmin(request: Request, action: string, payload: Json): Promise<Json> {
  const ctx = await context(request, true);
  if (!isUuid(payload.model_id)) throw new HttpError('input', 400);
  if (action === 'admin_model_access_get') {
    const result = object(await rpc('chat_model_access_get', { p_actor_user_id: ctx.user.id, p_model_id: payload.model_id }));
    return result;
  }
  if (payload.visibility !== 'all' && payload.visibility !== 'assigned') throw new HttpError('input', 400);
  if (!Array.isArray(payload.user_ids) || payload.user_ids.length > 10000 || payload.user_ids.some(x => !isUuid(x))) throw new HttpError('input', 400);
  const result = object(await rpc('chat_model_access_save', {
    p_actor_user_id: ctx.user.id, p_model_id: payload.model_id, p_visibility: payload.visibility,
    p_user_ids: payload.user_ids, p_expected_version: integer(payload.expected_version, 0, Number.MAX_SAFE_INTEGER)
  }));
  if (result.code === 'conflict') throw new HttpError('conflict', 409);
  return result;
}

function customProxyBase(value: unknown): string {
  const raw = text(value, 512, true)!;
  let url: URL;
  try { url = new URL(raw); } catch { throw new HttpError('proxy_url', 400); }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'jgezpvmlnhycxslqbwcx.supabase.co' || url.username || url.password || url.search || url.hash || url.port) throw new HttpError('proxy_url', 400);
  if (!/^\/functions\/v1\/chat-api-proxy\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?:\/v1)?(?:\/(?:responses|messages|message|chat\/completions))?\/?$/i.test(url.pathname)) throw new HttpError('proxy_url', 400);
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

async function customModelAdmin(request: Request, action: string, payload: Json): Promise<unknown> {
  const ctx = await context(request);
  if (action === 'custom_model_list') return await rpc('chat_custom_model_list', { p_user_id: ctx.user.id });
  if (!isUuid(payload.id)) throw new HttpError('input', 400);
  if (action === 'custom_model_delete') {
    const result = object(await rpc('chat_custom_model_delete', { p_user_id: ctx.user.id, p_id: payload.id, p_expected_version: integer(payload.expected_version, 0, Number.MAX_SAFE_INTEGER) }));
    if (result.code === 'conflict') throw new HttpError('conflict', 409);
    return result;
  }
  if (action === 'custom_model_save') {
    if (Object.prototype.hasOwnProperty.call(payload, 'api_key')) throw new HttpError('input', 400);
    if (payload.model_key !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/.test(String(payload.model_key).trim())) throw new HttpError('input', 400);
    const result = object(await rpc('chat_custom_model_save', {
      p_user_id: ctx.user.id, p_id: payload.id, p_display_name: text(payload.display_name, 120, true),
      p_model_key: text(payload.model_key, 160, true), p_base_url: customProxyBase(payload.base_url),
      p_expected_version: integer(payload.expected_version, 0, Number.MAX_SAFE_INTEGER)
    }));
    if (result.code === 'conflict') throw new HttpError('conflict', 409);
    return result;
  }
  throw new HttpError('action', 400);
}

function isoFilter(value: unknown): string | null {
  if (value == null || value === '') return null;
  // Date-only inputs mean UTC midnight; timestamps require an explicit zone.
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) throw new HttpError('input', 400);
  const parsed = new Date(value);
  const day = new Date(value.slice(0, 10));
  if (Number.isNaN(parsed.getTime()) || Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== value.slice(0, 10)) throw new HttpError('input', 400);
  return parsed.toISOString();
}

const USAGE_FIELDS = ['request_id', 'user_id', 'member_name', 'username', 'model_key', 'model_name', 'provider_name', 'action', 'input_bytes', 'max_output_tokens', 'reasoning_effort', 'status', 'upstream_status', 'input_tokens', 'output_tokens', 'total_tokens', 'error_code', 'started_at', 'finished_at'];

async function adminUsage(request: Request, payload: Json) {
  const ctx = await context(request, true);
  const page = integer(payload.page, 1, 100000, 1);
  const limit = integer(payload.pageSize ?? payload.limit, 1, 200, 50);
  const from = isoFilter(payload.from);
  const to = isoFilter(payload.to);
  if (from && to && from > to) throw new HttpError('input', 400);
  const raw = await rpc('chat_admin_usage', {
    p_actor_user_id: ctx.user.id, p_page: page, p_page_size: limit, p_from: from, p_to: to
  });
  const record = (value: unknown): value is Json => value !== null && typeof value === 'object' && !Array.isArray(value);
  const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
  if (!record(raw) || !Array.isArray(raw.usage) || raw.usage.length > limit || raw.usage.some(row => !record(row))
    || raw.page !== page || raw.pageSize !== limit || !count(raw.total) || !record(raw.summary)
    || !count(raw.summary.total_records) || raw.total > raw.summary.total_records
    || raw.usage.length > raw.total
    || typeof raw.summary.total_tokens !== 'string' || !/^(0|[1-9]\d*)$/.test(raw.summary.total_tokens)
    || typeof raw.window_start !== 'string' || typeof raw.window_end !== 'string'
    || !Number.isFinite(Date.parse(raw.window_start)) || !Number.isFinite(Date.parse(raw.window_end))
    || Date.parse(raw.window_end) - Date.parse(raw.window_start) !== 2160 * 60 * 60 * 1000) {
    throw new HttpError('database', 503);
  }
  return {
    usage: raw.usage.map(row => Object.fromEntries(USAGE_FIELDS.filter(key => key in row).map(key => [key, row[key]]))),
    page, pageSize: limit, total: raw.total,
    summary: { total_records: raw.summary.total_records, total_tokens: raw.summary.total_tokens },
    window_start: raw.window_start, window_end: raw.window_end
  };
}

async function proxyAdmin(request: Request, action: string, payload: Json): Promise<Response> {
  const ctx = await context(request, true);
  const data = { ...payload }; delete data.action;
  if (action !== 'admin_proxy_list') {
    if (action === 'admin_proxy_key_create') {
      if (!isUuid(data.route_id)) throw new HttpError('input', 400);
      data.label = text(data.label, 120, true);
    } else if (['admin_proxy_route_delete', 'admin_proxy_route_hard_delete', 'admin_proxy_key_hard_delete'].includes(action)) {
      if (!isUuid(data.id)) throw new HttpError('input', 400);
      data.expected_version = integer(data.expected_version, 1, Number.MAX_SAFE_INTEGER);
    } else {
      if (!(action === 'admin_proxy_save' && data.id === null) && !isUuid(data.id)) throw new HttpError('input', 400);
      data.expected_version = integer(data.expected_version, data.id === null ? 0 : 1, Number.MAX_SAFE_INTEGER);
      if (typeof data.enabled !== 'boolean') throw new HttpError('input', 400);
    }
    if (action === 'admin_proxy_save') {
      data.name = text(data.name, 80, true);
      data.base_url = await proxyBase(data.base_url);
      data.secret_name = proxySecret(data.secret_name);
    }
    if (action === 'admin_proxy_route_state' && data.enabled) {
      const rows = await restJson<Json[]>(`chat_proxy_routes?id=eq.${data.id}&select=${ROUTE_FIELDS}&limit=1`);
      if (!rows[0]) throw new HttpError('not_found', 404);
      await proxyBase(rows[0].base_url); proxySecret(rows[0].secret_name);
    }
    if (action === 'admin_proxy_key_state' && typeof data.revoked !== 'boolean') throw new HttpError('input', 400);
  }
  let apiKey: string | undefined;
  if (action === 'admin_proxy_key_create') {
    apiKey = newKey();
    Object.assign(data, { key_hash: await hashKey(apiKey), key_prefix: apiKey.slice(0, 12), key_last4: apiKey.slice(-4) });
  }
  const result = object(await rpc('chat_proxy_admin', { p_actor: ctx.user.id, p_action: action, p_data: data }));
  if (result.code) throw new HttpError(String(result.code), result.code === 'not_found' ? 404 : 409);
  const response = json(request, apiKey ? { ...result, api_key: apiKey } : result);
  response.headers.set('cache-control', 'no-store');
  return response;
}

async function assistantRuntime(userId: string) {
  const runtime = await rpc('chat_assistant_runtime', {}) as { enabled?: boolean; release?: AssistantRelease } | null;
  const release = runtime?.release;
  if (runtime?.enabled !== true || !release?.id || !isUuid(release.id) || !release.config || !isUuid(release.config.model_id) ||
    !Array.isArray(release.documents) || release.documents.length > 200) throw new HttpError('assistant_unavailable', 503);
  let selected: { model: Model; provider: Provider };
  try {
    selected = await modelWithProvider(release.config.model_id, true, userId);
    if (selected.model.visibility !== 'all') throw new Error('assistant_model');
  } catch { throw new HttpError('assistant_unavailable', 503); }
  return { release, selected };
}

function assistantCatalogReserve(release: AssistantRelease): number {
  const planningTokens = estimateInputTokens(assistantPlanPrompt(release, [], ASSISTANT_READ_TOOLS).input as Json[]);
  return assistantPlanBudget(planningTokens + 4000).perTurnInputTokens;
}

async function assistantAction(request: Request, action: string, payload: Json): Promise<Response> {
  const ctx = await context(request);
  const quota = await quotaSnapshot(ctx.user.id);
  if (quota.blacklisted === true) throw new HttpError('blacklisted', 403);
  const { release, selected } = await assistantRuntime(ctx.user.id);
  if (action === 'assistant_catalog') {
    const response = json(request, { models: await catalogPayload([selected.model], [selected.provider], ctx.user.id),
      assistant: { welcome: release.config.welcome, suggestions: release.config.suggestions,
        release_id: release.id, reserve_tokens: assistantCatalogReserve(release) }, bound: true, member_name: ctx.profile!.member_name, quota });
    response.headers.set('cache-control', 'no-store');
    return response;
  }
  const safe = assistantInput(payload.input, payload.summary);
  validateInput(safe, selected.model);
  if (action === 'assistant_compact') {
    const prepared = assistantPrompt(release, safe, true);
    const response = await callResponses(request, ctx, { input: prepared.input }, false, selected, 'assistant_compact');
    response.headers.set('x-chat-assistant-sources', encodeURIComponent(JSON.stringify(prepared.sources)));
    response.headers.set('x-chat-assistant-release', release.id);
    response.headers.set('cache-control', 'no-store');
    return response;
  }
  return await callAssistantTools(request, ctx, release, selected, safe as Json[]);
}

async function assistantAdmin(request: Request, action: string, payload: Json): Promise<Response> {
  const ctx = await context(request, true);
  const data: Json = { ...payload }; delete data.action;
  if (action !== 'assistant_admin_get') data.expected_version = integer(data.expected_version, 0, Number.MAX_SAFE_INTEGER);
  if (action === 'assistant_admin_config_save') {
    Object.assign(data, assistantConfigData(data));
    if (data.model_id !== null) {
      if (!isUuid(data.model_id)) throw new HttpError('input', 400);
      const selected = await modelWithProvider(data.model_id, true, ctx.user.id, true);
      if (selected.model.visibility !== 'all') throw new HttpError('assistant_model', 400);
    } else if (data.enabled) throw new HttpError('assistant_model', 400);
  }
  if (action === 'assistant_admin_document_save') data.document = assistantDocument(data.document);
  if (action === 'assistant_admin_document_archive') {
    if (typeof data.slug !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(data.slug)) throw new HttpError('input', 400);
  }
  if (action === 'assistant_admin_rollback' && !isUuid(data.release_id)) throw new HttpError('input', 400);
  if (action === 'assistant_admin_import') {
    if (!Array.isArray(data.documents) || data.documents.length < 1 || data.documents.length > 200) throw new HttpError('input', 400);
    data.documents = data.documents.map(assistantDocument);
    if (new Set((data.documents as Array<{slug:string}>).map(x => x.slug)).size !== (data.documents as unknown[]).length) throw new HttpError('input', 400);
  }
  const response = await rest('rpc/chat_assistant_admin', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ p_actor_user_id: ctx.user.id, p_action: action, p_data: data }) });
  const result = await response.json().catch(() => null) as Json | null;
  if (!response.ok) {
    if (result?.code === '42501') throw new HttpError('admin', 403);
    if (['22023','22P02','23514','23502'].includes(String(result?.code))) throw new HttpError('input', 400);
    throw new HttpError('database', 503);
  }
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new HttpError('database', 503);
  if (result.code) throw new HttpError(String(result.code), result.code === 'conflict' ? 409 : result.code === 'not_found' ? 404 : 400);
  const output = json(request, result); output.headers.set('cache-control', 'no-store'); return output;
}

async function main(request: Request, payload: Json): Promise<Response> {
  const action = ({ save_provider: 'admin_save_provider', save_model: 'admin_save_model', usage: 'admin_usage', test: 'admin_test' } as Record<string, string>)[String(payload.action)] || payload.action;
  if (typeof action !== 'string' || !ACTIONS.has(action)) throw new HttpError('action', 400);
  const allowed: Record<string, string[]> = {
    assistant_catalog: [], assistant_respond: ['input','summary'], assistant_compact: ['input','summary'],
    assistant_admin_get: [],
    assistant_admin_config_save: ['expected_version','enabled','model_id','system_prompt','welcome','suggestions'],
    assistant_admin_document_save: ['expected_version','document'],
    assistant_admin_document_archive: ['expected_version','slug'],
    assistant_admin_publish: ['expected_version'], assistant_admin_rollback: ['expected_version','release_id'],
    assistant_admin_import: ['expected_version','documents'],
    admin_proxy_list: [],
    admin_proxy_save: ['id', 'name', 'base_url', 'secret_name', 'enabled', 'expected_version'],
    admin_proxy_route_state: ['id', 'enabled', 'expected_version'],
    admin_proxy_route_delete: ['id', 'expected_version'],
    admin_proxy_route_hard_delete: ['id', 'expected_version'],
    admin_proxy_key_hard_delete: ['id', 'expected_version'],
    admin_proxy_key_create: ['route_id', 'label'],
    admin_proxy_key_state: ['id', 'enabled', 'revoked', 'expected_version'],
    catalog: [], quota: [], admin_quota_get: ['user_id'],
    admin_quota_save: ['user_id', 'daily_limit', 'weekly_limit', 'monthly_limit', 'expected_version'],
    admin_user_directory: [], admin_blacklist_list: [], admin_set_blacklist: ['user_id', 'blocked', 'reason'],
    admin_get: [], respond: ['model_id', 'input', 'max_output_tokens', 'reasoning_effort'],
    admin_test: ['model_id', 'prompt', 'max_output_tokens', 'reasoning_effort'],
    admin_usage: ['page', 'pageSize', 'limit', 'from', 'to'],
    admin_save_provider: ['id', 'name', 'label', 'base_url', 'api_protocol', 'secret_name', 'auth_header', 'enabled'],
    admin_save_model: ['id', 'provider_id', 'model_key', 'model_id', 'display_name', 'introduction', 'context_window', 'max_output_tokens', 'default_max_output_tokens', 'reasoning_efforts', 'default_reasoning_effort', 'claude_thinking', 'supports_images', 'supports_pdf', 'preserve_reasoning', 'enabled', 'visibility'],
    admin_delete_provider: ['id'],
    admin_delete_model: ['id', 'expected_version'],
    admin_model_access_get: ['model_id'],
    admin_model_access_save: ['model_id', 'visibility', 'user_ids', 'expected_version'],
    custom_model_list: [],
    custom_model_save: ['id', 'display_name', 'model_key', 'base_url', 'expected_version'],
    custom_model_delete: ['id', 'expected_version']
  };
  allowKeys(payload, ['action', ...allowed[action]]);
  if (action.startsWith('assistant_admin_')) return await assistantAdmin(request, action, payload);
  if (action.startsWith('assistant_')) return await assistantAction(request, action, payload);
  if (action.startsWith('admin_proxy_')) return await proxyAdmin(request, action, payload);
  if (action === 'admin_model_access_get' || action === 'admin_model_access_save') return json(request, await modelAccessAdmin(request, action, payload));
  if (action.startsWith('custom_model_')) return json(request, await customModelAdmin(request, action, payload));
  if (action === 'admin_get') return json(request, await adminGet(request));
  if (action === 'admin_save_provider') return json(request, { provider: await saveProviderAfterAuth(request, payload) });
  if (action === 'admin_save_model') return json(request, { model: await saveModelAfterAuth(request, payload) });
  if (action === 'admin_delete_provider') return json(request, { result: await deleteProviderAfterAuth(request, payload) });
  if (action === 'admin_delete_model') return json(request, { result: await deleteModelAfterAuth(request, payload) });
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
    return json(request, { models: await catalogPayload(all, providerRows, ctx.user.id), bound: Boolean(ctx.profile), member_name: ctx.profile?.member_name || null, quota });
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

/* 删除是墓碑操作，由 SQL 函数完成，这里只做参数校验与错误映射。 */
function deletedResult(result: Json): Json {
  const code = (result as { code?: unknown }).code;
  if (code === 'conflict') throw new HttpError('conflict', 409);
  if (code === 'not_found') throw new HttpError('not_found', 404);
  if (code === 'deleted') throw new HttpError('deleted', 409);
  return result;
}

async function deleteProviderAfterAuth(request: Request, payload: Json) {
  const ctx = await context(request, true);
  if (!isUuid(payload.id)) throw new HttpError('input', 400);
  return deletedResult(object(await rpc('chat_provider_delete', { p_actor_user_id: ctx.user.id, p_provider_id: payload.id })));
}

async function deleteModelAfterAuth(request: Request, payload: Json) {
  const ctx = await context(request, true);
  if (!isUuid(payload.id)) throw new HttpError('input', 400);
  return deletedResult(object(await rpc('chat_model_delete', {
    p_actor_user_id: ctx.user.id, p_model_id: payload.id,
    p_expected_version: integer(payload.expected_version, 0, Number.MAX_SAFE_INTEGER)
  })));
}

async function handle(request: Request): Promise<Response> {
  const origin = request.headers.get('origin');
  if (origin && !isAllowedOrigin(origin)) return errorResponse(request, 'cors', 403);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request) });
  if (request.method !== 'POST') return errorResponse(request, 'method', 405);
  try {
    const bytes = await readChatBody(request, { maxBytes: MAX_REQUEST_BYTES, timeoutMs: 10000 });
    let parsed: unknown;
    try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw new HttpError('input', 400); }
    return await main(request, object(parsed));
  } catch (error) {
    if (error instanceof ChatBodyError) return errorResponse(request, error.code, error.status);
    if (error instanceof AssistantError) return errorResponse(request, error.message, error.status);
    if (error instanceof HttpError || error instanceof ProxyError || error instanceof ChatProtocolError) return errorResponse(request, error.message, error.status);
    return errorResponse(request, 'server', 500);
  }
}

export const handler = handle;

if (typeof Deno.serve === 'function' && !Deno.env.get('CHAT_TEST_MODE')) Deno.serve(handle);
