// Independent proxy helpers: do not change the legacy Chat URL policy.
export class ProxyError extends Error {
  constructor(public code: string, public status: number) { super(code); }
}
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const ROUTE_FIELDS = 'id,name,base_url,secret_name,enabled,deleted_at,version,created_at,updated_at';
export const KEY_FIELDS = 'id,route_id,label,key_prefix,key_last4,enabled,revoked_at,version,created_at';
export type ProxyEndpoint = 'responses' | 'messages' | 'chat/completions';
export function proxyAllowedHeaders(endpoint: ProxyEndpoint): string[] {
  return endpoint === 'messages'
    ? ['authorization', 'content-type', 'x-api-key', 'anthropic-version', 'anthropic-beta']
    : ['authorization', 'content-type', 'openai-beta'];
}
export function proxyKey(request: Request, endpoint: ProxyEndpoint): string {
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
export function proxyHeaders(request: Request, secret: string, endpoint: ProxyEndpoint): Headers {
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
export async function hashKey(key: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))), x => x.toString(16).padStart(2, '0')).join('');
}
export function newKey(): string {
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
export async function proxyBase(value: unknown): Promise<string> {
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
export function proxySecret(value: unknown): string {
  if (typeof value !== 'string' || !/^CHAT_KEY_[A-Z0-9_]{1,80}$/.test(value)) throw new ProxyError('secret_name', 400);
  if (!Deno.env.get(value)) throw new ProxyError('secret_missing', 503);
  return value;
}
export function proxySetting(name: string, fallback: number, max: number): number {
  const raw = Deno.env.get(name);
  if (raw === undefined) return fallback;
  if (!/^[1-9][0-9]*$/.test(raw) || Number(raw) > max) throw new ProxyError('server_config', 503);
  return Number(raw);
}
