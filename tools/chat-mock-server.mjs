import http from 'node:http';
import {readFile, realpath, stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';

// Deliberately standalone: never import the backend, read credentials, or fetch an upstream.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const FIXTURES = path.join(ROOT, 'docs/chat-validation/fixtures');
const PORT = 4191;
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
const ACTIONS = ['catalog','respond','admin_get','admin_save_provider','admin_save_model','admin_usage','admin_test'];
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
function seed() {
  const provider = {id:PROVIDER_ID,name:'mock',label:'MOCK 本地供应商',base_url:'https://mock-provider.example.com/v1',secret_name:'CHAT_KEY_MOCK',auth_header:'authorization',enabled:true};
  const base = {provider_id:provider.id,context_window:32768,max_output_tokens:4096,default_max_output_tokens:512,reasoning_efforts:['low','medium','high'],default_reasoning_effort:'medium',supports_images:true,supports_pdf:true,preserve_reasoning:false,enabled:true};
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
function providerConfig(payload) {
  requireThat(payload.id == null || uuid(payload.id));
  let url;
  try { url = new URL(payload.base_url); } catch { throw new MockError('provider_url'); }
  // Syntactic check only; no DNS lookup and no connection is ever made.
  requireThat(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && (!url.port || url.port === '443') && !/(^|\/)responses\/?$/i.test(url.pathname),'provider_url');
  requireThat(!/^(localhost|.*\.localhost|.*\.local|.*\.invalid|.*\.test|.*\.internal)$/i.test(url.hostname) && !/^(127|10|0|192\.168|169\.254)\./.test(url.hostname) && !url.hostname.includes(':'),'provider_url');
  const name = text(payload.secret_name,90,true);
  requireThat(/^CHAT_KEY_[A-Z0-9_]{1,80}$/.test(name),'secret_name');
  requireThat(payload.auth_header === undefined || ['authorization','x-api-key'].includes(payload.auth_header));
  return {id:payload.id || randomUUID(),name:text(payload.name,80,true),label:text(payload.label,120) || '',base_url:`${url.origin}${url.pathname.replace(/\/+$/,'')}`,secret_name:name,auth_header:payload.auth_header || 'authorization',enabled:payload.enabled === undefined ? true : Boolean(payload.enabled)};
}
function modelConfig(payload, providers) {
  requireThat(payload.id == null || uuid(payload.id));
  requireThat(uuid(payload.provider_id) && providers.some(row => row.id === payload.provider_id));
  const max = integer(payload.max_output_tokens,1,131072), efforts = payload.reasoning_efforts ?? [];
  requireThat(Array.isArray(efforts) && efforts.length <= 12 && efforts.every(value => typeof value === 'string' && value.length > 0 && value.length <= 40));
  return {id:payload.id || randomUUID(),provider_id:payload.provider_id,model_key:text(payload.model_key ?? payload.model_id,160,true),display_name:text(payload.display_name,120,true),context_window:integer(payload.context_window,256,1000000),max_output_tokens:max,default_max_output_tokens:integer(payload.default_max_output_tokens,1,max),reasoning_efforts:efforts,default_reasoning_effort:payload.default_reasoning_effort == null ? null : text(payload.default_reasoning_effort,40,true),supports_images:Boolean(payload.supports_images),supports_pdf:Boolean(payload.supports_pdf),preserve_reasoning:Boolean(payload.preserve_reasoning),enabled:payload.enabled === undefined ? true : Boolean(payload.enabled)};
}
function upsert(rows, item) { const index = rows.findIndex(row => row.id === item.id); if (index < 0) rows.push(item); else rows[index] = item; return item; }
function rewriteJS(source, origin) {
  return source.replace(/https:\/\/[a-z0-9-]+\.supabase\.co/gi,origin)
    .replaceAll('/functions/v1/chat','/mock/chat').replaceAll('/functions/v1/club-drive','/mock/club-drive');
}

export function createMockServer({testPort = false} = {}) {
  let state = {account:'member',scenario:'completed',theme:'dark',revision:1};
  let database = seed();
  const logs = [], leases = new Map();
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
    const max = payload.action === 'admin_test'
      ? integer(payload.max_output_tokens,1,model.max_output_tokens,model.default_max_output_tokens)
      : model.default_max_output_tokens;
    const effort = payload.reasoning_effort == null ? model.default_reasoning_effort : text(payload.reasoning_effort,40,true);
    requireThat(!leases.has(account.id),'busy',409);
    const scenario = state.scenario, requestId = meta.request_id;
    Object.assign(meta,{model_id:model.id,max_output_tokens:max,reasoning_effort:effort == null ? null : model.reasoning_efforts.includes(effort) ? effort : 'custom',scenario});
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
    res.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-cache, no-transform','x-chat-request-id':requestId,'connection':'keep-alive'});
    res.flushHeaders();
    const event = data => { if (!res.destroyed) res.write(`event: ${data.type}\r\ndata: ${JSON.stringify(data)}\r\n\r\n`); };
    event({type:'response.created',response:{id:`mock-${requestId}`,object:'response',status:'in_progress',output:[]}});
    const turn = meta.roles.user;
    const answer = `**MOCK / 本地模拟**\n\n第 ${turn} 轮；已收到 ${meta.roles.assistant} 条 assistant 历史。\n\n文本片段 ${meta.parts.input_text}，图片 ${meta.parts.input_image}，原生 PDF ${meta.parts.input_file}。\n\n- 场景：${scenario}\n- 此内容由 fixture 生成，无线上模型调用。\n\n\`\`\`js\nconsole.log('mock only');\n\`\`\`\n\n[本地设置](/setup)\n\n<script>MOCK_UNSAFE_HTML</script>\n`;
    const chunks = answer.match(/[\s\S]{1,18}/g);
    let index = 0, collected = '';
    timer = setInterval(() => {
      if (ended) return;
      if (index < chunks.length) { const delta = chunks[index++]; collected += delta; event({type:'response.output_text.delta',output_index:0,content_index:0,delta}); }
      if (scenario === 'interrupted' && index >= 3) { finish('incomplete','upstream_eof'); res.end(); return; }
      if (index < chunks.length) return;
      const terminal = scenario === 'slow' ? 'completed' : scenario;
      const tokens = {input_tokens:Math.ceil(meta.text_bytes / 3) + meta.attachment_count * 32,output_tokens:Math.ceil(Buffer.byteLength(collected) / 3)};
      tokens.total_tokens = tokens.input_tokens + tokens.output_tokens;
      const output = [{id:`mock-message-${requestId}`,type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:collected,annotations:[]}]}];
      Object.assign(usage,tokens);
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
      if (['respond','admin_test'].includes(payload.action)) { stream(req,res,payload,account,meta); return; }
      let result;
      switch (payload.action) {
        case 'catalog': result = {models:database.models.filter(model => model.enabled && database.providers.some(provider => provider.id === model.provider_id && provider.enabled)).map(({provider_id,model_key,enabled,...model}) => model),bound:true,member_name:account.member_name}; break;
        case 'admin_get': result = {providers:database.providers,models:database.models.map(model => ({...model,model_id:model.model_key}))}; break;
        case 'admin_save_provider': result = {provider:upsert(database.providers,providerConfig(payload))}; break;
        case 'admin_save_model': result = {model:upsert(database.models,modelConfig(payload,database.providers))}; break;
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
      if (pathname === '/mock/chat') { await chat(req,res); return; }
      if (pathname === '/mock/session' && req.method === 'GET') { json(res,publicState()); return; }
      if (pathname === '/mock/requests' && req.method === 'GET') { json(res,{mock:true,requests:logs}); return; }
      if (pathname === '/mock/setup' && req.method === 'POST') {
        const {payload} = await body(req); keys(payload,['account','scenario','theme','reset']);
        requireThat(Object.hasOwn(ACCOUNTS,payload.account) && SCENARIOS.includes(payload.scenario) && ['auto','light','dark'].includes(payload.theme));
        if (payload.reset) { for (const lease of leases.values()) lease.cancel(); database = seed(); logs.length = 0; }
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
  server.on('close',() => { for (const lease of leases.values()) lease.cancel(); });
  return server;
}

async function selfTest() {
  const server = createMockServer({testPort:true});
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
    assert.equal((await post({action:'admin_get'})).status,403);
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
    const model = {action:'save_model',provider_id:providerId,model_key:'mock-created',display_name:'MOCK created',context_window:2048,max_output_tokens:512,default_max_output_tokens:128,reasoning_efforts:[],supports_images:false,supports_pdf:false};
    saved = await (await post(model)).json(); assert.ok(uuid(saved.model.id));
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
    state = await setup('member','completed',true); assert.equal((await (await get('/mock/requests')).json()).requests.length,0);
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
