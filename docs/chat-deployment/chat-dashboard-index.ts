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

// Internal chat adapter. The browser contract remains the Responses API.
type ProtocolJson = Record<string, unknown>;
type ChatProtocol = 'responses' | 'messages' | 'chat';
type ChatProtocolSetting = 'auto' | ChatProtocol;
class ChatProtocolError extends Error {
  status = 400;
  constructor(code = 'input') { super(code); this.name = 'ChatProtocolError'; }
}
function chatEndpoint(base: string, setting: ChatProtocolSetting = 'auto'): { protocol: ChatProtocol; url: string } {
  const url = base.replace(/\/+$/, '');
  if (setting !== 'auto') {
    if (!['responses', 'messages', 'chat'].includes(setting)) throw new ChatProtocolError('api_protocol');
    // Replace only one recognized terminal endpoint; retain the provider's path.
    const root = url.replace(/\/(?:responses|messages?|chat\/completions)$/i, '');
    return { protocol: setting, url: `${root}/${setting === 'chat' ? 'chat/completions' : setting}` };
  }
  if (/\/chat\/completions$/i.test(url)) return { protocol: 'chat', url };
  if (/\/messages?$/i.test(url)) return { protocol: 'messages', url: url.replace(/\/message$/i, '/messages') };
  return { protocol: 'responses', url: /\/responses$/i.test(url) ? url : `${url}/responses` };
}
type ClaudeThinkingConfig =
  | { mode: 'omit' | 'disabled' }
  | { mode: 'enabled'; budget_tokens: number }
  | { mode: 'adaptive'; efforts: string[]; default_effort: string | null };

// Missing legacy rows fail safe: never enable thinking from generic effort fields.
function normalizeClaudeThinking(value: unknown = undefined, defaultMaxOutputTokens?: number, effectiveMaxTokens?: number): ClaudeThinkingConfig {
  if (value === undefined) return { mode: 'omit' };
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ChatProtocolError('claude_thinking');
  const config = value as ProtocolJson;
  const mode = config.mode;
  const keys = mode === 'enabled' ? ['mode', 'budget_tokens'] : mode === 'adaptive' ? ['mode', 'efforts', 'default_effort'] : ['mode'];
  if (typeof mode !== 'string' || !['omit', 'disabled', 'enabled', 'adaptive'].includes(mode) || Object.keys(config).some(key => !keys.includes(key))) throw new ChatProtocolError('claude_thinking');
  if (mode === 'omit' || mode === 'disabled') return { mode };
  if (mode === 'enabled') {
    const budget = config.budget_tokens;
    if (!Number.isSafeInteger(budget) || (budget as number) < 1024 ||
      [defaultMaxOutputTokens, effectiveMaxTokens].some(max => max !== undefined && (!Number.isSafeInteger(max) || (budget as number) >= max))) throw new ChatProtocolError('claude_thinking_budget');
    return { mode, budget_tokens: budget as number };
  }
  const efforts = config.efforts === undefined ? [] : config.efforts;
  const defaultEffort = config.default_effort === undefined ? null : config.default_effort;
  if (!Array.isArray(efforts) || efforts.some(effort => typeof effort !== 'string' || !['low', 'medium', 'high', 'xhigh', 'max'].includes(effort)) ||
    new Set(efforts).size !== efforts.length || (defaultEffort !== null && (typeof defaultEffort !== 'string' || !efforts.includes(defaultEffort)))) throw new ChatProtocolError('claude_thinking');
  return { mode: 'adaptive', efforts: [...efforts], default_effort: defaultEffort as string | null };
}

function validateProtocolCapabilities(protocol: ChatProtocol, model: { preserve_reasoning: boolean; reasoning_efforts: unknown; default_max_output_tokens?: number }, claudeThinking?: unknown): void {
  const config = normalizeClaudeThinking(claudeThinking, model.default_max_output_tokens);
  if (protocol !== 'messages' && config.mode !== 'omit') throw new ChatProtocolError('claude_thinking');
  if (protocol === 'responses') return;
  if (model.preserve_reasoning) throw new ChatProtocolError('reasoning_history_unsupported');
  if (protocol === 'messages') return;
  const supported = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'];
  if (!Array.isArray(model.reasoning_efforts) || model.reasoning_efforts.some(x => !supported.includes(String(x)))) throw new ChatProtocolError('reasoning_effort_unsupported');
}
function protocolRequest(protocol: ChatProtocol, body: ProtocolJson, claudeThinking?: unknown): ProtocolJson {
  if (protocol !== 'messages' && normalizeClaudeThinking(claudeThinking).mode !== 'omit') throw new ChatProtocolError('claude_thinking');
  if (protocol === 'responses') return body;
  const input = body.input as ProtocolJson[];
  if (input.some(x => x.type === 'reasoning') || body.include) throw new ChatProtocolError('input');
  const effort = (body.reasoning as ProtocolJson | undefined)?.effort as string | undefined;
  const max = body.max_output_tokens as number;
  if (protocol === 'chat') {
    return { model: body.model, messages: input.map(item => ({ role: item.role, content: (item.content as ProtocolJson[]).map(part => {
      if (part.type === 'input_text' || part.type === 'output_text') return { type: 'text', text: part.text };
      if (part.type === 'input_image') return { type: 'image_url', image_url: { url: part.image_url, detail: part.detail || 'auto' } };
      if (part.type === 'input_file') return { type: 'file', file: { filename: part.filename, file_data: part.file_data } };
      throw new ChatProtocolError();
    }) })), max_completion_tokens: max, reasoning_effort: effort, stream: true, stream_options: { include_usage: true }, store: false };
  }
  const messages: ProtocolJson[] = [], system: ProtocolJson[] = [];
  for (const item of input) {
    const content = (item.content as ProtocolJson[]).map(part => {
      if (part.type === 'input_text' || part.type === 'output_text') return { type: 'text', text: part.text };
      const data = String(part.image_url || part.file_data || '').match(/^data:([^;]+);base64,(.+)$/);
      if (!data) throw new ChatProtocolError('file');
      const source = { type: 'base64', media_type: data[1], data: data[2] };
      if (part.type === 'input_image') return { type: 'image', source };
      if (part.type === 'input_file') return { type: 'document', source, title: part.filename };
      throw new ChatProtocolError();
    });
    if (item.role === 'system' || item.role === 'developer') {
      // Moving an instruction across a conversation turn changes its meaning.
      if (messages.length) throw new ChatProtocolError();
      system.push(...content);
    } else {
      const previous = messages.at(-1);
      if (previous && previous.role === item.role) (previous.content as ProtocolJson[]).push(...content);
      else messages.push({ role: item.role, content });
    }
  }
  if (!messages.length || messages[0].role !== 'user') throw new ChatProtocolError();
  const config = normalizeClaudeThinking(claudeThinking, undefined, max);
  if (effort !== undefined && (config.mode !== 'adaptive' || !config.efforts.includes(effort))) throw new ChatProtocolError('claude_effort');
  const selectedEffort = config.mode === 'adaptive' ? effort ?? config.default_effort : null;
  const thinking = config.mode === 'omit' ? {} : { thinking: config.mode === 'enabled' ? { type: 'enabled', budget_tokens: config.budget_tokens } : { type: config.mode } };
  return { model: body.model, messages, ...(system.length ? { system } : {}), max_tokens: max, ...thinking,
    ...(selectedEffort ? { output_config: { effort: selectedEffort } } : {}), stream: true };
}

// Bounded SSE framing, including byte-fragmented CRLF and multiline data. An
// unterminated event at EOF is intentionally discarded, never treated as success.
function parseProtocolSse(onEvent: (event: ProtocolJson) => void, onDone = () => {}) {
  let buffer = '', data: string[] = [], eventName = '', eventBytes = 0;
  const dispatch = () => {
    if (data.length) {
      const raw = data.join('\n');
      if (raw === '[DONE]') onDone();
      else {
        const event = JSON.parse(raw);
        if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('stream');
        if (event.type === undefined && eventName) event.type = eventName;
        onEvent(event);
      }
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
    if (eof) { buffer = ''; data = []; eventName = ''; eventBytes = 0; }
  };
}
const record = (x: unknown): ProtocolJson => x && typeof x === 'object' && !Array.isArray(x) ? x as ProtocolJson : {};
const token = (x: unknown): number | null => Number.isSafeInteger(x) && (x as number) >= 0 ? x as number : null;
function protocolEvents(protocol: ChatProtocol, responseId: string, emit: (event: ProtocolJson) => void) {
  let started = false, ended = false, finishReason: string | null = null;
  let answer = '', refusal = '', summary = '', size = 0;
  let inputTokens: number | null = null, outputTokens: number | null = null, totalTokens: number | null = null;
  const messageId = `msg_${responseId}`;
  const send = (type: string, extra: ProtocolJson = {}) => emit({ type, ...extra });
  const start = () => {
    if (started) return;
    started = true;
    send('response.created', { response: { id: responseId, object: 'response', status: 'in_progress', output: [] } });
    send('response.output_item.added', { output_index: 0, item: { id: messageId, type: 'message', role: 'assistant', status: 'in_progress', content: [] } });
    send('response.content_part.added', { output_index: 0, item_id: messageId, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
  };
  const append = (kind: 'text' | 'refusal' | 'reasoning', value: unknown) => {
    if (value === undefined || value === null || value === '') return;
    if (typeof value !== 'string') throw new Error('stream');
    size += value.length;
    if (size > 16 * 1024 * 1024) throw new Error('stream_limit');
    start();
    if (kind === 'text') answer += value;
    else if (kind === 'refusal') refusal += value;
    else summary += value;
    send(kind === 'text' ? 'response.output_text.delta' : kind === 'refusal' ? 'response.refusal.delta' : 'response.reasoning_summary_text.delta', { output_index: 0, item_id: messageId, content_index: 0, delta: value });
  };
  const finish = (failed = false) => {
    if (ended) return;
    start(); ended = true;
    const incomplete = ['length', 'max_tokens', 'content_filter', 'refusal'].includes(finishReason || '');
    const status = failed ? 'failed' : incomplete ? 'incomplete' : 'completed';
    const content: ProtocolJson[] = [{ type: 'output_text', text: answer, annotations: [] }];
    if (refusal) content.push({ type: 'refusal', refusal });
    const message = { id: messageId, type: 'message', role: 'assistant', status: failed || incomplete ? 'incomplete' : 'completed', content };
    send('response.output_text.done', { output_index: 0, item_id: messageId, content_index: 0, text: answer });
    send('response.content_part.done', { output_index: 0, item_id: messageId, content_index: 0, part: content[0] });
    send('response.output_item.done', { output_index: 0, item: message });
    const output: ProtocolJson[] = [message];
    if (summary) output.unshift({ type: 'reasoning', summary: [{ type: 'summary_text', text: summary }] });
    send(`response.${status}`, { response: { id: responseId, object: 'response', status, output,
      usage: { input_tokens: failed ? null : inputTokens, output_tokens: failed ? null : outputTokens, total_tokens: failed ? null : totalTokens ?? (inputTokens !== null && outputTokens !== null && Number.isSafeInteger(inputTokens + outputTokens) ? inputTokens + outputTokens : null) },
      ...(incomplete ? { incomplete_details: { reason: ['length', 'max_tokens'].includes(finishReason!) ? 'max_output_tokens' : 'content_filter' } } : {}),
      ...(failed ? { error: { code: 'upstream', message: 'Upstream protocol error' } } : {}) } });
  };
  const event = (value: ProtocolJson) => {
    if (ended) return;
    if (protocol === 'responses') { emit(value); return; }
    if (value.type === 'error' || value.error) { finish(true); return; }
    if (protocol === 'chat') {
      if (!Array.isArray(value.choices)) throw new Error('stream');
      const usage = record(value.usage);
      if (value.usage) { inputTokens = token(usage.prompt_tokens); outputTokens = token(usage.completion_tokens); totalTokens = token(usage.total_tokens); }
      if (value.choices.length > 1) throw new Error('stream');
      for (const raw of value.choices) {
        const choice = record(raw), delta = record(choice.delta);
        if (choice.index !== 0 || delta.tool_calls || delta.function_call || (delta.role && delta.role !== 'assistant')) throw new Error('stream');
        append('text', delta.content); append('refusal', delta.refusal);
        append('reasoning', delta.reasoning_content ?? delta.reasoning);
        if (choice.finish_reason != null) {
          if (!['stop', 'length', 'content_filter'].includes(String(choice.finish_reason))) { finish(true); return; }
          finishReason = String(choice.finish_reason);
        }
      }
      return;
    }
    const type = value.type;
    if (type === 'ping') return;
    if (type === 'message_start') {
      if (started) throw new Error('stream');
      const message = record(value.message), usage = record(message.usage);
      const base = token(usage.input_tokens);
      // Anthropic input_tokens excludes both cache-read and cache-write tokens.
      const read = usage.cache_read_input_tokens === undefined ? 0 : token(usage.cache_read_input_tokens);
      const write = usage.cache_creation_input_tokens === undefined ? 0 : token(usage.cache_creation_input_tokens);
      inputTokens = base !== null && read !== null && write !== null && Number.isSafeInteger(base + read + write) ? base + read + write : null;
      outputTokens = token(usage.output_tokens); start();
    } else if (type === 'content_block_start') {
      if (!started) throw new Error('stream');
      const block = record(value.content_block);
      if (block.type === 'text') append('text', block.text);
      else if (block.type === 'thinking') append('reasoning', block.thinking);
      else if (block.type !== 'redacted_thinking') throw new Error('stream');
    } else if (type === 'content_block_delta') {
      if (!started) throw new Error('stream');
      const delta = record(value.delta);
      if (delta.type === 'text_delta') append('text', delta.text);
      else if (delta.type === 'thinking_delta') append('reasoning', delta.thinking);
      else if (delta.type !== 'signature_delta') throw new Error('stream');
    } else if (type === 'message_delta') {
      if (!started) throw new Error('stream');
      const usage = record(value.usage), delta = record(value.delta);
      if (value.usage) outputTokens = token(usage.output_tokens);
      if (delta.stop_reason != null) {
        finishReason = String(delta.stop_reason);
        if (!['end_turn', 'stop_sequence', 'max_tokens', 'refusal'].includes(finishReason)) finish(true);
      }
    } else if (type === 'message_stop') {
      if (!finishReason) throw new Error('stream');
      finish();
    } else if (type !== 'content_block_stop') throw new Error('stream');
  };
  return { event, done: () => { if (protocol === 'chat' && finishReason) finish(); } };
}

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
    'access-control-expose-headers': 'X-Chat-Request-Id, X-Chat-Quota-Limited, X-Chat-Max-Output-Tokens',
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
    restJson<Model[]>(`chat_models?id=eq.${encodeURIComponent(modelId)}&select=id,provider_id,model_key,display_name,introduction,context_window,max_output_tokens,default_max_output_tokens,reasoning_efforts,default_reasoning_effort,claude_thinking,supports_images,supports_pdf,preserve_reasoning,enabled,visibility&limit=1`),
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

async function updateUsage(requestId: string, patch: Json) {
  const response = await rest(`chat_usage?request_id=eq.${encodeURIComponent(requestId)}&status=in.(audited,upstream_started)`, { method: 'PATCH', headers: { 'content-type': 'application/json', prefer: 'return=representation' }, body: JSON.stringify(patch) });
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

async function callResponses(request: Request, ctx: RequestContext, payload: Json, test = false): Promise<Response> {
  const { model, provider } = await modelWithProvider(payload.model_id, true, ctx.user.id, test && ctx.isAdmin);
  const rawInput = test ? [{ role: 'user', content: [{ type: 'input_text', text: text(payload.prompt, MAX_INPUT_TEXT, true) }] }] : payload.input;
  const { input } = validateInput(rawInput, model);
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
  const body = { model: model.model_key, input, reasoning: effort ? { effort } : undefined, include: model.preserve_reasoning ? ['reasoning.encrypted_content'] : undefined, max_output_tokens: outputTokens, store: false, stream: true };
  let serialized = JSON.stringify(protocolRequest(protocol, body, model.claude_thinking));
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
  try {
    serialized = JSON.stringify(protocolRequest(protocol, body, model.claude_thinking));
  } catch (error) {
    // A quota shrink cannot change an exact configured thinking budget. Before
    // dispatch, invalid reservations are refunded and the lease is released.
    await finishGeneration(requestId, { status: 'failed', error_code: error instanceof ChatProtocolError ? error.message : 'claude_thinking' }, true);
    throw error;
  }
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
  if (body.max_output_tokens < outputTokens) response.headers.set('x-chat-quota-limited', 'true');
  response.headers.set('x-chat-max-output-tokens', String(body.max_output_tokens));
  return response;
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

async function main(request: Request, payload: Json): Promise<Response> {
  const action = ({ save_provider: 'admin_save_provider', save_model: 'admin_save_model', usage: 'admin_usage', test: 'admin_test' } as Record<string, string>)[String(payload.action)] || payload.action;
  if (typeof action !== 'string' || !ACTIONS.has(action)) throw new HttpError('action', 400);
  const allowed: Record<string, string[]> = {
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
    if (error instanceof HttpError || error instanceof ProxyError || error instanceof ChatProtocolError) return errorResponse(request, error.message, error.status);
    return errorResponse(request, 'server', 500);
  }
}

export const handler = handle;

if (typeof Deno.serve === 'function' && !Deno.env.get('CHAT_TEST_MODE')) Deno.serve(handle);
