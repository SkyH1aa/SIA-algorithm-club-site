import { hashKey, proxyAllowedHeaders, proxyBase, proxyHeaders, proxyKey, proxySecret, proxySetting, ProxyError, UUID, type ProxyEndpoint } from '../_shared/chat-api-proxy.ts';

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
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    if (reader) {
      try {
        while (true) {
          const next = await bounded(reader.read()); if (next.done) break;
          size += next.value.byteLength;
          if (size > MAX_BYTES) throw new ProxyError('request_too_large', 413);
          chunks.push(next.value);
        }
      } catch (error) { void reader.cancel().catch(() => {}); throw error; }
      finally { reader.releaseLock(); }
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
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
    return failure(error instanceof ProxyError ? error.code : 'upstream_unavailable', error instanceof ProxyError ? error.status : 502, request);
  }
}
if (typeof Deno.serve === 'function' && !Deno.env.get('CHAT_TEST_MODE')) Deno.serve(handler);
