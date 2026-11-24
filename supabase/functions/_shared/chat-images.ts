import { ImageError, IMAGE_BYTES, decodeImageBase64, encodeImageBase64, inspectImage, readImageResponse, type ImageMedia } from './chat-image-media.ts';

type Json = Record<string, unknown>;
export type ImageConfig = { api: 'images'|'responses'|'chat'|'custom'; request_format: 'images'|'responses'|'chat'; endpoint: string; edit_endpoint: string; responses_tool: boolean; qualities: string[]; sizes: string[]; custom_size: boolean; max_dimension: number; max_pixels: number; supports_references: boolean; supports_transparency: boolean; max_batch: number; media_hosts: string[]; field_map: Record<string,string>; fixed_parameters: Json; result_path: string };
const defaults: ImageConfig = { api:'images', request_format:'images', endpoint:'', edit_endpoint:'', responses_tool:false, qualities:['auto'], sizes:['auto','1024x1024','1024x1536','1536x1024'], custom_size:false, max_dimension:4096, max_pixels:16777216, supports_references:false, supports_transparency:false, max_batch:10, media_hosts:[], field_map:{}, fixed_parameters:{}, result_path:'' };
function obj(value: unknown): Json { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ImageError('input'); return value as Json; }
function keys(value: Json, allowed: string[]) { if (Object.keys(value).some(x => !allowed.includes(x))) throw new ImageError('input'); }
export function imageConfig(value: unknown): ImageConfig {
  const raw = value == null ? {} : obj(value); keys(raw, Object.keys(defaults));
  const c = { ...defaults, ...raw } as ImageConfig;
  if (!['images','responses','chat','custom'].includes(c.api) || !['images','responses','chat'].includes(c.request_format) || (c.api !== 'custom' && c.api !== c.request_format)) throw new ImageError('image_config');
  for (const k of ['responses_tool','custom_size','supports_references','supports_transparency'] as const) if (typeof c[k] !== 'boolean') throw new ImageError('image_config');
  for (const [n, max] of [['max_dimension',4096],['max_pixels',16777216],['max_batch',10]] as const) if (!Number.isInteger(c[n]) || c[n] < 1 || c[n] > max) throw new ImageError('image_config');
  for (const k of ['qualities','sizes'] as const) if (!Array.isArray(c[k]) || !c[k].length || c[k].length > 32 || c[k].some(x => typeof x !== 'string' || !/^[a-zA-Z0-9_-]{1,40}$/.test(x)) || new Set(c[k]).size !== c[k].length) throw new ImageError('image_config');
  if (!Array.isArray(c.media_hosts) || c.media_hosts.length > 32 || c.media_hosts.some(x => typeof x !== 'string' || !/^(?=.{1,253}$)[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(x))) throw new ImageError('image_config');
  for (const k of ['endpoint','edit_endpoint'] as const) if (typeof c[k] !== 'string' || c[k].length > 2048 || (c[k] && !c[k].startsWith('https://'))) throw new ImageError('image_config');
  if (c.api === 'custom' && !c.endpoint) throw new ImageError('image_config');
  if (typeof c.result_path !== 'string' || (c.result_path && !/^[a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+){0,8}$/.test(c.result_path))) throw new ImageError('image_config');
  const map = obj(c.field_map), fixed = obj(c.fixed_parameters); keys(map, ['model','prompt','size','quality','background','n']);
  if (Object.values(map).some(x => typeof x !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(x)) || new Set(Object.values(map)).size !== Object.values(map).length || Object.keys(fixed).length > 16 || Object.entries(fixed).some(([k,v]) => !/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(k) || !['string','number','boolean'].includes(typeof v) || (typeof v === 'string' && v.length > 500) || (typeof v === 'number' && !Number.isFinite(v)))) throw new ImageError('image_config');
  if (c.api !== 'custom' && (Object.keys(map).length || Object.keys(fixed).length || c.result_path)) throw new ImageError('image_config');
  const fields = c.request_format === 'images' ? ['model','prompt','size','quality','background','n'] :
    c.request_format === 'responses' ? ['model','input','size','quality','background','tools','tool_choice','store'] :
    ['model','messages','size','quality','background','stream'];
  const effective = fields.map(k => String(map[k] || k));
  if (new Set(effective).size !== effective.length || Object.keys(fixed).some(k => effective.includes(k) || fields.includes(k) || ['model','prompt','size','quality','background','n'].includes(k))) throw new ImageError('image_config');
  return c;
}
export function imageCapabilities(c: ImageConfig) { return { qualities:c.qualities, sizes:c.sizes, custom_size:c.custom_size, max_dimension:c.max_dimension, max_pixels:c.max_pixels, supports_references:c.supports_references, supports_transparency:c.supports_transparency, max_batch:c.max_batch }; }
export type ImageInput = { prompt:string; options:{size:string;quality:string;background:string}; references:Array<{name:string;data:string;media:ImageMedia}> };
export async function imageInput(payload: Json, config: ImageConfig): Promise<ImageInput> {
  if (typeof payload.prompt !== 'string' || !payload.prompt.trim() || payload.prompt.length > 12000) throw new ImageError('input');
  const options = obj(payload.options); keys(options, ['size','quality','background']);
  const { size, quality, background } = options;
  if (typeof size !== 'string' || typeof quality !== 'string' || typeof background !== 'string' || !config.qualities.includes(quality) || !['auto','opaque','transparent'].includes(background) || (background === 'transparent' && !config.supports_transparency)) throw new ImageError('input');
  const m = /^(\d{1,4})x(\d{1,4})$/.exec(size);
  if ((!config.sizes.includes(size) && !(config.custom_size && m)) || (m && (+m[1] < 1 || +m[2] < 1 || +m[1] > config.max_dimension || +m[2] > config.max_dimension || +m[1] * +m[2] > config.max_pixels))) throw new ImageError('input');
  if (!Array.isArray(payload.references) || payload.references.length > 4 || (payload.references.length && !config.supports_references)) throw new ImageError('input');
  const references = [] as ImageInput['references'];
  for (const entry of payload.references) {
    const r = obj(entry); keys(r, ['name','data']);
    if (typeof r.name !== 'string' || !r.name || r.name.length > 160 || /[\x00-\x1f/\\]/.test(r.name) || typeof r.data !== 'string' || !r.data.startsWith('data:image/')) throw new ImageError('input');
    const decoded = decodeImageBase64(r.data, 5 * 1024 * 1024);
    const media = await inspectImage(decoded.bytes, 5 * 1024 * 1024, config.max_dimension, config.max_pixels);
    if (decoded.declaredMime !== media.mime) throw new ImageError('image_format');
    references.push({ name:r.name, data:r.data, media });
  }
  return { prompt:payload.prompt, options:{size,quality,background}, references };
}
export async function imageFingerprint(modelId: string, input: ImageInput): Promise<string> {
  const canonical = JSON.stringify({ model_id:modelId, prompt:input.prompt, options:input.options, references:input.references.map(r => ({ name:r.name, sha256:r.media.sha256 })) });
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical)));
  return Array.from(hash, x => x.toString(16).padStart(2,'0')).join('');
}
function atPath(value: unknown, path: string): unknown { for (const part of path.split('.')) { if (value === null || typeof value !== 'object') return undefined; value = (value as Json)[part]; } return value; }
function findResult(value: unknown, config: ImageConfig): unknown {
  if (config.result_path) return atPath(value, config.result_path);
  const o = value as any;
  if (config.request_format === 'images') return o?.data?.[0]?.b64_json ?? o?.data?.[0]?.url;
  if (config.request_format === 'responses') {
    for (const item of o?.output || []) { if (item?.type === 'image_generation_call' && item.result) return item.result; for (const part of item?.content || []) if (part?.type === 'output_image' || part?.type === 'image') return part.image_url ?? part.b64_json ?? part.url; }
  } else {
    const content = o?.choices?.[0]?.message?.content;
    if (typeof content === 'string' && content.startsWith('data:image/')) return content;
    for (const part of Array.isArray(content) ? content : []) if (['image','image_url','output_image'].includes(part?.type)) return part.image_url?.url ?? part.image_url ?? part.url ?? part.b64_json;
    const img = o?.choices?.[0]?.message?.images?.[0]; if (img) return img.image_url?.url ?? img.url ?? img.b64_json;
  }
  throw new ImageError('image_upstream_format', 502);
}
export async function generateImage(args: { config:ImageConfig; baseUrl:string; modelKey:string; input:ImageInput; headers:Headers; signal:AbortSignal; validateUrl:(value:string)=>Promise<string> }): Promise<ImageMedia> {
  const { config:c, input, signal } = args;
  const root = args.baseUrl.replace(/\/(?:responses|response|chat\/completions|images\/generations|images\/edits)$/i,'').replace(/\/$/,'');
  const endpoint = input.references.length && c.request_format === 'images' ? (c.edit_endpoint || (c.api === 'custom' ? c.endpoint : `${root}/images/edits`)) : (c.endpoint || (c.request_format === 'images' ? `${root}/images/generations` : c.request_format === 'chat' ? `${root}/chat/completions` : /\/response$/i.test(args.baseUrl) ? args.baseUrl : `${root}/responses`));
  await args.validateUrl(endpoint);
  const fields: Json = { model:args.modelKey, prompt:input.prompt, size:input.options.size, quality:input.options.quality, background:input.options.background, n:1 };
  let body: BodyInit; const headers = new Headers(args.headers);
  if (c.request_format === 'images' && input.references.length) {
    const form = new FormData();
    for (const [key,value] of Object.entries(fields)) form.set(c.field_map[key] || key, String(value));
    for (const [key,value] of Object.entries(c.fixed_parameters)) form.set(key,String(value));
    for (const r of input.references) form.append('image[]', new Blob([r.media.bytes], { type:r.media.mime }), r.name);
    body = form;
  } else {
    let data: Json;
    if (c.request_format === 'images') data = fields;
    else if (c.request_format === 'responses') data = { model:args.modelKey, input:[{ role:'user', content:[{ type:'input_text', text:input.prompt }, ...input.references.map(r => ({ type:'input_image', image_url:r.data }))] }], ...(c.responses_tool ? { tools:[{ type:'image_generation', size:input.options.size, quality:input.options.quality, background:input.options.background }], tool_choice:{ type:'image_generation' } } : { size:input.options.size, quality:input.options.quality, background:input.options.background }), store:false };
    else data = { model:args.modelKey, messages:[{ role:'user', content:[{ type:'text', text:input.prompt }, ...input.references.map(r => ({ type:'image_url', image_url:{url:r.data} }))] }], size:input.options.size, quality:input.options.quality, background:input.options.background, stream:false };
    if (c.api === 'custom') { const mapped: Json = {...c.fixed_parameters}; for (const [k,v] of Object.entries(data)) mapped[c.field_map[k] || k] = v; data = mapped; }
    headers.set('content-type','application/json'); body = JSON.stringify(data);
  }
  const response = await fetch(endpoint, { method:'POST', headers, body, signal, redirect:'error' });
  if (!response.ok) throw new ImageError('image_upstream', 502);
  const bytes = await readImageResponse(response, 24 * 1024 * 1024, signal);
  let result: unknown;
  try { result = findResult(JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes)), c); } catch (e) { if (e instanceof ImageError) throw e; throw new ImageError('image_upstream_format',502); }
  if (typeof result !== 'string') throw new ImageError('image_upstream_format',502);
  let imageBytes: Uint8Array; let declared: string | undefined;
  if (/^https:\/\//i.test(result)) {
    const u = new URL(result); if (!c.media_hosts.includes(u.hostname.toLowerCase()) || u.username || u.password || u.port || u.hash) throw new ImageError('image_media_url',502);
    // fetch() resolves hostnames independently from validateUrl(). Until a TLS
    // transport can pin the validated address, DNS hostnames are not safe here:
    // a rebinding answer could send the connection to a private service.
    // A literal IPv4 address has no second DNS lookup and is still checked by
    // validateUrl; signed query parameters remain intact.
    await args.validateUrl(u.origin + u.pathname);
    if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(u.hostname)) throw new ImageError('image_media_url',502);
    const media = await fetch(u.href, { signal, redirect:'error', headers:{ accept:'image/png,image/jpeg,image/webp' } });
    if (!media.ok) throw new ImageError('image_media_url',502);
    imageBytes = await readImageResponse(media, IMAGE_BYTES, signal);
  } else { const decoded = decodeImageBase64(result, IMAGE_BYTES); imageBytes = decoded.bytes; declared = decoded.declaredMime; }
  const image = await inspectImage(imageBytes, IMAGE_BYTES, c.max_dimension, c.max_pixels);
  if (declared && declared !== image.mime) throw new ImageError('image_format',502);
  return image;
}
export function imageOutput(image:ImageMedia) { return { b64_json:encodeImageBase64(image.bytes), mime:image.mime, width:image.width, height:image.height, sha256:image.sha256 }; }
