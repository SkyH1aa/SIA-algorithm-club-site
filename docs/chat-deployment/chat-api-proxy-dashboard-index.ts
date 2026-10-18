// DASHBOARD MANUAL DEPLOYMENT BUNDLE. Generated from supabase/functions.
// This file is standalone because the Supabase web editor does not upload _shared files.
// Independent proxy helpers: do not change the legacy Chat URL policy.
class ProxyError extends Error {
  constructor(public code: string, public status: number) { super(code); }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROUTE_FIELDS = 'id,name,base_url,secret_name,enabled,deleted_at,version,created_at,updated_at';
const KEY_FIELDS = 'id,route_id,label,key_prefix,key_last4,enabled,revoked_at,version,created_at';
type ProxyEndpoint = 'responses' | 'messages' | 'chat/completions';
function proxyAllowedHeaders(endpoint: ProxyEndpoint): string[] {
  return endpoint === 'messages'
    ? ['authorization', 'content-type', 'x-api-key', 'anthropic-version', 'anthropic-beta']
    : ['authorization', 'content-type', 'openai-beta'];
}
function proxyKey(request: Request, endpoint: ProxyEndpoint): string {
  const authorization = request.headers.get('authorization');
  const apiKey = request.headers.get('x-api-key');
  const bearer = authorization?.match(/^Bearer (cap_[A-Za-z0-9_-]{43})$/)?.[1];
  // A second credential must be valid and identical; never silently prefer one.
  if ((authorization !== null && !bearer) || (apiKey !== null &&
      (endpoint !== 'messages' || !/^cap_[A-Za-z0-9_-]{43}$/.test(apiKey))) ||
      (bearer && apiKey !== null && bearer !== apiKey) || (!bearer && apiKey === null)) {
    throw new ProxyError('invalid_key', 401);
  }
  return bearer || apiKey!;
}
function proxyHeaders(request: Request, secret: string, endpoint: ProxyEndpoint): Headers {
  const headers = new Headers({ 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'accept-encoding': 'identity' });
  if (endpoint === 'messages') {
    const version = request.headers.get('anthropic-version') ?? '2023-06-01';
    if (!/^20\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(version) ||
        !Number.isFinite(Date.parse(version)) || new Date(version).toISOString().slice(0, 10) !== version) {
      throw new ProxyError('header', 400);
    }
    headers.set('x-api-key', secret);
    headers.set('anthropic-version', version);
  } else headers.set('authorization', `Bearer ${secret}`);
  const betaName = endpoint === 'messages' ? 'anthropic-beta' : 'openai-beta';
  const beta = request.headers.get(betaName);
  if (beta !== null) {
    const token = endpoint === 'messages' ? /^[A-Za-z0-9][A-Za-z0-9._-]*$/ : /^[A-Za-z0-9][A-Za-z0-9._-]*(?:=[A-Za-z0-9][A-Za-z0-9._-]*)?$/;
    if (beta.length > 1024 || !beta.split(',').every(value => token.test(value.trim()))) throw new ProxyError('header', 400);
    headers.set(betaName, beta);
  }
  return headers;
}
async function hashKey(key: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))), x => x.toString(16).padStart(2, '0')).join('');
}
function newKey(): string {
  return 'cap_' + btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function publicIp(ip: string): boolean {
  if (ip.includes(':')) {
    const parts = ip.toLowerCase().split('::');
    if (parts.length > 2) return false;
    const words = parts.flatMap(p => p ? p.split(':') : []);
    if (words.some(w => !/^[a-f0-9]{1,4}$/.test(w)) || (parts.length === 1 ? words.length !== 8 : words.length >= 8)) return false;
    const left = parts[0] ? parts[0].split(':') : [];
    const right = parts[1] ? parts[1].split(':') : [];
    const expanded = [...left, ...Array(parts.length === 2 ? 8 - words.length : 0).fill('0'), ...right];
    const first = parseInt(expanded[0], 16), second = parseInt(expanded[1], 16);
    return first >= 0x2000 && first <= 0x3fff && !(first === 0x2001 && (second <= 0x1ff || second === 0xdb8)) && first !== 0x2002 && !(first === 0x3fff && second <= 0xfff);
  }
  const bytes = ip.split('.').map(Number);
  if (bytes.length !== 4 || bytes.some(x => !Number.isInteger(x) || x < 0 || x > 255)) return false;
  const [a,b,c] = bytes;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
}
async function proxyBase(value: unknown): Promise<string> {
  if (typeof value !== 'string' || value.length > 2048 || /[\\\s]/.test(value)) throw new ProxyError('provider_url', 400);
  let u: URL;
  try { u = new URL(value); } catch { throw new ProxyError('provider_url', 400); }
  const host = u.hostname.toLowerCase();
  let ownHost = '';
  try { ownHost = new URL(Deno.env.get('SUPABASE_URL') || '').hostname; } catch { /* no configuration */ }
  // Saved routes may name any native endpoint. Retain the provider's base
  // prefix (including /v1), then let each request select its own native path.
  const path = u.pathname.replace(/\/+$/, '').replace(/\/(?:responses|messages|message|chat\/completions)$/, '');
  let decodedPath: string;
  try { decodedPath = decodeURIComponent(path); } catch { throw new ProxyError('provider_url', 400); }
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || (u.port && u.port !== '443') || !host.includes('.') || host.endsWith('.') || host.includes(':') || host === ownHost || /(^|\.)(localhost|local|internal|test|invalid)$|(^|\.)home\.arpa$/i.test(host) || /(^|\/)(response|responses)$/i.test(decodedPath) || /chat-api-proxy/i.test(decodedPath)) throw new ProxyError('provider_url', 400);
  if (/^[\d.]+$/.test(host)) {
    if (!publicIp(host)) throw new ProxyError('provider_url', 400);
  } else {
    const answers = await Promise.allSettled([Deno.resolveDns(host, 'A'), Deno.resolveDns(host, 'AAAA')]);
    const addresses: string[] = [];
    for (const answer of answers) {
      if (answer.status === 'fulfilled') addresses.push(...answer.value);
      else if (!(answer.reason instanceof Deno.errors.NotFound)) throw new ProxyError('provider_url', 400);
    }
    if (!addresses.length || addresses.some(ip => !publicIp(ip))) throw new ProxyError('provider_url', 400);
  }
  return `${u.origin}${path}`;
}
function proxySecret(value: unknown): string {
  if (typeof value !== 'string' || !/^CHAT_KEY_[A-Z0-9_]{1,80}$/.test(value)) throw new ProxyError('secret_name', 400);
  if (!Deno.env.get(value)) throw new ProxyError('secret_missing', 503);
  return value;
}
function proxySetting(name: string, fallback: number, max: number): number {
  const raw = Deno.env.get(name);
  if (raw === undefined) return fallback;
  if (!/^[1-9][0-9]*$/.test(raw) || Number(raw) > max) throw new ProxyError('server_config', 503);
  return Number(raw);
}

// Bound both payload bytes and retained storage independently of network chunking.
class ChatBodyError extends Error {
  constructor(public code: string, public status: number) { super(code); this.name = 'ChatBodyError'; }
}

type ChatBodyOptions = { maxBytes: number; signal?: AbortSignal; timeoutMs?: number };

async function readChatBody(request: Request, options: ChatBodyOptions): Promise<Uint8Array<ArrayBuffer>> {
  const { maxBytes, signal, timeoutMs } = options;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 ||
      (timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0))) {
    throw new RangeError('Invalid body reader limits');
  }
  const reader = request.body?.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectRead: ((error: ChatBodyError) => void) | undefined;
  let interrupted = false;
  const stop = () => {
    interrupted = true;
    rejectRead?.(new ChatBodyError('timeout', 504));
  };
  const signals = new Set([request.signal, signal].filter((value): value is AbortSignal => !!value));
  try {
    const declared = request.headers.get('content-length');
    if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) {
      throw new ChatBodyError('request_too_large', 413);
    }
    for (const source of signals) {
      source.addEventListener('abort', stop, { once: true });
      if (source.aborted) stop();
    }
    if (interrupted) throw new ChatBodyError('timeout', 504);
    if (timeoutMs !== undefined) timer = setTimeout(stop, timeoutMs);
    if (!reader) return new Uint8Array();
    const blockSize = 64 * 1024;
    const blocks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      // A fresh interrupt promise avoids accumulating Promise.race reactions on
      // one pending abort promise for every tiny chunk.
      const interrupt = new Promise<never>((_, reject) => { rejectRead = reject; });
      let next: ReadableStreamReadResult<Uint8Array>;
      try { next = await Promise.race([reader.read(), interrupt]); }
      finally { rejectRead = undefined; }
      if (interrupted) throw new ChatBodyError('timeout', 504);
      if (next.done) break;
      if (next.value.byteLength > maxBytes - size) throw new ChatBodyError('request_too_large', 413);
      // Copy immediately: never retain a network view or its possibly larger backing
      // buffer. The number of stored blocks is at most ceil(maxBytes / blockSize),
      // even for one-byte or empty input chunks.
      let offset = 0;
      while (offset < next.value.byteLength) {
        const blockIndex = Math.floor(size / blockSize);
        const blockOffset = size % blockSize;
        if (!blocks[blockIndex]) blocks.push(new Uint8Array(Math.min(blockSize, maxBytes - size)));
        const count = Math.min(next.value.byteLength - offset, blocks[blockIndex].length - blockOffset);
        blocks[blockIndex].set(next.value.subarray(offset, offset + count), blockOffset);
        offset += count; size += count;
      }
    }
    const bytes = new Uint8Array(size);
    for (let index = 0; index < blocks.length; index++) {
      bytes.set(blocks[index].subarray(0, Math.min(blocks[index].length, size - index * blockSize)), index * blockSize);
    }
    return bytes;
  } catch (error) {
    // Do not await untrusted stream cancellation: it may itself never settle.
    if (reader) void reader.cancel(error).catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
    for (const source of signals) source.removeEventListener('abort', stop);
    reader?.releaseLock();
  }
}

const MAX_BYTES = 12 * 1024 * 1024;
function configuredProxyOrigins(): Set<string> {
  return new Set((Deno.env.get('CHAT_PROXY_CORS_ORIGINS') || '').split(',').map(value => value.trim()).filter(Boolean));
}
function cors(request?: Request): Headers {
  const origin = request?.headers.get('origin');
  const configured = configuredProxyOrigins();
  const endpoint = request && /\/v1\/messages?$/.test(new URL(request.url).pathname) ? 'messages' : 'responses';
  const headers = new Headers({ 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': proxyAllowedHeaders(endpoint).join(', '), 'access-control-max-age': '600', 'cache-control': 'no-store', 'vary': 'Origin' });
  if (configured.size === 0) headers.set('access-control-allow-origin', '*');
  else if (origin && configured.has(origin)) headers.set('access-control-allow-origin', origin);
  return headers;
}
function assertProxyOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  const configured = configuredProxyOrigins();
  if (origin && configured.size > 0 && !configured.has(origin)) throw new ProxyError('cors', 403);
}
function failure(code: string, status: number, request?: Request): Response {
  const headers = cors(request); headers.set('content-type', 'application/json');
  return new Response(status === 304 ? null : JSON.stringify({ error: { message: 'The proxy request could not be completed.', type: 'proxy_error', code } }), { status, headers });
}
async function rpc(name: string, body: unknown, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const base = Deno.env.get('SUPABASE_URL'), key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('CLUB_SERVICE_ROLE_KEY');
  if (!base || !key) throw new ProxyError('server_config', 503);
  const response = await fetch(`${base.replace(/\/$/, '')}/rest/v1/rpc/${name}`, { method: 'POST', redirect: 'error', signal,
    headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) { await response.body?.cancel(); throw new ProxyError('database', 503); }
  return await response.json();
}
export async function handler(request: Request): Promise<Response> {
  // Match the deployed prefix or local function prefix, never arbitrary suffixes.
  const url = new URL(request.url);
  try { assertProxyOrigin(request); } catch (error) { return failure(error instanceof ProxyError ? error.code : 'cors', error instanceof ProxyError ? error.status : 403, request); }
  const match = url.pathname.match(/^\/(?:functions\/v1\/)?chat-api-proxy\/([^/]+)\/v1\/(responses|messages|message|chat\/completions)$/);
  if (!match || !UUID.test(match[1]) || url.search) return failure('path', 404, request);
  const endpoint = (match[2] === 'message' ? 'messages' : match[2]) as ProxyEndpoint;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(request) });
  if (request.method !== 'POST') return failure('method', 405, request);
  const controller = new AbortController();
  const requestId = crypto.randomUUID();
  let admitted = false, released = false, ended = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let upstreamReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
  const cleanup = async () => {
    if (admitted && !released) {
      released = true;
      // Independent short cleanup budget; failure is recovered by DB lease expiry.
      await rpc('chat_proxy_release', { p_request_id: requestId }, AbortSignal.timeout(5000)).catch(() => {});
    }
  };
  const finish = () => {
    if (ended) return;
    ended = true; clearTimeout(timer); request.signal.removeEventListener('abort', abort);
  };
  const abort = () => {
    controller.abort();
    void upstreamReader?.cancel().catch(() => {});
    try { streamController?.error(new Error('proxy_interrupted')); } catch { /* already closed */ }
    finish(); void cleanup();
  };
  // Race DNS/reader mocks and any operation that cannot consume an AbortSignal.
  const bounded = async <T>(promise: Promise<T>): Promise<T> => {
    if (controller.signal.aborted) throw new ProxyError('timeout', 504);
    let stop: (() => void) | undefined;
    try { return await Promise.race([promise, new Promise<never>((_, reject) => {
      stop = () => reject(new ProxyError('timeout', 504)); controller.signal.addEventListener('abort', stop, { once: true });
    })]); } finally { if (stop) controller.signal.removeEventListener('abort', stop); }
  };
  try {
    // Supabase Free wall=150s, Paid=400s, idle=150s. Conservative Free-safe ceiling.
    const timeout = proxySetting('CHAT_PROXY_TIMEOUT_MS', 120000, 120000);
    const keyLimit = proxySetting('CHAT_PROXY_KEY_CONCURRENCY', 2, 1000);
    const routeLimit = proxySetting('CHAT_PROXY_ROUTE_CONCURRENCY', 20, 10000);
    timer = setTimeout(abort, timeout);
    request.signal.addEventListener('abort', abort, { once: true });
    if (request.signal.aborted) abort();
    const key = proxyKey(request, endpoint);
    if (request.headers.has('content-encoding')) throw new ProxyError('encoding', 415);
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') || '')) throw new ProxyError('content_type', 415);
    const declared = request.headers.get('content-length');
    if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_BYTES)) throw new ProxyError('request_too_large', 413);
    const digest = await bounded(hashKey(key));
    // Do not cancel admission transport: if timeout races DB commit, its eventual
    // result still triggers release. An unreachable response relies on lease expiry.
    const admission = rpc('chat_proxy_admit', { p_route_id: match[1], p_key_hash: digest, p_request_id: requestId, p_key_limit: keyLimit, p_route_limit: routeLimit, p_ttl_ms: timeout + 30000 }).then(async result => {
      if (result.route) { admitted = true; if (ended) await cleanup(); }
      return result;
    });
    const result = await bounded(admission);
    if (!result.route) throw new ProxyError(result.code === 'busy' ? 'busy' : 'invalid_key', result.code === 'busy' ? 429 : 401);
    const route = result.route as Record<string, unknown>;
    const base = await bounded(proxyBase(route.base_url));
    const secret = Deno.env.get(proxySecret(route.secret_name))!;
    const upstreamHeaders = proxyHeaders(request, secret, endpoint);
    const bytes = await readChatBody(request, { maxBytes: MAX_BYTES, signal: controller.signal });
    try { JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw new ProxyError('input', 400); }
    const upstream = await bounded(fetch(`${base}/${endpoint}`, { method: 'POST', redirect: 'error', signal: controller.signal,
      headers: upstreamHeaders, body: bytes }));
    if (!upstream.ok) {
      void upstream.body?.cancel().catch(() => {});
      throw new ProxyError('upstream_error', upstream.status);
    }
    if (upstream.status === 204 || upstream.status === 205) {
      void upstream.body?.cancel().catch(() => {}); finish(); await cleanup();
      return new Response(null, { status: upstream.status, headers: cors(request) });
    }
    const type = upstream.headers.get('content-type') || '';
    if (!/^(application\/json|text\/event-stream)(?:;|$)/i.test(type) || !upstream.body) {
      void upstream.body?.cancel().catch(() => {}); throw new ProxyError('upstream_response', 502);
    }
    const headers = cors(request);
    // Deliberately tiny response allowlist. No credentials, URL, cookie, server,
    // arbitrary diagnostic fields or content-length after runtime decompression.
    headers.set('content-type', type);
    upstreamReader = upstream.body.getReader();
    const stream = new ReadableStream<Uint8Array>({
      start(c) { streamController = c; },
      async pull(c) {
        try {
          const next = await bounded(upstreamReader!.read());
          if (next.done) { finish(); await cleanup(); c.close(); }
          else c.enqueue(next.value);
        } catch { finish(); controller.abort(); await cleanup(); try { c.error(new Error('proxy_interrupted')); } catch { /* closed */ } }
      },
      async cancel() { abort(); await cleanup(); }
    }, { highWaterMark: 0 });
    return new Response(stream, { status: upstream.status, headers });
  } catch (error) {
    finish(); controller.abort(); await cleanup();
    return failure(error instanceof ProxyError || error instanceof ChatBodyError ? error.code : 'upstream_unavailable', error instanceof ProxyError || error instanceof ChatBodyError ? error.status : 502, request);
  }
}
if (typeof Deno.serve === 'function' && !Deno.env.get('CHAT_TEST_MODE')) Deno.serve(handler);
