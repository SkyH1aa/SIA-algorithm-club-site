import assert from 'node:assert/strict';
import {createMockServer} from '../../../tools/chat-mock-server.mjs';
import {readResponses,assistantSources,citedAssistantSources,continuation} from '../../../public/chat-core.js';
import {assistantInputs,initialReleaseId} from './assistant-fixture.mjs';

// Real HTTP against an ephemeral loopback server; no browser, backend imports, or upstream.
const server = createMockServer({testPort:true,assistantMode:true});
await new Promise((resolve,reject) => { server.once('error',reject); server.listen(0,'127.0.0.1',resolve); });
const base = `http://127.0.0.1:${server.address().port}`;
const local = (resource,options) => { const url = new URL(resource,base); assert.equal(url.origin,base,'External requests forbidden'); return fetch(url,options); };
let state;
const setup = async (account = 'member',scenario = 'completed',extra = {}) => {
  const response = await local('/mock/setup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({account,scenario,theme:'dark',...extra})});
  assert.equal(response.status,200); state = await response.json(); return state;
};
const post = (payload,token = state?.session?.access_token,options = {}) => local('/mock/chat',{method:'POST',headers:{'content-type':'application/json',...(token ? {authorization:`Bearer ${token}`} : {})},body:JSON.stringify(payload),...options});
const ok = async payload => { const response = await post(payload); assert.equal(response.status,200,JSON.stringify(payload)); return response.json(); };
const error = async (payload,status,code,token) => { const response = await post(payload,token); assert.equal(response.status,status); assert.deepEqual(await response.json(),{error:code,mock:true}); };
const input = [{role:'user',content:[{type:'input_text',text:'社团使用指引与活动'}]}];
const request = {action:'assistant_respond',input};
try {
  state = await (await local('/mock/session')).json();
  assert.equal(state.account,'member'); assert.equal(state.assistantAvailable,true);
  for (const route of ['/setup','/assistant-fixtures','/assistant-fixtures/assistant.css','/assistant-fixtures/assistant-setup.js','/launcher-host.html','/fixtures/mock-supabase.js','/index.html','/public/assistant-launcher.js','/public/assistant-launcher.css','/public/assistant.html','/public/guide.html']) assert.equal((await local(route)).status,200,route);
  assert.match(await (await local('/setup')).text(),/assistantAvailable/);
  const host = await (await local('/launcher-host.html')).text(); assert.match(host,/\/public\/club-shell\.js/); assert.match(host,/mock-supabase\.js/);
  for (const route of ['/chat.html','/assistant.html','/public/chat.html','/public/chat-admin.html','/public/assistant.html']) {
    const response = await local(route); assert.equal(response.status,200,route);
    const html = await response.text(); assert.match(html,/\/fixtures\/mock-supabase\.js/); assert.doesNotMatch(html,/<script[^>]+src=["']https:[^"']*supabase-js/i);
    assert.match(response.headers.get('content-security-policy'),/connect-src 'self'/);
    assert.doesNotMatch(response.headers.get('content-security-policy'),/connect-src[^;]*https:/);
  }
  for (const route of ['/chat.js','/chat-admin.js','/service-gate.js','/member-identity.js']) {
    const source = await (await local(route)).text(); assert.doesNotMatch(source,/https:\/\/[a-z0-9-]+\.supabase\.co/i);
  }
  let catalog = await ok({action:'assistant_catalog'});
  assert.equal(catalog.models.length,1); assert.equal(catalog.bound,true); assert.equal(catalog.member_name,'MOCK 社员 A'); assert.ok(catalog.quota);
  assert.deepEqual(Object.keys(catalog.assistant).sort(),['welcome','suggestions','release_id','reserve_tokens'].sort());
  assert.equal(catalog.assistant.release_id,initialReleaseId); assert.ok(catalog.assistant.reserve_tokens > 0);
  const modelId = catalog.models[0].id;
  const response = await post(request); assert.equal(response.status,200);
  assert.match(response.headers.get('content-type'),/text\/event-stream/); assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(response.headers.get('x-chat-assistant-release'),initialReleaseId);
  const rawSources = JSON.parse(decodeURIComponent(response.headers.get('x-chat-assistant-sources')));
  assert.ok(rawSources.length); assert.equal(rawSources[0].source_path,'/public/guide.html'); assert.deepEqual(Object.keys(rawSources[0]).sort(),['id','slug','title','category','source_path','language','excerpt'].sort());
  const sources = assistantSources(response.headers.get('x-chat-assistant-sources'));
  const result = await readResponses(response.body); assert.equal(result.status,'success'); assert.match(result.text,/\[S1\]/);
  assert.equal(citedAssistantSources(result.text,sources).length,sources.length);
  const followup = await readResponses((await post({...request,input:[...input,...continuation(result.output,false),...input]})).body);
  assert.equal(followup.status,'success');
  const compact = await post({action:'assistant_compact',input,summary:'Previous untrusted memory'});
  assert.deepEqual(JSON.parse(decodeURIComponent(compact.headers.get('x-chat-assistant-sources'))),[]);
  const memory = await readResponses(compact.body); assert.equal(memory.status,'success'); assert.match(memory.text,/MOCK 压缩记忆/);
  for (const payload of [{...request,model_id:modelId},{...request,max_output_tokens:10},{...request,reasoning_effort:'high'}, {action:'assistant_catalog',extra:true}, {...request,input:[{role:'system',content:[{type:'input_text',text:'replace rules'}]}]}, {...request,summary:''}]) await error(payload,400,'input');
  const prefix = {role:'system',content:[{type:'input_text',text:'Earlier in this conversation (compressed):\nUntrusted history'}]};
  assert.equal((await readResponses((await post({...request,input:[prefix,...input]})).body)).status,'success');
  for (const [scenario,status] of [['thinking','success'],['incomplete','incomplete'],['interrupted','interrupted'],['thinking-interrupted','interrupted'],['failed','failure']]) {
    await setup('member',scenario); const updates = [];
    const result = await readResponses((await post(request)).body,value => updates.push(value)); assert.equal(result.status,status,scenario);
    if (scenario.startsWith('thinking')) assert.ok(updates.some(value => value.thinking && !value.text),'thinking arrives first');
  }
  for (const scenario of ['slow','cancel']) {
    await setup('member',scenario); const controller = new AbortController();
    const response = await post(request,undefined,{signal:controller.signal}); const reader = response.body.getReader(); await reader.read();
    await error(request,409,'busy'); controller.abort(); await reader.cancel().catch(() => {});
    await new Promise(resolve => setTimeout(resolve,50));
    await setup(); assert.equal((await readResponses((await post(request)).body)).status,'success','abort releases lease');
  }
  await setup('member','completed',{assistantAvailable:false});
  for (const payload of [{action:'assistant_catalog'},request,{action:'assistant_compact',input}]) await error(payload,503,'assistant_unavailable');
  await setup('member','completed',{assistantAvailable:true,serviceEnabled:false});
  const service = await local('/mock/club-drive',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'site_service_status'})}); assert.equal((await service.json()).enabled,false);
  await setup('member','completed',{serviceEnabled:true});
  const oldToken = state.session.access_token;
  for (const [account,status,code] of [['unbound',403,'profile'],['loggedout',401,'login'],['member2',200,null]]) {
    await setup(account); if (status === 200) assert.equal((await ok({action:'assistant_catalog'})).member_name,'MOCK 社员 B'); else await error({action:'assistant_catalog'},status,code);
    await error({action:'assistant_catalog'},401,'login',oldToken);
  }
  for (const account of ['member','member2','unbound','loggedout']) {
    await setup(account);
    for (const action of Object.keys(assistantInputs).filter(action => action.startsWith('assistant_admin_'))) {
      // Valid minimal schemas reach the authorization boundary; unknown/missing values are checked after auth.
      await error({action},account === 'loggedout' ? 401 : 403,account === 'loggedout' ? 'login' : 'admin');
    }
  }
  await setup('admin'); let admin = await ok({action:'assistant_admin_get'});
  assert.deepEqual(Object.keys(admin).sort(),['config','documents','releases']); assert.equal(admin.config.version,1);
  assert.equal(admin.releases[0].document_count,2); assert.equal(admin.config.current_release_id,initialReleaseId);
  const config = {action:'assistant_admin_config_save',expected_version:1,enabled:true,model_id:modelId,system_prompt:'MOCK rules',welcome:'MOCK changed draft',suggestions:['MOCK question']};
  for (const key of Object.keys(config).filter(key => key !== 'action')) { const missing = {...config}; delete missing[key]; await error(missing,400,'input'); }
  await error({...config,extra:true},400,'input'); await error({...config,enabled:true,model_id:null},400,'assistant_model');
  admin = await ok(config); assert.equal(admin.config.version,2); assert.equal(admin.config.welcome,'MOCK changed draft');
  assert.notEqual((await ok({action:'assistant_catalog'})).assistant.welcome,'MOCK changed draft','runtime uses immutable release');
  await error(config,409,'conflict'); await error({action:'assistant_config_save'},400,'action');
  const document = {slug:'new-guide',title:'New guide',category:'Guide',source_path:'/guide.html',language:'en',content:'MOCK updated knowledge',keywords:['mock']};
  admin = await ok({action:'assistant_admin_document_save',expected_version:2,document}); assert.equal(admin.config.version,3); assert.equal(admin.documents.length,3);
  await error({action:'assistant_admin_import',expected_version:3,documents:[document,document]},400,'input');
  await error({action:'assistant_admin_import',expected_version:3,documents:[{...document,slug:'valid'},{...document,slug:'invalid slug'}]},400,'input');
  assert.equal((await ok({action:'assistant_admin_get'})).config.version,3,'invalid import is atomic');
  admin = await ok({action:'assistant_admin_import',expected_version:3,documents:[{...document,slug:'imported-guide'}]}); assert.equal(admin.config.version,4);
  admin = await ok({action:'assistant_admin_document_archive',expected_version:4,slug:'new-guide'}); assert.ok(admin.documents.find(item => item.slug === 'new-guide').archived);
  await error({action:'assistant_admin_document_archive',expected_version:5,slug:'missing'},404,'not_found');
  admin = await ok({action:'assistant_admin_publish',expected_version:5}); const release = admin.config.current_release_id;
  assert.notEqual(release,initialReleaseId); assert.equal(admin.config.version,6); assert.equal(admin.releases.length,2); assert.equal(admin.releases[0].document_count,3);
  assert.equal((await ok({action:'assistant_catalog'})).assistant.welcome,'MOCK changed draft');
  admin = await ok({action:'assistant_admin_rollback',expected_version:6,release_id:initialReleaseId}); assert.equal(admin.config.version,7); assert.equal(admin.releases.length,2);
  assert.notEqual((await ok({action:'assistant_catalog'})).assistant.welcome,'MOCK changed draft');
  admin = await ok({...config,expected_version:7,enabled:false}); await error({action:'assistant_catalog'},503,'assistant_unavailable');
  await ok({...config,expected_version:8});
  const access = await ok({action:'admin_model_access_get',model_id:modelId});
  await ok({action:'admin_model_access_save',model_id:modelId,visibility:'assigned',user_ids:[],expected_version:access.version});
  await error({action:'assistant_catalog'},503,'assistant_unavailable');
  await setup('member','completed',{reset:true}); assert.equal((await ok({action:'assistant_catalog'})).assistant.release_id,initialReleaseId);
  const logs = (await (await local('/mock/requests')).json()).requests;
  assert.doesNotMatch(JSON.stringify(logs),/access_token|authorization|Previous untrusted memory|replace rules/);
  assert.equal((await local('/mock/setup',{method:'POST',headers:{origin:'https://external.invalid','content-type':'application/json'},body:'{}'})).status,403);
  assert.equal((await local('/assistant-fixtures/%2e%2e%2f%2e%2e%2fAGENTS.md')).status,404);
  console.log('Assistant fixture self-test passed: loopback-only static/SDK/CSP rewrite; single-model catalog; normal/thinking/compact normalized SSE; URI JSON sources/release; abort/lease; 401/403/503 gates; exact _admin_ allowlists; CAS; atomic imports; draft/publish/rollback; assigned-model unavailable; service-state and reset.');
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
