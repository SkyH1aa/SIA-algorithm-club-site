// Offline: deno run --allow-env tools/test-chat-image-backend.ts
import { strict as assert } from 'node:assert';
Deno.env.set('CHAT_TEST_MODE','1'); Deno.env.set('SUPABASE_URL','http://127.0.0.1:19999');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY','local-service'); Deno.env.set('SUPABASE_ANON_KEY','local-anon'); Deno.env.set('CHAT_KEY_MOCK','secret');
const {handler} = await import('../supabase/functions/chat/index.ts');
const uid='11111111-1111-4111-8111-111111111111', pid='22222222-2222-4222-8222-222222222222', mid='33333333-3333-4333-8333-333333333333', rid='44444444-4444-4444-8444-444444444444';
const provider={id:pid,name:'mock',label:'Mock',base_url:'https://api.example.com/v1',api_protocol:'auto',secret_name:'CHAT_KEY_MOCK',auth_header:'authorization',enabled:true};
const model={id:mid,provider_id:pid,model_key:'image',display_name:'Image',introduction:null,context_window:4096,max_output_tokens:100,default_max_output_tokens:100,reasoning_efforts:[],default_reasoning_effort:null,claude_thinking:{mode:'omit'},supports_images:false,supports_pdf:false,preserve_reasoning:false,enabled:true,visibility:'all',purpose:'image',image_config:{}};
const quota={global:{remaining:10},user:{remaining:10},blacklisted:false};
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/b9sAAAAASUVORK5CYII=';
const calls:string[]=[], bodies:Record<string,unknown>[]=[]; let claimed=false, archiveFail=false, finishFail=false, finishFailures=0;
let abortOnArchive: AbortController | undefined;
let mediaUrl: string | undefined;
const oldFetch=globalThis.fetch, oldDns=Deno.resolveDns;
Deno.resolveDns = (async (_host:string, family:string) => family === 'A' ? ['8.8.8.8'] : []) as typeof Deno.resolveDns;
globalThis.fetch = async (url,init) => {
  const u=new URL(String(url)); const path=u.pathname; calls.push(path);
  const response=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json'}});
  if(path==='/auth/v1/user') return response({id:uid});
  if(path.endsWith('/club_member_profiles')) return response([{username:'user',member_name:'member'}]);
  if(path.endsWith('/chat_providers')) return response([provider]);
  if(path.endsWith('/chat_models')) return response([model]);
  if(path.includes('/rpc/')) {
    const name=path.split('/').pop()!; const body=JSON.parse(String(init?.body)); bodies.push({name,...body});
    if(name==='chat_image_quota_get') return response(quota);
    if(name==='chat_image_claim') { if(claimed) return response({allowed:false,code:'slot_unavailable',quota}); claimed=true; }
    if(name==='chat_image_finish' && (finishFail || finishFailures > 0)) { if (finishFailures > 0) finishFailures--; return response({},503); }
    return response({allowed:true,quota});
  }
  if(path==='/functions/v1/club-drive') { abortOnArchive?.abort(); return response({ok:!archiveFail},archiveFail?503:200); }
  if(u.hostname==='api.example.com') return response({data:[mediaUrl ? {url:mediaUrl} : {b64_json:png}]});
  if(u.hostname==='8.8.8.8') return new Response(Uint8Array.from(atob(png),c=>c.charCodeAt(0)));
  throw new Error(`unexpected ${u}`);
};
const request=async (body:unknown, signal?:AbortSignal) => handler(new Request('http://localhost/chat',{method:'POST',headers:{authorization:'Bearer member','content-type':'application/json'},body:JSON.stringify(body),signal}));
const payload={request_id:rid,model_id:mid,prompt:'draw',options:{size:'auto',quality:'auto',background:'auto'},references:[]};
try {
  let response=await request({action:'image_catalog'}); let value=await response.json(); assert.equal(value.models.length,1); assert(!('media_hosts' in value.models[0].image_config));
  response=await request({action:'catalog'}); value=await response.json(); assert.equal(value.models.length,0);
  assert.equal((await request({action:'respond',model_id:mid,input:[]})).status,400);
  response=await request({action:'image_begin',...payload,count:1}); assert.equal(response.status,200);
  const begin=bodies.find(x=>x.name==='chat_image_begin')!; assert.equal(String(begin.p_fingerprint).length,64); assert(!JSON.stringify(begin.p_audit).includes('draw'));
  response=await request({action:'image_generate',...payload,slot:0}); value=await response.json(); assert.equal(response.status,200); assert.equal(value.image.mime,'image/png'); assert.equal(value.archive.ok,true);
  assert(calls.indexOf('/rest/v1/rpc/chat_image_claim') < calls.indexOf('/rest/v1/rpc/chat_image_dispatch'));
  assert.equal(bodies.find(x=>x.name==='chat_image_claim')!.p_fingerprint,begin.p_fingerprint);
  assert.equal((await request({action:'image_generate',...payload,slot:0})).status,409);
  claimed=false; finishFailures=1; abortOnArchive=new AbortController();
  const beforeFinishes=bodies.filter(x=>x.name==='chat_image_finish').length;
  const beforeDispatches=calls.filter(x=>x==='/rest/v1/rpc/chat_image_dispatch').length;
  response=await request({action:'image_generate',...payload,slot:0},abortOnArchive.signal); value=await response.json();
  assert.equal(value.status,'succeeded'); assert(value.image.b64_json);
  assert.equal(bodies.filter(x=>x.name==='chat_image_finish').length-beforeFinishes,2);
  assert.equal(calls.filter(x=>x==='/rest/v1/rpc/chat_image_dispatch').length-beforeDispatches,1);
  abortOnArchive=undefined;
  claimed=false; archiveFail=true; finishFail=true;
  response=await request({action:'image_generate',...payload,slot:0}); value=await response.json(); assert.equal(response.status,200); assert.equal(value.archive.ok,false); assert.equal(value.status,'uncertain'); assert(value.image.b64_json);
  assert.equal((await request({action:'image_generate',...payload,slot:0,fingerprint:'fake'})).status,400);
  finishFail=false; archiveFail=false; claimed=false;
  model.image_config={media_hosts:['cdn.example.com','127.0.0.1','8.8.8.8']};
  mediaUrl='https://cdn.example.com/image.png?signature=1';
  response=await request({action:'image_generate',...payload,slot:0}); assert.equal(response.status,502);
  assert(!calls.includes('/image.png'));
  claimed=false; mediaUrl='https://127.0.0.1/image.png';
  response=await request({action:'image_generate',...payload,slot:0}); assert.equal(response.status,502);
  assert(!calls.includes('/image.png'));
  claimed=false; mediaUrl='https://8.8.8.8/image.png?signature=1';
  response=await request({action:'image_generate',...payload,slot:0}); value=await response.json();
  assert.equal(response.status,200); assert.equal(value.image.mime,'image/png');
  console.log('PASS image catalog, isolation, reservation, settlement, media URL safety and duplicate protection');
} finally {globalThis.fetch=oldFetch; Deno.resolveDns=oldDns;}
