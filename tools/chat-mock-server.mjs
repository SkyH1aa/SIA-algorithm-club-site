import http from 'node:http';
import {readFile, realpath, stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID, randomBytes, createHash, timingSafeEqual} from 'node:crypto';
import assert from 'node:assert/strict';

// Deliberately standalone: never import the backend, read credentials, or fetch an upstream.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const FIXTURES = path.join(ROOT, 'docs/chat-validation/fixtures');
const portArgument = process.argv.indexOf('--port');
const PORT = portArgument < 0 ? 4191 : Number(process.argv[portArgument+1]);
if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) throw new Error('Invalid --port (1024..65535)');
const ORIGIN = `http://localhost:${PORT}`;
const LIMIT = 12 * 1024 * 1024;
const ACCOUNTS = {
  admin: {id:'10000000-0000-4000-8000-000000000001', email:'mock-admin@example.invalid', member_name:'MOCK 管理员', admin:true, bound:true},
  member: {id:'10000000-0000-4000-8000-000000000002', email:'mock-member-a@example.invalid', member_name:'MOCK 社员 A', admin:false, bound:true},
  member2: {id:'10000000-0000-4000-8000-000000000003', email:'mock-member-b@example.invalid', member_name:'MOCK 社员 B', admin:false, bound:true},
  unbound: {id:'10000000-0000-4000-8000-000000000004', email:'mock-unbound@example.invalid', member_name:null, admin:false, bound:false},
  loggedout: null
};
const SCENARIOS = ['completed','incomplete','interrupted','failed','slow'];
const PROXY_ACTIONS = ['admin_proxy_list','admin_proxy_save','admin_proxy_route_state','admin_proxy_key_create','admin_proxy_key_state'];
const ACTIONS = ['catalog','respond','admin_get','admin_save_provider','admin_save_model','admin_delete_provider','admin_delete_model','admin_usage','admin_test','quota','admin_user_directory','admin_quota_get','admin_quota_save','admin_set_blacklist','admin_blacklist_list','custom_model_list','custom_model_save','custom_model_delete',...PROXY_ACTIONS];
const ACTION_ALIASES = new Map([['save_provider','admin_save_provider'],['save_model','admin_save_model'],['usage','admin_usage'],['test','admin_test']]);
const PROVIDER_ID = '20000000-0000-4000-8000-000000000001';
const MODEL_ID = '30000000-0000-4000-8000-000000000001';
const MIME = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.txt':'text/plain; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.pdf':'application/pdf','.wasm':'application/wasm','.woff2':'font/woff2','.ico':'image/x-icon'};
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'";
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
class MockError extends Error { constructor(code, status = 400) { super(code); this.status = status; } }
function requireThat(condition, code = 'input', status = 400) { if (!condition) throw new MockError(code, status); }
function integer(value, min, max, fallback) {
  if (value === undefined && fallback !== undefined) return fallback;
  requireThat(Number.isInteger(value) && value >= min && value <= max);
  return value;
}
function text(value, max, required = false) {
  if (value == null && !required) return null;
  requireThat(typeof value === 'string' && value.trim().length <= max && (!required || value.trim().length));
  return value.trim() || null;
}
function keys(object, allowed) { requireThat(Object.keys(object).every(key => allowed.includes(key))); }
function seed(contextWindow) {
  const provider = {id:PROVIDER_ID,name:'mock',label:'MOCK 本地供应商',base_url:'https://mock-provider.example.com/v1',secret_name:'CHAT_KEY_MOCK',auth_header:'authorization',enabled:true};
  const stamp = new Date(0).toISOString();
  const base = {provider_id:provider.id,context_window:contextWindow,max_output_tokens:4096,default_max_output_tokens:512,reasoning_efforts:['none','low','medium','high','xhigh','max'],default_reasoning_effort:'medium',supports_images:true,supports_pdf:true,preserve_reasoning:false,enabled:true,introduction:null,updated_at:stamp,deleted_at:null};
  return {providers:[provider],models:[{...base,id:MODEL_ID,model_key:'mock-multimodal',display_name:'MOCK 多模态'}, {...base,id:'30000000-0000-4000-8000-000000000002',model_key:'mock-text',display_name:'MOCK 纯文本',supports_images:false,supports_pdf:false}],usage:[]};
}
function sessionFor(state) {
  const account = ACCOUNTS[state.account];
  return account ? {access_token:`mock.${state.revision}.${state.account}`,token_type:'bearer',expires_at:4102444800,user:{id:account.id,email:account.email,aud:'authenticated',role:'authenticated',user_metadata:{mock:true}}} : null;
}
function json(res, value, status = 200) { res.writeHead(status, {'content-type':'application/json; charset=utf-8'}); res.end(JSON.stringify(value)); }
async function body(req) {
  let length = 0; const chunks = [];
  for await (const chunk of req) { length += chunk.length; requireThat(length <= LIMIT, 'request_too_large', 413); chunks.push(chunk); }
  try { const result = JSON.parse(Buffer.concat(chunks).toString('utf8')); requireThat(result && typeof result === 'object' && !Array.isArray(result)); return {payload:result,bytes:length}; }
  catch (error) { if (error instanceof MockError) throw error; throw new MockError('input'); }
}
function validateInput(input, model) {
  requireThat(Array.isArray(input) && input.length > 0 && input.length <= 160);
  let attachmentCount = 0, attachmentBytes = 0, textBytes = 0;
  const roles = {user:0,assistant:0,system:0,developer:0};
  const parts = {input_text:0,input_image:0,input_file:0,output_text:0,reasoning:0};
  function contentText(value) { requireThat(typeof value === 'string' && value.length > 0 && value.length <= 500000); textBytes += Buffer.byteLength(value); }
  function dataBytes(value, pattern) {
    requireThat(typeof value === 'string' && pattern.test(value), 'file');
    const encoded = value.slice(value.indexOf(',') + 1);
    requireThat(encoded.length % 4 !== 1, 'file');
    const size = Buffer.from(encoded,'base64').length;
    requireThat(size > 0 && size <= 5 * 1024 * 1024, 'file', 413);
    attachmentCount++; attachmentBytes += size;
  }
  function outputs(content) {
    requireThat(Array.isArray(content) && content.length > 0 && content.length <= 32);
    for (const part of content) {
      requireThat(part && part.type === 'output_text'); keys(part,['type','text','annotations']); contentText(part.text);
      requireThat(part.annotations === undefined || (Array.isArray(part.annotations) && part.annotations.length === 0)); parts.output_text++;
    }
  }
  for (const item of input) {
    requireThat(item && typeof item === 'object' && !Array.isArray(item));
    // Responses continuation returns top-level assistant message / reasoning items.
    if (item.type === 'message') {
      keys(item,['type','role','content','status']); requireThat(item.role === 'assistant' && (item.status === undefined || item.status === 'completed'));
      roles.assistant++; outputs(item.content); continue;
    }
    if (item.type === 'reasoning') {
      keys(item,['type','encrypted_content','summary']); requireThat(model.preserve_reasoning && Array.isArray(item.summary) && item.summary.length === 0);
      contentText(item.encrypted_content); parts.reasoning++; continue;
    }
    keys(item,['role','content']); requireThat(Object.hasOwn(roles,item.role)); roles[item.role]++;
    requireThat(Array.isArray(item.content) && item.content.length > 0 && item.content.length <= 32);
    for (const part of item.content) {
      requireThat(part && typeof part === 'object');
      if (part.type === 'input_text') {
        keys(part,['type','text']); requireThat(item.role !== 'assistant'); contentText(part.text); parts.input_text++;
      } else if (part.type === 'output_text') {
        requireThat(item.role === 'assistant'); outputs([part]);
      } else if (part.type === 'input_image') {
        keys(part,['type','image_url','detail']); requireThat(item.role === 'user' && model.supports_images,'file');
        requireThat(part.detail === undefined || ['auto','low','high'].includes(part.detail));
        dataBytes(part.image_url,/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/); parts.input_image++;
      } else if (part.type === 'input_file') {
        keys(part,['type','filename','file_data']); requireThat(item.role === 'user' && model.supports_pdf && typeof part.filename === 'string' && /^[^/\\\0]{1,160}\.pdf$/i.test(part.filename),'file');
        dataBytes(part.file_data,/^data:application\/pdf;base64,[A-Za-z0-9+/]+={0,2}$/); parts.input_file++;
      } else throw new MockError('input');
    }
  }
  requireThat(attachmentCount <= 4 && textBytes <= 500000,'input',413);
  return {input_items:input.length,roles,parts,text_bytes:textBytes,attachment_count:attachmentCount,attachment_bytes:attachmentBytes};
}
function estimateInputTokens(input) {
  let tokens = 0;
  for (const item of input) {
    if (item.type === 'reasoning') tokens += Math.ceil(Buffer.byteLength(item.encrypted_content)/3);
    else for (const part of item.content) {
      if (['input_text','output_text'].includes(part.type)) tokens += Math.ceil(Buffer.byteLength(part.text)/3);
      else if (part.type === 'input_image') tokens += {low:1024,auto:4096,high:8192}[part.detail || 'auto'];
      else if (part.type === 'input_file') tokens += 8192;
    }
  }
  return tokens;
}
function endpointProtocol(pathname) {
  if (/(?:^|\/)chat\/completions\/?$/i.test(pathname)) return 'chat-completions';
  if (/(?:^|\/)(?:messages|message)\/?$/i.test(pathname)) return 'messages';
  return 'responses';
}
function endpointURL(baseUrl, protocol = endpointProtocol(new URL(baseUrl).pathname)) {
  const url = new URL(baseUrl);
  const parent = url.pathname.replace(/\/+$/,'').replace(/\/(?:responses|messages|message|chat\/completions)$/i,'');
  url.pathname = `${parent}/${protocol === 'chat-completions' ? 'chat/completions' : protocol}`;
  return url.href;
}
function providerConfig(payload) {
  requireThat(payload.id == null || uuid(payload.id));
  let url;
  try { url = new URL(payload.base_url); } catch { throw new MockError('provider_url'); }
  // Syntactic check only; no DNS lookup and no connection is ever made.
  requireThat(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && (!url.port || url.port === '443'),'provider_url');
  requireThat(!/^(localhost|.*\.localhost|.*\.local|.*\.invalid|.*\.test|.*\.internal)$/i.test(url.hostname) && !/^(127|10|0|192\.168|169\.254)\./.test(url.hostname) && !url.hostname.includes(':'),'provider_url');
  const name = text(payload.secret_name,90,true);
  requireThat(/^CHAT_KEY_[A-Z0-9_]{1,80}$/.test(name),'secret_name');
  requireThat(payload.auth_header === undefined || ['authorization','x-api-key'].includes(payload.auth_header));
  return {id:payload.id || randomUUID(),name:text(payload.name,80,true),label:text(payload.label,120) || '',base_url:`${url.origin}${url.pathname.replace(/\/+$/,'')}`,secret_name:name,auth_header:payload.auth_header || 'authorization',enabled:payload.enabled === undefined ? true : Boolean(payload.enabled),updated_at:new Date().toISOString(),deleted_at:null};
}
function modelConfig(payload, providers) {
  requireThat(payload.id == null || uuid(payload.id));
  requireThat(uuid(payload.provider_id) && providers.some(row => row.id === payload.provider_id));
  const max = integer(payload.max_output_tokens,1,131072), efforts = payload.reasoning_efforts ?? [];
  requireThat(Array.isArray(efforts) && efforts.length <= 12 && efforts.every(value => typeof value === 'string' && value.length > 0 && value.length <= 40));
  const introduction = payload.introduction == null ? null : text(payload.introduction,1000,true);
  return {id:payload.id || randomUUID(),provider_id:payload.provider_id,model_key:text(payload.model_key ?? payload.model_id,160,true),display_name:text(payload.display_name,120,true),introduction,context_window:integer(payload.context_window,256,1000000),max_output_tokens:max,default_max_output_tokens:integer(payload.default_max_output_tokens,1,max),reasoning_efforts:efforts,default_reasoning_effort:payload.default_reasoning_effort == null ? null : text(payload.default_reasoning_effort,40,true),supports_images:Boolean(payload.supports_images),supports_pdf:Boolean(payload.supports_pdf),preserve_reasoning:Boolean(payload.preserve_reasoning),enabled:payload.enabled === undefined ? true : Boolean(payload.enabled),updated_at:new Date().toISOString(),deleted_at:null};
}
function upsert(rows, item) { const index = rows.findIndex(row => row.id === item.id); if (index < 0) rows.push(item); else rows[index] = item; return item; }
function rewriteJS(source, origin) {
  return source.replace(/https:\/\/[a-z0-9-]+\.supabase\.co/gi,origin)
    .replaceAll('/functions/v1/chat-api-proxy','/mock/chat-api-proxy')
    .replace(/\/functions\/v1\/chat(?=['"`/\s]|$)/g,'/mock/chat').replaceAll('/functions/v1/club-drive','/mock/club-drive');
}

function quotaLimit(value) { return value === null ? null : integer(value,0,1e12); }
function utcPeriods(now) {
  const day = Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate());
  const week = day - ((now.getUTCDay() + 6) % 7) * 86400000;
  const month = Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1);
  return [{period:'day',start:day,end:day+86400000},{period:'week',start:week,end:week+7*86400000},{period:'month',start:month,end:Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,1)}];
}

export function createMockServer({testPort = false, now = () => new Date()} = {}) {
  let state = {account:'member',scenario:'completed',theme:'dark',revision:1};
  let database = seed(32768);
  const logs = [], leases = new Map();
  let proxyRoutes = [], proxyKeys = [];
  const proxyLeases = new Map();
  const keyMetadata = ({hash,...metadata}) => metadata;
  const digest = value => createHash('sha256').update(value).digest();
  const proxyRow = (rows,id) => { requireThat(uuid(id)); const row = rows.find(item => item.id === id); requireThat(row,'not_found',404); return row; };
  const checkVersion = (payload,row) => { integer(payload.expected_version,0,Number.MAX_SAFE_INTEGER); requireThat(payload.expected_version === row.version,'conflict',409); };
  function proxyAdmin(payload) {
    const timestamp = now().toISOString();
    switch (payload.action) {
      case 'admin_proxy_list': keys(payload,['action']); return {routes:proxyRoutes,keys:proxyKeys.map(keyMetadata)};
      case 'admin_proxy_save': {
        keys(payload,['action','id','name','base_url','secret_name','enabled','expected_version']);
        requireThat(payload.id === null || uuid(payload.id)); requireThat(typeof payload.enabled === 'boolean');
        const current = payload.id === null ? {version:0} : proxyRow(proxyRoutes,payload.id); checkVersion(payload,current);
        const config = providerConfig(payload);
        requireThat(!/(^|\/)(response|models)\/?$/i.test(new URL(config.base_url).pathname),'provider_url');
        const route = {id:config.id,name:config.name,base_url:config.base_url,secret_name:config.secret_name,enabled:config.enabled,version:current.version+1,created_at:current.created_at || timestamp,updated_at:timestamp};
        upsert(proxyRoutes,route); return {route};
      }
      case 'admin_proxy_route_state': {
        keys(payload,['action','id','enabled','expected_version']); requireThat(typeof payload.enabled === 'boolean');
        const route = proxyRow(proxyRoutes,payload.id); checkVersion(payload,route);
        Object.assign(route,{enabled:payload.enabled,version:route.version+1,updated_at:timestamp}); return {route};
      }
      case 'admin_proxy_key_create': {
        keys(payload,['action','route_id','label']); const route = proxyRow(proxyRoutes,payload.route_id);
        const label = text(payload.label,120,true), api_key = `cap_${randomBytes(32).toString('base64url')}`;
        const key = {id:randomUUID(),route_id:route.id,label,key_prefix:api_key.slice(0,12),key_last4:api_key.slice(-4),enabled:true,revoked_at:null,version:1,created_at:timestamp,hash:digest(api_key)};
        proxyKeys.push(key); return {key:keyMetadata(key),api_key};
      }
      case 'admin_proxy_key_state': {
        keys(payload,['action','id','enabled','revoked','expected_version']);
        requireThat(typeof payload.enabled === 'boolean' && typeof payload.revoked === 'boolean');
        const key = proxyRow(proxyKeys,payload.id); checkVersion(payload,key);
        requireThat(!key.revoked_at || (payload.revoked && !payload.enabled),'revoked',409);
        Object.assign(key,{enabled:payload.revoked ? false : payload.enabled,revoked_at:key.revoked_at || (payload.revoked ? timestamp : null),version:key.version+1});
        return {key:keyMetadata(key)};
      }
    }
  }
  function proxyResponse(req,res,payload,route,key,meta,protocol) {
    requireThat(typeof payload.model === 'string' && payload.model.length > 0 && payload.model.length <= 160,'input');
    if (protocol === 'responses') requireThat(typeof payload.input === 'string' || Array.isArray(payload.input),'input');
    else {
      requireThat(Array.isArray(payload.messages) && payload.messages.length > 0 && payload.messages.every(message => message && ['system','developer','user','assistant','tool'].includes(message.role) && (typeof message.content === 'string' || Array.isArray(message.content))),'input');
      if (protocol === 'messages') integer(payload.max_tokens,1,131072);
    }
    requireThat(payload.stream === undefined || typeof payload.stream === 'boolean','input');
    requireThat([...proxyLeases.values()].filter(item => item.keyId === key.id).length < 2 && [...proxyLeases.values()].filter(item => item.routeId === route.id).length < 20,'rate_limit',429);
    const scenario = state.scenario;
    // Deterministic local-only failure fixture. Never echo a fabricated upstream body.
    if (scenario === 'failed') throw new MockError('upstream',502);
    const answer = 'MOCK proxy response; no upstream call.', id = `mock-proxy-${meta.request_id}`;
    const status = scenario === 'incomplete' ? 'incomplete' : 'completed';
    const response = protocol === 'messages'
      ? {id,type:'message',role:'assistant',model:payload.model,content:[{type:'text',text:answer}],stop_reason:status === 'incomplete' ? 'max_tokens' : 'end_turn',stop_sequence:null,usage:{input_tokens:1,output_tokens:1}}
      : protocol === 'chat-completions'
        ? {id,object:'chat.completion',created:Math.floor(now().getTime()/1000),model:payload.model,choices:[{index:0,message:{role:'assistant',content:answer},finish_reason:status === 'incomplete' ? 'length' : 'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}
        : {id,object:'response',model:payload.model,status,output:[{id:randomUUID(),type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:answer,annotations:[]}]}],usage:{input_tokens:1,output_tokens:1,total_tokens:2},...(status === 'incomplete' ? {incomplete_details:{reason:'max_output_tokens'}} : {})};
    if (!payload.stream) { meta.outcome = status; json(res,response); return; }
    let timer, ended = false;
    const finish = outcome => { if (ended) return; ended = true; clearInterval(timer); proxyLeases.delete(meta.request_id); meta.outcome = outcome; };
    proxyLeases.set(meta.request_id,{keyId:key.id,routeId:route.id,cancel:() => { finish('cancelled'); res.destroy(); }});
    res.on('close',() => finish('cancelled'));
    res.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-store','connection':'keep-alive'}); res.flushHeaders();
    const event = data => res.write(`${protocol === 'chat-completions' ? '' : `event: ${data.type}\n`}data: ${JSON.stringify(data)}\n\n`);
    const chunk = (delta,finish_reason = null) => ({id,object:'chat.completion.chunk',created:response.created,model:payload.model,choices:[{index:0,delta,finish_reason}]});
    if (protocol === 'messages') {
      event({type:'message_start',message:{...response,content:[],stop_reason:null,usage:{input_tokens:1,output_tokens:0}}});
      event({type:'content_block_start',index:0,content_block:{type:'text',text:''}});
    } else if (protocol === 'chat-completions') event(chunk({role:'assistant',content:''}));
    else event({type:'response.created',response:{...response,status:'in_progress',output:[]}});
    const chunks = ['MOCK ','proxy response; ','no upstream call.'];
    let index = 0;
    timer = setInterval(() => {
      if (ended) return;
      const delta = chunks[index++];
      if (protocol === 'messages') event({type:'content_block_delta',index:0,delta:{type:'text_delta',text:delta}});
      else if (protocol === 'chat-completions') event(chunk({content:delta}));
      else event({type:'response.output_text.delta',output_index:0,content_index:0,delta});
      if (scenario === 'interrupted' && index === 1) { finish('interrupted'); res.end(); return; }
      if (index < chunks.length) return;
      if (protocol === 'messages') {
        event({type:'content_block_stop',index:0});
        event({type:'message_delta',delta:{stop_reason:response.stop_reason,stop_sequence:null},usage:{output_tokens:1}});
        event({type:'message_stop'});
      } else if (protocol === 'chat-completions') {
        event(chunk({},response.choices[0].finish_reason));
        if (payload.stream_options?.include_usage) event({...chunk({}),choices:[],usage:response.usage});
      } else event({type:`response.${status}`,response});
      finish(status); res.end(protocol === 'messages' ? '' : 'data: [DONE]\n\n');
    },scenario === 'slow' ? 1500 : 25);
  }
  async function proxy(req,res,routeId,protocol) {
    const meta = {mock:true,request_id:randomUUID(),endpoint:'chat-api-proxy',protocol,route_id:routeId,outcome:'received'}; record(meta);
    try {
      requireThat(req.method === 'POST','method',405);
      const authorization = req.headers.authorization, nativeKey = req.headers['x-api-key'];
      const bearerKey = typeof authorization === 'string' && /^Bearer cap_[A-Za-z0-9_-]{43}$/.test(authorization) ? authorization.slice(7) : null;
      requireThat(authorization === undefined || bearerKey,'proxy_key',401);
      requireThat(nativeKey === undefined || (protocol === 'messages' && typeof nativeKey === 'string' && /^cap_[A-Za-z0-9_-]{43}$/.test(nativeKey)),'proxy_key',401);
      requireThat(bearerKey || nativeKey,'proxy_key',401);
      requireThat(!bearerKey || !nativeKey || bearerKey === nativeKey,'proxy_key',401);
      const candidate = digest(bearerKey || nativeKey);
      const key = proxyKeys.find(item => timingSafeEqual(item.hash,candidate));
      requireThat(key && key.route_id === routeId && key.enabled && !key.revoked_at,'proxy_key',401);
      const route = proxyRoutes.find(item => item.id === routeId); requireThat(route?.enabled,'route_disabled',403);
      // Record only the resolved path; no host, credentials, request body, or upstream fetch.
      meta.upstream_path = new URL(endpointURL(route.base_url,protocol)).pathname;
      if (protocol === 'messages') {
        const version = req.headers['anthropic-version'] ?? '2023-06-01';
        requireThat(typeof version === 'string' && /^20\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(version) && Number.isFinite(Date.parse(version)) && new Date(version).toISOString().slice(0,10) === version,'header');
        meta.anthropic_version = version;
      }
      const {payload,bytes} = await body(req); meta.request_bytes = bytes;
      proxyResponse(req,res,payload,route,key,meta,protocol);
    } catch (error) { meta.outcome = error instanceof MockError ? error.message : 'server'; throw error; }
  }
  let globalQuota, userQuotas, blacklist, counters, customModels;
  function resetQuotas() { globalQuota = {daily_limit:null,version:0}; userQuotas = new Map(); blacklist = new Map(); counters = new Map(); customModels = new Map(); }
  resetQuotas();
  function target(value, optional = true) {
    if (optional && value == null) return null;
    requireThat(uuid(value) && Object.values(ACCOUNTS).some(account => account?.id === value));
    return value;
  }
  const userSetting = id => userQuotas.get(id) || {daily_limit:null,weekly_limit:null,monthly_limit:null,version:0};
  const counterKey = (id, period) => `${id || 'global'}:${period.period}:${period.start}`;
  const used = (id, period) => counters.get(counterKey(id,period)) || 0;
  function snapshot(id) {
    const periods = utcPeriods(now()), user = userSetting(id), day = periods[0];
    const remaining = (limit,count) => limit === null ? null : Math.max(0,limit-count);
    return {global:{...globalQuota,used:used(null,day),remaining:remaining(globalQuota.daily_limit,used(null,day)),resets_at:new Date(day.end).toISOString()},user:{...user},periods:periods.map(period => {
      const limit = user[`${period.period === 'day' ? 'daily' : period.period === 'week' ? 'weekly' : 'monthly'}_limit`], count = id === null ? 0 : used(id,period);
      return {period:period.period,limit,used:count,remaining:remaining(limit,count),resets_at:new Date(period.end).toISOString()};
    }),blacklisted:blacklist.has(id),reason:blacklist.get(id) ?? null};
  }
  function reserve(id,inputTokens,requested) {
    requireThat(!blacklist.has(id),'blacklisted',403);
    const quota = snapshot(id), left = [quota.global.remaining,...quota.periods.map(period => period.remaining)].filter(value => value !== null);
    const max = Math.min(requested,...left.map(value => value-inputTokens));
    requireThat(max >= 1,'quota',429);
    const periods = utcPeriods(now()), entries = [[null,periods[0]],...periods.map(period => [id,period])];
    const amount = inputTokens + max;
    const add = delta => { for (const [owner,period] of entries) { const key = counterKey(owner,period); counters.set(key,(counters.get(key) || 0)+delta); } };
    add(amount);
    let settled = false;
    return {max,limited:max < requested,settle(actual) { if (!settled) { settled = true; add(actual-amount); } }};
  }
  function record(value) { logs.push(value); if (logs.length > 500) logs.shift(); }
  function publicState() { return {...state,mock:true,session:sessionFor(state),accounts:Object.keys(ACCOUNTS),scenarios:SCENARIOS}; }
  function authenticate(req, admin = false) {
    requireThat(sessionFor(state) && req.headers.authorization === `Bearer ${sessionFor(state).access_token}`,'login',401);
    const account = ACCOUNTS[state.account];
    requireThat(!admin || account.admin,'admin',403);
    requireThat(admin || account.bound,'profile',403);
    return account;
  }
  function stream(req, res, payload, account, meta) {
    const model = database.models.find(row => row.id === payload.model_id), provider = model && database.providers.find(row => row.id === model.provider_id);
    requireThat(uuid(payload.model_id) && model?.enabled && provider?.enabled,'model');
    const input = payload.action === 'admin_test' && payload.input === undefined ? [{role:'user',content:[{type:'input_text',text:text(payload.prompt,500000) || 'Reply with MOCK OK.'}]}] : payload.input;
    Object.assign(meta,validateInput(input,model));
    if (payload.action !== 'admin_test' && payload.max_output_tokens !== undefined) integer(payload.max_output_tokens,1,model.max_output_tokens);
    const requested = payload.action === 'admin_test'
      ? integer(payload.max_output_tokens,1,model.max_output_tokens,model.default_max_output_tokens)
      : model.default_max_output_tokens;
    const effort = payload.reasoning_effort == null ? model.default_reasoning_effort : text(payload.reasoning_effort,40,true);
    requireThat(!blacklist.has(account.id),'blacklisted',403);
    requireThat(!leases.has(account.id),'busy',409);
    const inputEstimate = estimateInputTokens(input);
    const reservation = reserve(account.id,inputEstimate,requested), max = reservation.max;
    const scenario = state.scenario, requestId = meta.request_id;
    Object.assign(meta,{model_id:model.id,max_output_tokens:max,reasoning_effort:effort == null ? null : model.reasoning_efforts.includes(effort) ? effort : 'custom',scenario,protocol:endpointProtocol(new URL(provider.base_url).pathname)});
    const usage = {request_id:requestId,user_id:account.id,member_name:account.member_name,username:account.username || account.email || account.id,provider_name:provider.label || provider.name,model_name:model.display_name,action:payload.action,provider_id:provider.id,model_id:model.id,model_key:model.model_key,input_bytes:meta.request_bytes,max_output_tokens:max,reasoning_effort:meta.reasoning_effort,status:'upstream_started',upstream_status:200,input_tokens:null,output_tokens:null,total_tokens:null,error_code:null,started_at:new Date().toISOString(),finished_at:null};
    database.usage.unshift(usage);
    if (database.usage.length > 1000) database.usage.pop();
    let timer, ended = false;
    const finish = (status, error = null) => {
      if (ended) return;
      ended = true; clearInterval(timer); leases.delete(account.id);
      Object.assign(usage,{status,error_code:error,finished_at:new Date().toISOString()});
      Object.assign(meta,{outcome:status,finished_at:usage.finished_at});
    };
    leases.set(account.id,{cancel:() => { finish('cancelled','environment_reset'); res.destroy(); }});
    res.on('close',() => finish('cancelled','client_cancelled'));
    res.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-cache, no-transform','x-chat-request-id':requestId,'x-chat-max-output-tokens':String(max),...(reservation.limited ? {'x-chat-quota-limited':'true'} : {}),'connection':'keep-alive'});
    res.flushHeaders();
    const event = data => { if (!res.destroyed) res.write(`event: ${data.type}\r\ndata: ${JSON.stringify(data)}\r\n\r\n`); };
    event({type:'response.created',response:{id:`mock-${requestId}`,object:'response',status:'in_progress',output:[]}});
    const turn = meta.roles.user;
    const answer = `**MOCK / 本地模拟**\n\n第 ${turn} 轮；已收到 ${meta.roles.assistant} 条 assistant 历史。\n\n文本片段 ${meta.parts.input_text}，图片 ${meta.parts.input_image}，原生 PDF ${meta.parts.input_file}。\n\n- 场景：${scenario}\n- 此内容由 fixture 生成，无线上模型调用。\n\n\`\`\`js\nconsole.log('mock only');\n\`\`\`\n\n[本地设置](/setup)\n\n<script>MOCK_UNSAFE_HTML</script>\n`;
    // This fixture uses a synthetic byte/3 tokenizer, not a provider tokenizer.
    const answerTokens = Math.ceil(Buffer.byteLength(answer)/3);
    const outputText = answerTokens <= max ? answer : answer.slice(0,Math.max(1,Math.floor(answer.length*max/answerTokens)));
    const chunks = outputText.match(/[\s\S]{1,18}/g);
    let index = 0, collected = '';
    timer = setInterval(() => {
      if (ended) return;
      if (index < chunks.length) { const delta = chunks[index++]; collected += delta; event({type:'response.output_text.delta',output_index:0,content_index:0,delta}); }
      if (scenario === 'interrupted' && index >= 3) { finish('incomplete','upstream_eof'); res.end(); return; }
      if (index < chunks.length) return;
      const terminal = scenario === 'slow' ? 'completed' : scenario;
      const tokens = {input_tokens:Math.ceil(meta.text_bytes / 3) + meta.attachment_count * 32,output_tokens:Math.min(max,Math.ceil(Buffer.byteLength(collected) / 3))};
      tokens.total_tokens = tokens.input_tokens + tokens.output_tokens;
      const output = [{id:`mock-message-${requestId}`,type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:collected,annotations:[]}]}];
      Object.assign(usage,tokens);
      reservation.settle(tokens.total_tokens);
      finish(terminal,terminal === 'completed' ? null : `response.${terminal}`);
      event({type:`response.${terminal}`,response:{id:`mock-${requestId}`,object:'response',status:terminal,output,usage:tokens,...(terminal === 'incomplete' ? {incomplete_details:{reason:'max_output_tokens'}} : {}),...(terminal === 'failed' ? {error:{code:'mock_failure',message:'MOCK simulated failure'}} : {})}});
      res.end('data: [DONE]\r\n\r\n');
    }, scenario === 'slow' ? 1500 : 25);
  }
  async function chat(req,res) {
    requireThat(req.method === 'POST','method',405);
    const {payload,bytes} = await body(req);
    payload.action = ACTION_ALIASES.get(payload.action) ?? payload.action;
    const meta = {mock:true,request_id:randomUUID(),started_at:new Date().toISOString(),endpoint:'chat',action:ACTIONS.includes(payload.action) ? payload.action : 'unknown',account:state.account,request_bytes:bytes,outcome:'received'};
    record(meta);
    try {
      requireThat(ACTIONS.includes(payload.action),'action');
      const account = authenticate(req,payload.action.startsWith('admin_'));
      meta.user_id = account.id;
      if (PROXY_ACTIONS.includes(payload.action)) { const result = proxyAdmin(payload); meta.outcome = 'ok'; json(res,result); return; }
      if (['respond','admin_test'].includes(payload.action)) { stream(req,res,payload,account,meta); return; }
      let result;
      switch (payload.action) {
        case 'quota': keys(payload,['action']); result = snapshot(account.id); break;
        case 'admin_user_directory':
          keys(payload,['action']);
          result = {users:Object.values(ACCOUNTS).filter(Boolean).map(account => ({user_id:account.id,username:account.email,member_name:account.member_name,bound:account.bound})),blacklist:[...blacklist].map(([user_id,reason]) => ({user_id,reason}))}; break;
        case 'admin_blacklist_list': keys(payload,['action']); result = {blacklist:[...blacklist].map(([user_id,reason]) => ({user_id,reason}))}; break;
        case 'admin_set_blacklist': {
          keys(payload,['action','user_id','blocked','reason']); const id = target(payload.user_id,false);
          requireThat(typeof payload.blocked === 'boolean'); const reason = text(payload.reason,1000);
          if (payload.blocked) blacklist.set(id,reason); else blacklist.delete(id);
          result = snapshot(id); break;
        }
        case 'admin_quota_get': keys(payload,['action','user_id']); result = snapshot(target(payload.user_id)); break;
        case 'admin_quota_save': {
          keys(payload,['action','user_id','daily_limit','weekly_limit','monthly_limit','expected_version']);
          const id = target(payload.user_id), current = id === null ? globalQuota : userSetting(id);
          const version = integer(payload.expected_version,0,Number.MAX_SAFE_INTEGER);
          const daily_limit = quotaLimit(payload.daily_limit);
          const weekly_limit = quotaLimit(id === null ? payload.weekly_limit ?? null : payload.weekly_limit), monthly_limit = quotaLimit(id === null ? payload.monthly_limit ?? null : payload.monthly_limit);
          requireThat(id !== null || (weekly_limit === null && monthly_limit === null));
          requireThat(version === current.version,'conflict',409);
          const setting = {daily_limit,version:version+1};
          if (id === null) globalQuota = setting; else userQuotas.set(id,{...setting,weekly_limit,monthly_limit});
          result = snapshot(id); break;
        }
        case 'catalog': requireThat(!blacklist.has(account.id),'blacklisted',403); result = {models:database.models.filter(model => model.enabled && database.providers.some(provider => provider.id === model.provider_id && provider.enabled)).map(({provider_id,model_key,enabled,...model}) => model),bound:true,member_name:account.member_name,quota:snapshot(account.id)}; break;
        case 'custom_model_list': {
          keys(payload,['action']);
          result = [...customModels.values()].filter(row => row.user_id === account.id).map(({user_id,...row}) => row);
          break;
        }
        case 'custom_model_save': {
          keys(payload,['action','id','display_name','model_key','base_url','expected_version']);
          requireThat(uuid(payload.id));
          requireThat(!Object.hasOwn(payload,'api_key'),'input');
          requireThat(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/.test(String(payload.model_key ?? '').trim()),'input');
          const baseUrl = text(payload.base_url,512,true);
          requireThat(/^https:\/\/jgezpvmlnhycxslqbwcx\.supabase\.co\/functions\/v1\/chat-api-proxy\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?:\/v1)?(?:\/(?:responses|messages|message|chat\/completions))?\/?$/i.test(baseUrl),'proxy_url');
          const version = integer(payload.expected_version,0,Number.MAX_SAFE_INTEGER);
          const existing = customModels.get(payload.id);
          requireThat(!existing || existing.user_id === account.id,'input',403);
          requireThat((existing?.version ?? 0) === version,'conflict',409);
          const timestamp = now().toISOString();
          const row = {id:payload.id,user_id:account.id,display_name:text(payload.display_name,120,true),model_key:payload.model_key.trim(),base_url:baseUrl.replace(/\/+$/,''),version:(existing?.version ?? 0)+1,created_at:existing?.created_at || timestamp,updated_at:timestamp};
          customModels.set(row.id,row);
          const {user_id,...visible} = row;
          result = visible; break;
        }
        case 'custom_model_delete': {
          keys(payload,['action','id','expected_version']);
          requireThat(uuid(payload.id));
          const version = integer(payload.expected_version,0,Number.MAX_SAFE_INTEGER);
          const existing = customModels.get(payload.id);
          if (!existing || existing.user_id !== account.id) { result = {code:'not_found'}; break; }
          requireThat(existing.version === version,'conflict',409);
          customModels.delete(payload.id);
          result = {deleted:true,id:payload.id}; break;
        }
        case 'admin_get': result = {
          providers: database.providers.filter(row => !row.deleted_at),
          models: database.models.filter(row => !row.deleted_at).map(model => ({...model,model_id:model.model_key,version:Date.parse(model.updated_at) || 0}))
        }; break;
        case 'admin_save_provider': result = {provider:upsert(database.providers,providerConfig(payload))}; break;
        case 'admin_save_model': result = {model:upsert(database.models,modelConfig(payload,database.providers))}; break;
        case 'admin_delete_provider': {
          keys(payload,['action','id']);
          requireThat(uuid(payload.id),'input');
          const provider = database.providers.find(row => row.id === payload.id);
          requireThat(provider,'not_found',404);
          requireThat(!provider.deleted_at,'deleted',409);
          const stamp = now().toISOString();
          const affected = database.models.filter(row => row.provider_id === provider.id && !row.deleted_at);
          for (const model of affected) Object.assign(model,{enabled:false,deleted_at:stamp,updated_at:stamp});
          Object.assign(provider,{enabled:false,deleted_at:stamp,updated_at:stamp});
          result = {result:{deleted:true,id:provider.id,name:provider.name,models:affected.length}};
          break;
        }
        case 'admin_delete_model': {
          keys(payload,['action','id','expected_version']);
          requireThat(uuid(payload.id),'input');
          const model = database.models.find(row => row.id === payload.id);
          requireThat(model,'not_found',404);
          requireThat(!model.deleted_at,'deleted',409);
          requireThat(integer(payload.expected_version,0,Number.MAX_SAFE_INTEGER) === (Date.parse(model.updated_at) || 0),'conflict',409);
          const stamp = now().toISOString();
          Object.assign(model,{enabled:false,deleted_at:stamp,updated_at:stamp});
          result = {result:{deleted:true,id:model.id,model_key:model.model_key}};
          break;
        }
        case 'admin_usage': {
          const page = integer(payload.page,1,100000,1), pageSize = integer(payload.pageSize ?? payload.limit,1,200,50);
          const iso = value => { if (value == null || value === '') return null; const date = new Date(value); requireThat(!Number.isNaN(date.getTime())); return date.toISOString(); };
          const from = iso(payload.from), to = iso(payload.to); requireThat(!from || !to || from <= to);
          const rows = database.usage.filter(row => (!from || row.started_at >= from) && (!to || row.started_at <= to));
          result = {usage:rows.slice((page-1)*pageSize,page*pageSize),page,pageSize,total:rows.length}; break;
        }
      }
      meta.outcome = 'ok'; meta.finished_at = new Date().toISOString(); json(res,result);
    } catch (error) { meta.outcome = error instanceof MockError ? error.message : 'server'; meta.finished_at = new Date().toISOString(); throw error; }
  }
  async function staticFile(req,res,pathname,origin) {
    let base = PUBLIC, relative = pathname.slice(1);
    if (pathname === '/setup' || pathname === '/setup/') { base = FIXTURES; relative = 'setup.html'; }
    else if (pathname.startsWith('/fixtures/')) { base = FIXTURES; relative = pathname.slice('/fixtures/'.length); }
    const target = path.resolve(base,relative);
    const inside = candidate => candidate.startsWith(base + path.sep);
    requireThat(inside(target),'not_found',404);
    const real = await realpath(target).catch(() => null);
    requireThat(real && inside(real),'not_found',404);
    const info = await stat(real); requireThat(info.isFile(),'not_found',404);
    let data = await readFile(real);
    const ext = path.extname(real).toLowerCase();
    if (base === PUBLIC && ['.js','.mjs'].includes(ext)) data = Buffer.from(rewriteJS(data.toString('utf8'),origin));
    if (base === PUBLIC && ['chat.html','chat-admin.html'].includes(relative)) {
      let html = data.toString('utf8');
      const sdk = /<script\b[^>]*\bsrc=["']https:\/\/[^"']*supabase-js[^"']*["'][^>]*>\s*<\/script>/gi;
      requireThat(sdk.test(html),'sdk_reference_changed',500); sdk.lastIndex = 0;
      html = html.replace(sdk,'<script src="/fixtures/mock-supabase.js"></script>');
      data = Buffer.from(html);
    }
    res.writeHead(200,{'content-type':MIME[ext] || 'application/octet-stream','content-length':data.length});
    res.end(req.method === 'HEAD' ? undefined : data);
  }
  const server = http.createServer(async (req,res) => {
    res.setHeader('cache-control','no-store'); res.setHeader('x-chat-mock','true');
    res.setHeader('content-security-policy',CSP); res.setHeader('x-content-type-options','nosniff'); res.setHeader('referrer-policy','no-referrer');
    try {
      const host = req.headers.host || '';
      const allowedPort = testPort ? server.address()?.port : PORT;
      requireThat([`localhost:${allowedPort}`,`127.0.0.1:${allowedPort}`].includes(host),'localhost_only',403);
      const origin = `http://${host}`;
      requireThat(!req.headers.origin || req.headers.origin === origin,'cors',403);
      requireThat(!req.headers['sec-fetch-site'] || ['same-origin','none'].includes(req.headers['sec-fetch-site']),'cors',403);
      const pathname = decodeURIComponent(new URL(req.url,origin).pathname);
      if (req.method === 'OPTIONS') { res.writeHead(204,{'allow':'GET, HEAD, POST, OPTIONS'}); res.end(); return; }
      if (pathname === '/') { res.writeHead(302,{location:'/setup'}); res.end(); return; }
      const proxyPath = pathname.match(/^\/(?:functions\/v1|mock)\/chat-api-proxy\/([0-9a-f-]+)\/v1\/(responses|messages|message|chat\/completions)$/i);
      if (proxyPath && uuid(proxyPath[1])) { await proxy(req,res,proxyPath[1],endpointProtocol(proxyPath[2])); return; }
      if (/^\/(?:functions\/v1|mock)\/chat-api-proxy(?:\/|$)/.test(pathname)) throw new MockError('not_found',404);
      if (pathname === '/mock/chat') { await chat(req,res); return; }
      if (pathname === '/mock/session' && req.method === 'GET') { json(res,publicState()); return; }
      if (pathname === '/mock/requests' && req.method === 'GET') { json(res,{mock:true,requests:logs}); return; }
      if (pathname === '/mock/setup' && req.method === 'POST') {
        const {payload} = await body(req); keys(payload,['account','scenario','theme','reset','contextWindow']);
        requireThat(Object.hasOwn(ACCOUNTS,payload.account) && SCENARIOS.includes(payload.scenario) && ['auto','light','dark'].includes(payload.theme));
        // 可选：把模拟模型的上下文窗口调小，用于在本地复现自动压缩阈值。
        if (payload.contextWindow !== undefined) requireThat(Number.isInteger(payload.contextWindow) && payload.contextWindow >= 256 && payload.contextWindow <= 1000000);
        if (payload.contextWindow !== undefined) state.contextWindow = payload.contextWindow;
        if (payload.contextWindow !== undefined) database = seed(payload.contextWindow);
        if (payload.reset) { for (const lease of [...leases.values(),...proxyLeases.values()]) lease.cancel(); proxyRoutes = []; proxyKeys = []; database = seed(state.contextWindow || 32768); resetQuotas(); logs.length = 0; }
        if (state.account !== payload.account || payload.reset) state.revision++;
        Object.assign(state,{account:payload.account,scenario:payload.scenario,theme:payload.theme});
        json(res,publicState()); return;
      }
      if (pathname === '/mock/club-drive' && req.method === 'POST') {
        const {payload} = await body(req);
        record({mock:true,request_id:randomUUID(),endpoint:'club-drive',action:['site_service_status','member_theme_get','member_theme_set','staff_access_get'].includes(payload.action) ? payload.action : 'unknown',account:state.account,started_at:new Date().toISOString()});
        if (payload.action === 'site_service_status') { json(res,{enabled:true,feature_settings:{},mock:true}); return; }
        if (payload.action === 'member_theme_get' || payload.action === 'member_theme_set') {
          requireThat(sessionFor(state) && req.headers.authorization === `Bearer ${sessionFor(state).access_token}`,'login',401);
          if (payload.action === 'member_theme_set') { requireThat(['auto','light','dark'].includes(payload.themeMode)); state.theme = payload.themeMode; }
          json(res,{theme_mode:state.theme,mock:true}); return;
        }
        if (payload.action === 'staff_access_get') { const account = authenticate(req); json(res,{isSuperAdmin:account.admin,permissions:{},mock:true}); return; }
        throw new MockError('action');
      }
      requireThat(['GET','HEAD'].includes(req.method),'method',405);
      await staticFile(req,res,pathname,origin);
    } catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      json(res,{error:error instanceof MockError ? error.message : error instanceof URIError ? 'input' : 'server',mock:true},error instanceof MockError ? error.status : error instanceof URIError ? 400 : 500);
    }
  });
  server.on('close',() => { for (const lease of [...leases.values(),...proxyLeases.values()]) lease.cancel(); });
  return server;
}

async function selfTest() {
  const providerBase = 'https://mock-provider.example.com';
  for (const [suffix,protocol] of [['','responses'],['/v1','responses'],['/responses','responses'],['/messages','messages'],['/message','messages'],['/chat/completions','chat-completions']]) {
    for (const prefix of ['', '/gateway/v1']) {
      const base_url = providerBase+prefix+suffix;
      assert.equal(providerConfig({name:'mock',base_url,secret_name:'CHAT_KEY_MOCK'}).base_url,base_url);
      assert.equal(endpointProtocol(new URL(base_url).pathname),protocol);
      assert.equal(new URL(endpointURL(base_url)).pathname,`${(prefix+suffix).replace(/\/(responses|messages|message|chat\/completions)$/,'')}/${protocol === 'chat-completions' ? 'chat/completions' : protocol}`);
      assert.equal(new URL(endpointURL(base_url,'messages')).pathname,`${(prefix+suffix).replace(/\/(responses|messages|message|chat\/completions)$/,'')}/messages`);
    }
  }
  assert.equal(endpointProtocol('/v1/messages/extra'),'responses','infer exact terminal endpoint only');
  assert.equal(endpointProtocol('/v1/chat/completions/extra'),'responses');
  for (const base_url of ['http://mock-provider.example.com/v1/messages','https://localhost/v1/responses','https://mock-provider.example.com/v1/message?key=x','https://mock-provider.example.com/v1/chat/completions#fragment','https://user:password@mock-provider.example.com/v1/responses']) assert.throws(() => providerConfig({name:'mock',base_url,secret_name:'CHAT_KEY_MOCK'}),/provider_url/);
  let clock = new Date('2026-10-18T23:59:00Z');
  const server = createMockServer({testPort:true,now:() => clock});
  await new Promise((resolve,reject) => { server.once('error',reject); server.listen(0,'127.0.0.1',resolve); });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const localFetch = (url, options = {}) => fetch(url,options);
    const get = resource => localFetch(base + resource);
    const setup = async (account,scenario = 'completed',reset = false) => (await localFetch(base+'/mock/setup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({account,scenario,theme:'dark',reset})})).json();
    let state = await setup('member');
    const post = (payload,token = state.session?.access_token) => localFetch(base+'/mock/chat',{method:'POST',headers:{'content-type':'application/json',...(token ? {authorization:`Bearer ${token}`} : {})},body:JSON.stringify(payload)});
    assert.equal((await localFetch(base+'/setup')).status,200);
    for (const resource of ['/chat.html','/chat-admin.html']) {
      const response = await localFetch(base + resource), html = await response.text();
      assert.match(html,/\/fixtures\/mock-supabase.js/); assert.doesNotMatch(html,/src=["']https:[^"']*supabase-js/);
      assert.match(response.headers.get('content-security-policy'),/connect-src 'self'/);
    }
    for (const resource of ['/chat.js','/chat-admin.js','/theme.js','/member-identity.js','/service-gate.js']) {
      const source = await (await localFetch(base + resource)).text(); assert.doesNotMatch(source,/https:\/\/[a-z0-9-]+\.supabase\.co/i);
      if (resource.startsWith('/chat')) assert.match(source,/\/mock\/chat/);
    }
    for (const resource of ['setup.js','setup.css','mock-supabase.js','sample.txt','sample.png','sample.pdf','image-only.pdf']) assert.equal((await localFetch(base+'/fixtures/'+resource)).status,200);
    const catalog = await (await post({action:'catalog'})).json(); assert.equal(catalog.bound,true); assert.equal(catalog.models.length,2);
    for (const action of ACTIONS.filter(action => action.startsWith('admin_'))) assert.equal((await post({action})).status,403);
    for (const action of [...ACTION_ALIASES.keys(),...ACTION_ALIASES.values()]) assert.equal((await post({action})).status,403);
    const input = [{role:'user',content:[{type:'input_text',text:'HTTP fixture check'}]}];
    const request = {action:'respond',model_id:MODEL_ID,input,max_output_tokens:512};
    const {readResponses,continuation} = await import('../public/chat-core.js');
    let result = await readResponses((await post(request)).body,()=>{}); assert.equal(result.status,'success');
    const second = await readResponses((await post({...request,input:[...input,...continuation(result.output,false),...input]})).body,()=>{});
    assert.equal(second.status,'success'); assert.match(second.text,/第 2 轮/);
    const png = await readFile(path.join(FIXTURES,'sample.png')), pdf = await readFile(path.join(FIXTURES,'image-only.pdf'));
    const attachments = [{role:'user',content:[{type:'input_text',text:'upload fixtures'},{type:'input_image',image_url:`data:image/png;base64,${png.toString('base64')}`,detail:'auto'},{type:'input_file',filename:'image-only.pdf',file_data:`data:application/pdf;base64,${pdf.toString('base64')}`}]}];
    result = await readResponses((await post({...request,input:attachments})).body,()=>{}); assert.equal(result.status,'success'); assert.match(result.text,/图片 1，原生 PDF 1/);
    assert.equal((await post({...request,model_id:catalog.models[1].id,input:attachments})).status,400);
    assert.equal((await post({...request,max_output_tokens:999999})).status,400);
    for (const [scenario,status] of [['incomplete','incomplete'],['interrupted','interrupted'],['failed','failure']]) {
      state = await setup('member',scenario); result = await readResponses((await post(request)).body,()=>{}); assert.equal(result.status,status);
    }
    state = await setup('member','slow');
    const controller = new AbortController();
    const slow = await localFetch(base+'/mock/chat',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${state.session.access_token}`},body:JSON.stringify(request),signal:controller.signal});
    const reader = slow.body.getReader(); await reader.read();
    assert.equal((await post(request)).status,409);
    controller.abort(); await reader.cancel().catch(()=>{});
    await new Promise(resolve => setTimeout(resolve,80));
    state = await setup('member'); result = await readResponses((await post(request)).body,()=>{}); assert.equal(result.status,'success');
    const oldToken = state.session.access_token; state = await setup('member2'); assert.equal((await post({action:'catalog'},oldToken)).status,401);
    state = await setup('unbound'); assert.equal((await post({action:'catalog'})).status,403);
    state = await setup('loggedout'); assert.equal((await post({action:'catalog'})).status,401);
    state = await setup('admin');
    const fixedUsage = (await (await post({action:'admin_usage',page:1,pageSize:1})).json()).usage.find(item => item.action === 'respond');
    assert.equal(fixedUsage.max_output_tokens,512,'member budget must stay at the configured default');
    const provider = {action:'save_provider',name:'created',label:'MOCK created',base_url:'https://mock-provider.example.com/v1',secret_name:'CHAT_KEY_MOCK_CREATED',enabled:true};
    let saved = await (await post(provider)).json(); assert.ok(uuid(saved.provider.id));
    const providerId = saved.provider.id;
    assert.equal((await post({...provider,action:'admin_save_provider',id:providerId,label:'MOCK updated'})).status,200);
    const model = {action:'save_model',provider_id:providerId,model_key:'mock-created',display_name:'MOCK created',introduction:'Created model for local checks.',context_window:2048,max_output_tokens:512,default_max_output_tokens:128,reasoning_efforts:[],supports_images:false,supports_pdf:false};
    saved = await (await post(model)).json(); assert.ok(uuid(saved.model.id));
    assert.equal(saved.model.introduction, model.introduction);
    const modelId = saved.model.id;
    result = await readResponses((await post({action:'test',model_id:modelId,prompt:'test',max_output_tokens:128})).body,()=>{}); assert.equal(result.status,'success');
    assert.equal((await post({...model,action:'admin_save_model',id:modelId,enabled:false})).status,200);
    result = await readResponses((await post({action:'admin_test',model_id:MODEL_ID,prompt:'test',max_output_tokens:128})).body,()=>{}); assert.equal(result.status,'success');
    const usage = await (await post({action:'usage',page:1,pageSize:2})).json(); assert.equal(usage.usage.length,2); assert.ok(usage.total >= 7);
    const canonicalUsage = await (await post({action:'admin_usage',page:1,pageSize:2})).json(); assert.deepEqual(canonicalUsage,usage);
    const row = usage.usage.find(item => item.model_id === modelId);
    assert.ok(row);
    assert.equal(row.username,ACCOUNTS.admin.email); assert.equal(row.member_name,ACCOUNTS.admin.member_name);
    assert.equal(row.provider_name,'MOCK updated'); assert.equal(row.model_name,model.display_name);
    assert.equal(row.provider_id,providerId); assert.equal(row.model_key,model.model_key);
    assert.equal(row.action,'admin_test'); assert.equal(row.status,'completed');
    assert.ok(row.request_id && row.started_at && row.finished_at); assert.ok(row.total_tokens > 0);
    for (const suffix of ['responses','messages','message','chat/completions']) {
      assert.equal((await post({...provider,id:PROVIDER_ID,base_url:`${providerBase}/v1/${suffix}`,auth_header:suffix.startsWith('message') ? 'x-api-key' : 'authorization'})).status,200);
      const normalized = await readResponses((await post({action:'admin_test',model_id:MODEL_ID,prompt:'native fixture'})).body,()=>{});
      assert.equal(normalized.status,'success','internal endpoint inference preserves Responses UI contract');
      const recent = (await (await get('/mock/requests')).json()).requests.at(-1);
      assert.equal(recent.protocol,endpointProtocol(suffix));
    }
    const logs = await (await get('/mock/requests')).json();
    for (const action of ACTION_ALIASES.values()) {
      assert.ok(logs.requests.some(item => item.action === action && item.account === 'member' && item.outcome === 'admin'));
      assert.ok(logs.requests.some(item => item.action === action && item.account === 'admin' && ['ok','completed'].includes(item.outcome)));
    }
    assert.ok(logs.requests.some(item => item.action === 'admin_test' && item.model_id === modelId && item.parts.input_text === 1));
    assert.ok(logs.requests.some(row => row.outcome === 'cancelled'));
    assert.ok(logs.requests.some(row => row.roles?.assistant === 1));
    assert.doesNotMatch(JSON.stringify(logs),/authorization|apikey|access_token|HTTP fixture check|CHAT_KEY_MOCK_CREATED/);
    assert.equal((await localFetch(base+'/mock/setup',{method:'POST',headers:{origin:'https://example.com','content-type':'application/json'},body:'{}'})).status,403);
    assert.equal((await get('/fixtures/%2e%2e%2f%2e%2e%2fAGENTS.md')).status,404);
    state = await setup('admin','completed',true);
    const directory = await (await post({action:'admin_user_directory'})).json();
    assert.equal(directory.users.length,4); assert.deepEqual(directory.blacklist,[]);
    assert.ok(directory.users.every(user => uuid(user.user_id) && user.username && typeof user.bound === 'boolean'));
    const memberId = ACCOUNTS.member.id;
    const saveQuota = (user_id,daily_limit,weekly_limit,monthly_limit,expected_version) => post({action:'admin_quota_save',user_id,daily_limit,weekly_limit,monthly_limit,expected_version});
    assert.equal((await post({action:'admin_quota_get',user_id:ACCOUNTS.member.email})).status,400);
    for (const value of [-1,1.5,1e12+1,'10']) assert.equal((await saveQuota(memberId,value,null,null,0)).status,400);
    let quota = await (await saveQuota(memberId,1e12,null,null,0)).json(); assert.equal(quota.user.daily_limit,1e12);
    assert.equal((await saveQuota(memberId,null,null,null,0)).status,409);
    quota = await (await saveQuota(memberId,null,80,100,1)).json(); assert.equal(quota.user.version,2);
    assert.equal((await post({action:'admin_quota_save',daily_limit:200,expected_version:0})).status,200);
    assert.equal((await saveQuota(null,null,1,null,1)).status,400);
    state = await setup('member');
    assert.equal((await post({action:'quota',user_id:ACCOUNTS.admin.id})).status,400);
    quota = await (await post({action:'quota'})).json();
    assert.equal(quota.global.daily_limit,200); assert.equal(quota.periods[1].remaining,80);
    assert.deepEqual(quota.periods.map(period => period.resets_at),['2026-10-19T00:00:00.000Z','2026-10-19T00:00:00.000Z','2026-11-01T00:00:00.000Z']);
    const limited = await post(request);
    assert.equal(limited.headers.get('x-chat-quota-limited'),'true');
    assert.equal(Number(limited.headers.get('x-chat-max-output-tokens')),80-estimateInputTokens(input));
    await readResponses(limited.body,()=>{});
    quota = await (await post({action:'quota'})).json(); assert.ok(quota.periods[1].used > 0 && quota.periods[1].used <= 80);
    clock = new Date('2026-10-19T00:00:00Z');
    quota = await (await post({action:'quota'})).json(); assert.equal(quota.global.used,0); assert.equal(quota.periods[1].used,0); assert.ok(quota.periods[2].used > 0);
    clock = new Date('2026-11-01T00:00:00Z');
    quota = await (await post({action:'quota'})).json(); assert.equal(quota.periods[2].used,0);
    state = await setup('admin');
    await saveQuota(memberId,0,null,null,2);
    state = await setup('member'); assert.equal((await post(request)).status,429); assert.equal((await post({action:'catalog'})).status,200);
    state = await setup('admin');
    await saveQuota(memberId,null,null,null,3);
    await saveQuota(null,0,null,null,1);
    assert.equal((await post({action:'admin_test',model_id:MODEL_ID,prompt:'test'})).status,429);
    await saveQuota(null,null,null,null,2);
    await saveQuota(ACCOUNTS.admin.id,50,null,null,0);
    const adminLimited = await post({action:'admin_test',model_id:MODEL_ID,prompt:'test'});
    assert.equal(adminLimited.headers.get('x-chat-quota-limited'),'true');
    const adminResult = await readResponses(adminLimited.body,()=>{});
    quota = await (await post({action:'quota'})).json();
    assert.equal(quota.periods[0].used,adminResult.usage.total_tokens,'completed usage settles instead of retaining reservation');
    await saveQuota(ACCOUNTS.admin.id,null,null,null,1);
    state = await setup('member','interrupted');
    await readResponses((await post(request)).body,()=>{});
    quota = await (await post({action:'quota'})).json();
    assert.equal(quota.periods[0].used,estimateInputTokens(input)+512,'EOF without usage keeps the full reservation');
    state = await setup('admin');
    await post({action:'admin_set_blacklist',user_id:memberId,blocked:true,reason:'MOCK policy'});
    const blocked = await (await post({action:'admin_blacklist_list'})).json(); assert.deepEqual(blocked.blacklist,[{user_id:memberId,reason:'MOCK policy'}]);
    state = await setup('member');
    assert.equal((await post({action:'catalog'})).status,403); assert.equal((await post(request)).status,403);
    quota = await (await post({action:'quota'})).json(); assert.equal(quota.blacklisted,true); assert.equal(quota.reason,'MOCK policy');
    state = await setup('admin');
    await post({action:'admin_set_blacklist',user_id:ACCOUNTS.admin.id,blocked:true});
    assert.equal((await post({action:'admin_test',model_id:MODEL_ID,prompt:'test'})).status,403);
    assert.equal((await post({action:'admin_quota_get'})).status,200,'blocked admins retain management access');
    state = await setup('member','completed',true); assert.equal((await (await get('/mock/requests')).json()).requests.length,0);
    quota = await (await post({action:'quota'})).json(); assert.equal(quota.global.version,0); assert.equal(quota.global.daily_limit,null); assert.equal(quota.global.used,0); assert.equal(quota.user.version,0); assert.equal(quota.blacklisted,false);
    state = await setup('admin');
    assert.equal(rewriteJS('https://abc.supabase.co/functions/v1/chat-api-proxy/route/v1',base),base+'/mock/chat-api-proxy/route/v1');
    assert.deepEqual(await (await post({action:'admin_proxy_list'})).json(),{routes:[],keys:[]});
    const routeInput = {action:'admin_proxy_save',id:null,name:'MOCK external',base_url:'https://mock-provider.example.com/v1',secret_name:'CHAT_KEY_MOCK_PROXY',enabled:true,expected_version:0};
    for (const patch of [{expected_version:1},{secret_name:'sk-native'},{enabled:'true'},{base_url:'https://mock-provider.example.com/v1/response'}]) assert.ok((await post({...routeInput,...patch})).status >= 400);
    let route = (await (await post(routeInput)).json()).route;
    assert.deepEqual(Object.keys(route).sort(),['id','name','base_url','secret_name','enabled','version','created_at','updated_at'].sort());
    assert.equal(route.version,1);
    assert.equal((await post({...routeInput,id:route.id,expected_version:0})).status,409);
    route = (await (await post({...routeInput,id:route.id,name:'MOCK updated',expected_version:1})).json()).route;
    assert.equal(route.version,2);
    const issued = await (await post({action:'admin_proxy_key_create',route_id:route.id,label:'MOCK client'})).json();
    assert.match(issued.api_key,/^cap_[A-Za-z0-9_-]{43}$/); assert.equal(Buffer.from(issued.api_key.slice(4),'base64url').length,32);
    assert.deepEqual(Object.keys(issued.key).sort(),['id','route_id','label','key_prefix','key_last4','enabled','revoked_at','version','created_at'].sort());
    const endpoint = `/functions/v1/chat-api-proxy/${route.id}/v1/responses`;
    const proxyRequest = (payload = {model:'client-model-unchanged',input:'mock only'}, apiKey = issued.api_key, resource = endpoint, options = {}) => localFetch(base+resource,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${apiKey}`},body:JSON.stringify(payload),...options});
    assert.equal((await proxyRequest(undefined,'cap_'+'x'.repeat(43))).status,401);
    assert.equal((await proxyRequest(undefined,state.session.access_token)).status,401);
    for (const suffix of ['models','responses/id','response','messages/id','chat/completions/id','v1/responses']) assert.equal((await proxyRequest(undefined,issued.api_key,endpoint.replace(/responses$/,suffix))).status,404);
    assert.equal((await localFetch(base+endpoint)).status,405);
    let proxyResult = await (await proxyRequest()).json(); assert.equal(proxyResult.model,'client-model-unchanged');
    assert.equal((await proxyRequest(undefined,issued.api_key,endpoint.replace('/functions/v1/','/mock/'))).status,200);
    const clubBase = `https://jgezpvmlnhycxslqbwcx.supabase.co/functions/v1/chat-api-proxy/${route.id}`;
    for (const prefix of ['', '/v1']) {
      for (const suffix of ['', '/responses','/messages','/message','/chat/completions']) {
        const custom = {action:'custom_model_save',id:randomUUID(),display_name:'MOCK custom',model_key:'custom-model',base_url:clubBase+prefix+suffix,expected_version:0};
        const response = await post(custom); assert.equal(response.status,200);
        assert.equal((await response.json()).base_url,custom.base_url);
      }
    }
    for (const suffix of ['/response','/models','/v1/v1/messages','/messages/extra','?key=x','#fragment']) {
      assert.equal((await post({action:'custom_model_save',id:randomUUID(),display_name:'bad',model_key:'custom',base_url:clubBase+suffix,expected_version:0})).status,400);
    }
    const nativePayload = {model:'native-model-unchanged',messages:[{role:'user',content:'mock only'}],max_tokens:32};
    const nativeRequest = (resource,payload = nativePayload,headers = {authorization:`Bearer ${issued.api_key}`}) => localFetch(base+resource,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(payload)});
    for (const prefix of ['/functions/v1','/mock']) {
      for (const version of ['', '/v1']) {
        for (const suffix of ['responses','messages','message','chat/completions']) {
          const resource = `${prefix}/chat-api-proxy/${route.id}${version}/${suffix}`, protocol = endpointProtocol(suffix);
          const payload = protocol === 'responses' ? {model:'native-model-unchanged',input:'mock only'} : nativePayload;
          const response = await nativeRequest(resource,payload);
          if (!version) { assert.equal(response.status,404,'actual proxy endpoint requires /v1 even when a stored custom URL omits it'); continue; }
          assert.equal(response.status,200);
          const value = await response.json(); assert.equal(value.model,payload.model);
          if (protocol === 'responses') assert.equal(value.object,'response');
          else if (protocol === 'messages') { assert.equal(value.type,'message'); assert.equal(value.stop_reason,'end_turn'); assert.equal(value.content[0].type,'text'); }
          else { assert.equal(value.object,'chat.completion'); assert.equal(value.choices[0].finish_reason,'stop'); }
        }
      }
    }
    const messagesEndpoint = endpoint.replace(/responses$/,'messages'), completionsEndpoint = endpoint.replace(/responses$/,'chat/completions');
    for (const [resource,terminal] of [[messagesEndpoint,'message_stop'],[endpoint.replace(/responses$/,'message'),'message_stop'],[completionsEndpoint,'[DONE]']]) {
      const response = await nativeRequest(resource,{...nativePayload,stream:true,stream_options:{include_usage:true}});
      assert.match(response.headers.get('content-type'),/text\/event-stream/);
      const sse = await response.text(); assert.ok(sse.includes(terminal));
      const events = sse.split('\n').filter(line => line.startsWith('data: {')).map(line => JSON.parse(line.slice(6)));
      const streamedText = events.map(event => event.delta?.text ?? event.choices?.[0]?.delta?.content ?? '').join('');
      assert.equal(streamedText,'MOCK proxy response; no upstream call.','native deltas reproduce the JSON fixture text');
      if (terminal === 'message_stop') {
        for (const event of ['message_start','content_block_start','content_block_delta','content_block_stop','message_delta','message_stop']) assert.ok(sse.includes(`event: ${event}\n`));
        assert.doesNotMatch(sse,/\[DONE\]|response\.completed/);
      } else { assert.match(sse,/chat\.completion\.chunk/); assert.match(sse,/"prompt_tokens":1/); assert.doesNotMatch(sse,/event: /); }
    }
    const nativeHeaders = {'x-api-key':issued.api_key};
    assert.equal((await nativeRequest(messagesEndpoint,nativePayload,nativeHeaders)).status,200);
    for (const version of ['2023-06-01','2024-02-29','2000-02-29','2099-12-31']) assert.equal((await nativeRequest(messagesEndpoint,nativePayload,{...nativeHeaders,'anthropic-version':version})).status,200);
    for (const version of ['bad-version','2023-02-29','2024-02-30','2024-04-31','2024-00-01','2024-13-01','2024-01-00','2024-01-32','1999-12-31','2100-01-01']) {
      const response = await nativeRequest(messagesEndpoint,nativePayload,{...nativeHeaders,'anthropic-version':version});
      assert.equal(response.status,400); assert.equal((await response.json()).error,'header');
    }
    assert.equal((await nativeRequest(messagesEndpoint,nativePayload,{...nativeHeaders,authorization:`Bearer ${issued.api_key}`})).status,200);
    for (const headers of [{},{'x-api-key':state.session.access_token},{...nativeHeaders,authorization:'Bearer cap_'+'x'.repeat(43)},{...nativeHeaders,authorization:'Basic mock'},{authorization:`Bearer ${issued.api_key}`,'x-api-key':'bad'}]) assert.equal((await nativeRequest(messagesEndpoint,nativePayload,headers)).status,401);
    assert.equal((await nativeRequest(completionsEndpoint,nativePayload,nativeHeaders)).status,401);
    assert.equal((await nativeRequest(messagesEndpoint,{model:'x',input:'wrong protocol'},nativeHeaders)).status,400);
    assert.equal((await nativeRequest(completionsEndpoint,{model:'x',input:'wrong protocol'})).status,400);
    assert.equal((await nativeRequest(messagesEndpoint,{...nativePayload,max_tokens:undefined},nativeHeaders)).status,400);
    for (const suffix of ['responses','messages','message','chat/completions']) {
      const configured = (await (await post({...routeInput,base_url:`${providerBase}/gateway/v1/${suffix}`})).json()).route;
      assert.ok(configured);
      const credentials = await (await post({action:'admin_proxy_key_create',route_id:configured.id,label:'native route'})).json();
      assert.equal((await nativeRequest(messagesEndpoint.replace(route.id,configured.id),nativePayload,{'x-api-key':credentials.api_key})).status,200);
      const recent = (await (await get('/mock/requests')).json()).requests.at(-1);
      assert.equal(recent.upstream_path,'/gateway/v1/messages','explicit configured endpoint stripped before client endpoint selection');
      assert.equal(recent.anthropic_version,'2023-06-01');
    }
    state = await setup('admin','incomplete');
    for (const [resource,reason] of [[messagesEndpoint,'max_tokens'],[completionsEndpoint,'length']]) {
      const response = await nativeRequest(resource,nativePayload); assert.equal(response.status,200);
      const value = await response.json(); assert.equal(value.stop_reason ?? value.choices[0].finish_reason,reason);
      assert.match(await (await nativeRequest(resource,{...nativePayload,stream:true})).text(),new RegExp(reason));
    }
    state = await setup('admin','interrupted');
    for (const resource of [messagesEndpoint,completionsEndpoint]) {
      const sse = await (await nativeRequest(resource,{...nativePayload,stream:true})).text();
      assert.doesNotMatch(sse,/message_stop|\[DONE\]/);
    }
    state = await setup('admin');
    const otherRoute = (await (await post({...routeInput,name:'Other'})).json()).route;
    assert.equal((await proxyRequest(undefined,issued.api_key,endpoint.replace(route.id,otherRoute.id))).status,401);
    assert.equal((await proxyRequest({model:'x',input:'x'.repeat(LIMIT)})).status,413);
    state = await setup('admin','failed');
    const failure = await proxyRequest(); assert.equal(failure.status,502); assert.deepEqual(await failure.json(),{error:'upstream',mock:true});
    state = await setup('admin','completed');
    result = await readResponses((await proxyRequest({model:'sdk-model',input:'x',stream:true})).body,()=>{}); assert.equal(result.status,'success');
    state = await setup('admin','slow');
    const cancel = new AbortController();
    const active = await proxyRequest({model:'x',input:'x',stream:true},issued.api_key,endpoint,{signal:cancel.signal});
    const active2 = await proxyRequest({model:'x',input:'x',stream:true},issued.api_key,endpoint,{signal:cancel.signal});
    assert.equal((await proxyRequest()).status,429);
    cancel.abort(); await active.body.cancel().catch(()=>{}); await active2.body.cancel().catch(()=>{});
    await new Promise(resolve => setTimeout(resolve,80));
    assert.equal((await proxyRequest()).status,200,'cancel releases proxy leases');
    const routeCancel = new AbortController(), routeStreams = [];
    for (let index = 0; index < 10; index++) {
      const extra = await (await post({action:'admin_proxy_key_create',route_id:route.id,label:`capacity ${index}`})).json();
      for (let slot = 0; slot < 2; slot++) routeStreams.push(await proxyRequest({model:'x',input:'x',stream:true},extra.api_key,endpoint,{signal:routeCancel.signal}));
    }
    assert.equal((await proxyRequest()).status,429,'route cap applies across keys');
    routeCancel.abort(); await Promise.all(routeStreams.map(response => response.body.cancel().catch(()=>{})));
    await new Promise(resolve => setTimeout(resolve,80));
    assert.equal((await proxyRequest()).status,200,'route cancellation frees capacity');
    state = await setup('admin');
    let key = (await (await post({action:'admin_proxy_key_state',id:issued.key.id,enabled:false,revoked:false,expected_version:1})).json()).key;
    assert.equal((await proxyRequest()).status,401);
    assert.equal((await post({action:'admin_proxy_key_state',id:key.id,enabled:true,revoked:false,expected_version:1})).status,409);
    key = (await (await post({action:'admin_proxy_key_state',id:key.id,enabled:true,revoked:false,expected_version:2})).json()).key;
    route = (await (await post({action:'admin_proxy_route_state',id:route.id,enabled:false,expected_version:2})).json()).route;
    assert.equal((await proxyRequest()).status,403);
    route = (await (await post({action:'admin_proxy_route_state',id:route.id,enabled:true,expected_version:3})).json()).route;
    await saveQuota(null,0,null,null,0);
    await post({action:'admin_set_blacklist',user_id:ACCOUNTS.admin.id,blocked:true});
    state = await setup('loggedout'); assert.equal((await proxyRequest()).status,200,'proxy independent of session, quota and blacklist');
    for (const action of PROXY_ACTIONS) assert.equal((await post({action})).status,401);
    state = await setup('admin');
    key = (await (await post({action:'admin_proxy_key_state',id:key.id,enabled:false,revoked:true,expected_version:3})).json()).key;
    assert.ok(key.revoked_at); assert.equal((await proxyRequest()).status,401);
    assert.equal((await post({action:'admin_proxy_key_state',id:key.id,enabled:true,revoked:false,expected_version:4})).status,409);
    const listing = await (await post({action:'admin_proxy_list'})).json();
    assert.doesNotMatch(JSON.stringify(listing),/"hash"|"api_key"/); assert.ok(!JSON.stringify(listing).includes(issued.api_key));
    const proxyLogs = await (await get('/mock/requests')).json();
    assert.ok(proxyLogs.requests.some(item => item.endpoint === 'chat-api-proxy' && item.outcome === 'cancelled'));
    assert.doesNotMatch(JSON.stringify(proxyLogs),/"hash"|"api_key"|client-model-unchanged|CHAT_KEY_MOCK_PROXY/);
    assert.ok(!JSON.stringify(proxyLogs).includes(issued.api_key));
    state = await setup('admin','completed',true);
    assert.deepEqual(await (await post({action:'admin_proxy_list'})).json(),{routes:[],keys:[]});
    console.log('Chat native protocol self-test passed: Responses/Chat Completions/Claude Messages JSON and SSE, exact endpoint inference, message alias normalization, optional /v1 custom URLs, client endpoint selection, native cap_ auth, matching dual credentials, Claude version defaults/validation and incomplete/interrupted fixtures.');
    console.log('Chat proxy self-test passed: admin contracts, safe metadata, one-time 32-byte keys, hash-only storage, versions, route binding, JSON/SSE, model preservation, 401/403/404/405/413/429/502, cancellation, quota/blacklist/session independence, revocation, URL rewrite and reset.');
    console.log('Chat quota/blacklist self-test passed: strict admin auth, directory UUIDs, own snapshot, null/zero/max bounds, version conflicts, both route reservations/headers, UTC day/week/month rollover, no-usage retention, blacklist gates and reset.');
    console.log('Chat mock HTTP self-test passed: local SDK/URL/CSP, fixtures, catalog, permissions, multi-turn SSE, terminal states, cancellation/lease, account switch, admin save/disable/test/usage, redacted metadata, reset and traversal/origin guards.');
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

if (process.argv.includes('--self-test')) await selfTest();
else {
  const server = createMockServer();
  server.on('error',error => { console.error(error.code === 'EADDRINUSE' ? `MOCK port ${PORT} is already in use; stop that server before starting another.` : 'MOCK server could not start.'); process.exitCode = 1; });
  server.listen(PORT,'127.0.0.1',() => console.log(`MOCK ONLY — ${ORIGIN}/setup\nStatic public/ + in-memory auth/chat; no upstream calls. Ctrl+C to stop.`));
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal,() => { server.closeAllConnections(); server.close(() => process.exit(0)); });
}
