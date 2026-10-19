// Local disposable PostgreSQL WASM integration. Pass an installed @electric-sql/pglite entry path.
// node tools/test-chat-assistant-sql.mjs C:/.../node_modules/@electric-sql/pglite/dist/index.js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const entry=process.argv[2];
if(!entry) throw new Error('Pass the local installed @electric-sql/pglite module entry; no network or project credentials are used.');
const {PGlite}=await import(pathToFileURL(path.resolve(entry)).href);
const db=new PGlite();
const actor='11111111-1111-4111-8111-111111111111', member='22222222-2222-4222-8222-222222222222';
const source=fs.readFileSync(path.resolve(import.meta.dirname,'../supabase/club-chat-schema.sql'),'utf8');
const doc={slug:'join',title:'报名',category:'club',source_path:'/join.html',language:'zh',content:'初始报名规则',keywords:['报名']};
const query=async(sql,args=[]) => (await db.query(sql,args)).rows;
const call=async(action,data={},who=actor)=>(await query('select public.chat_assistant_admin($1,$2,$3::jsonb) as value',[who,action,JSON.stringify(data)]))[0].value;
const runtime=async()=>(await query('select public.chat_assistant_runtime() as value'))[0].value;
const rejects=async(fn,code)=>{await assert.rejects(fn,e=>!code||e.code===code);};
try {
  await db.exec("create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}'::jsonb); create table club_super_admins(user_id uuid primary key references auth.users(id)); create table club_member_profiles(user_id uuid primary key references auth.users(id),username text,member_name text);");
  await db.exec(source); await db.exec(source); // additive migration must rerun
  await query('insert into auth.users(id) values($1),($2)',[actor,member]);
  await query('insert into club_super_admins values($1)',[actor]);
  const pid=(await query("insert into chat_providers(name,base_url,secret_name) values('local','https://provider.example.com/v1','CHAT_KEY_LOCAL') returning id"))[0].id;
  const mid=(await query("insert into chat_models(provider_id,model_key,display_name,context_window,max_output_tokens,default_max_output_tokens) values($1,'local','Local',10000,1000,100) returning id",[pid]))[0].id;
  let state=await call('assistant_admin_get'); assert.equal(state.config.version,0); assert.equal((await runtime()).enabled,false);
  await rejects(()=>call('assistant_admin_get',{},member),'42501');
  assert.deepEqual(await call('assistant_admin_publish',{expected_version:99}),{code:'conflict'});
  state=await call('assistant_admin_config_save',{expected_version:0,enabled:true,model_id:mid,system_prompt:'initial rule',welcome:'hello',suggestions:['报名？']});
  assert.equal(state.config.version,1); assert.equal((await runtime()).release,null);
  state=await call('assistant_admin_import',{expected_version:1,documents:[doc]}); assert.equal(state.documents[0].archived,false);
  state=await call('assistant_admin_publish',{expected_version:2}); const first=state.config.current_release_id; assert(first);
  const snap=await runtime(); assert.equal(snap.release.id,first); assert.equal(snap.release.config.system_prompt,'initial rule');
  state=await call('assistant_admin_document_save',{expected_version:3,document:{...doc,content:'edited draft'}});
  assert.deepEqual(await runtime(),snap,'draft cannot alter current snapshot');
  state=await call('assistant_admin_config_save',{expected_version:4,enabled:true,model_id:mid,system_prompt:'draft rule',welcome:'new',suggestions:[]});
  assert.deepEqual(await runtime(),snap,'draft rules cannot alter current snapshot');
  state=await call('assistant_admin_publish',{expected_version:5}); const second=state.config.current_release_id; assert.notEqual(first,second);
  assert.equal((await runtime()).release.documents[0].content,'edited draft');
  state=await call('assistant_admin_rollback',{expected_version:6,release_id:first}); assert.equal((await runtime()).release.id,first);
  state=await call('assistant_admin_document_archive',{expected_version:7,slug:'join'}); assert.equal(state.documents[0].archived,true);
  assert.equal((await runtime()).release.documents.length,1);
  assert.deepEqual(await call('assistant_admin_publish',{expected_version:8}),{code:'assistant_documents'});
  state=await call('assistant_admin_document_save',{expected_version:8,document:doc}); assert.equal(state.documents[0].archived,false);
  const version=state.config.version;
  for(const source_path of ['https://evil.example/x.html','//evil/x.html','/%2e%2e/x.html','/../x.html','/a.html?x=1','/a\\b.html']) await rejects(()=>call('assistant_admin_document_save',{expected_version:version,document:{...doc,source_path}}),'22023');
  await rejects(()=>call('assistant_admin_import',{expected_version:version,documents:[doc,doc]}),'22023');
  await rejects(()=>call('assistant_admin_import',{expected_version:version,documents:[{...doc,slug:'new'}, {...doc,slug:'bad',title:''}]}),'22023');
  assert.equal((await call('assistant_admin_get')).documents.length,1,'import failure rolls back earlier rows');
  await query("update chat_models set visibility='assigned' where id=$1",[mid]);
  assert.deepEqual(await call('assistant_admin_publish',{expected_version:version}),{code:'assistant_model'});
  assert.deepEqual(await call('assistant_admin_rollback',{expected_version:version,release_id:second}),{code:'assistant_model'});
  await query("update chat_models set visibility='all' where id=$1",[mid]);
  await rejects(()=>query('update chat_assistant_releases set documents=documents where id=$1',[first]),'42501');
  await rejects(()=>query('delete from chat_assistant_releases where id=$1',[first]),'42501');
  for(const role of ['anon','authenticated']) {
    const permissions=(await query("select has_table_privilege($1,'public.chat_assistant_config','SELECT') as table_read,has_function_privilege($1,'public.chat_assistant_admin(uuid,text,jsonb)','EXECUTE') as admin_call,has_function_privilege($1,'public.chat_assistant_runtime()','EXECUTE') as runtime_call",[role]))[0];
    assert.deepEqual(permissions,{table_read:false,admin_call:false,runtime_call:false});
  }
  const service=(await query("select has_table_privilege('service_role','public.chat_assistant_releases','UPDATE') as mutate,has_function_privilege('service_role','public.chat_assistant_admin(uuid,text,jsonb)','EXECUTE') as admin_call"))[0];
  assert.deepEqual(service,{mutate:false,admin_call:true});
  const actionAudit={provider_id:pid,model_id:mid,model_key:'local',input_bytes:100,action:'assistant_compact'};
  const request='33333333-3333-4333-8333-333333333333';
  const admitted=(await query('select public.chat_begin_generation($1,$2,10,20,$3::jsonb) as value',[member,request,JSON.stringify(actionAudit)]))[0].value;
  assert.equal(admitted.allowed,true); assert.equal((await query('select action from chat_usage where request_id=$1',[request]))[0].action,'assistant_compact');
  await query('delete from club_super_admins where user_id=$1',[actor]); await rejects(()=>call('assistant_admin_get'),'42501');
  console.log('Assistant PostgreSQL integration passed: rerun, CAS, dynamic admin, atomic import, immutable publish/rollback, draft isolation, bounds, service-only privileges and shared quota admission.');
} finally {await db.close();}
