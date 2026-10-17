import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as core from '../public/chat-core.js';
import {buildContext, createSSEParser, continuation, readResponses} from '../public/chat-core.js';

const events = [];
const parser = createSSEParser((payload, event) => events.push({payload, event}));
parser.push('event: response.output_text.delta\r\ndata: {"type":"response.output_text.delta","delta":"你');
parser.push('好"}\r');
parser.push('\n\r\nevent: response.completed\r\ndata: {"type":"response.completed","response":{"output":[]}}\r\n\r\n');
assert.equal(events.length, 2);
assert.equal(events[0].payload.delta, '你好');
assert.equal(events[0].event, 'response.output_text.delta');
const multiline = [];
const second = createSSEParser(value => multiline.push(value));
second.push('data: {"a":\n');
second.push('data: "first"}\n\n');
assert.equal(multiline[0].a, 'first');
function stream(text) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); }});
}
const delta = 'data: {"type":"response.output_text.delta","delta":"你好"}\n\n';
const updates = [];
const complete = await readResponses(stream(delta + 'data: {"type":"response.completed","response":{"output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"你好！"}]}],"usage":{"output_tokens":3}}}\n\n'), value => updates.push(value));
assert.equal(complete.text, '你好！');
assert.equal(complete.status, 'success');
assert.equal(complete.usage.output_tokens, 3);
assert.equal(updates[0].text, '你好');
assert.equal((await readResponses(stream(delta),()=>{})).status, 'interrupted');
for (const [event,status] of [['response.incomplete','incomplete'],['response.failed','failure'],['error','failure']]) {
  assert.equal((await readResponses(stream(`data: ${JSON.stringify({type:event})}\n\n`),()=>{})).status,status);
}
const turns = [
  {input:[{role:'user',content:[{type:'input_text',text:'old '.repeat(100)}]}],status:'success',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'old answer'}]}]},
  {input:[{role:'user',content:[{type:'input_text',text:'new'}]}],status:'success',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'new answer'}]}]}
];
const context = buildContext(turns,{context_window:100},10);
assert.equal(context.truncated, true);
assert.match(JSON.stringify(context.input), /new/);
assert.doesNotMatch(JSON.stringify(context.input), /old answer/);
assert.throws(() => buildContext(turns,{context_window:10},10),/context/);
const imageBytes = 2040 * 1024;
const imageData = `data:image/png;base64,${'A'.repeat(4 * Math.ceil(imageBytes / 3))}`;
const imageTurn = {input:[{role:'user',content:[{type:'input_text',text:'image prompt'},{type:'input_image',image_url:imageData,detail:'auto'}]}],status:'running',output:[]};
const imageContext = buildContext([imageTurn],{context_window:200000},32000);
assert.equal(imageContext.input[0].content[1].image_url.length, imageData.length);
const oversizedImages = Array.from({length:5}, () => ({type:'input_image',image_url:imageData,detail:'auto'}));
assert.throws(() => buildContext([{input:[{role:'user',content:oversizedImages}],status:'running',output:[]}],{context_window:1000000},32000),/request_too_large/);
const textTooLarge = {input:[{role:'user',content:[{type:'input_text',text:'x'.repeat(700000)}]}],status:'running',output:[]};
assert.throws(() => buildContext([textTooLarge],{context_window:100000},32000),/context/);
const oversizedRequest = {input:[{role:'user',content:[{type:'input_text',text:'x'.repeat(12 * 1024 * 1024)}]}],status:'running',output:[]};
assert.throws(() => buildContext([oversizedRequest],{context_window:100000000},32000),/request_too_large/);
const output = [
  {type:'reasoning',encrypted_content:'opaque'},
  {type:'message',role:'assistant',content:[{type:'output_text',text:'answer'},{type:'refusal',refusal:'x'}]},
  {type:'tool_call',name:'unsafe'}
];
const kept = continuation(output,true);
assert.equal(kept.length, 2);
assert.equal(kept[0].encrypted_content, 'opaque');
assert.equal(kept[1].content[0].text, 'answer');
assert.equal(continuation(output,false).length,1);
console.log('Chat core: fragmented UTF-8/CRLF, multiline data, terminal states, EOF, context and continuation checks passed.');

// Run the actual UI module in a small DOM/auth/storage harness to control async races.
const chatSource = (await readFile(new URL('../public/chat.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '').replaceAll('import.meta.url', JSON.stringify(new URL('../public/chat.js', import.meta.url).href));
const deferred = () => { let resolve, reject; const promise = new Promise((yes,no) => { resolve=yes; reject=no; }); return {promise,resolve,reject}; };
const account = (id, token = id) => ({user:{id},access_token:token});
const catalogModel = {id:'test-model',display_name:'Test',introduction:'A model for testing.',context_window:10000,max_output_tokens:100,default_max_output_tokens:50,reasoning_efforts:[]};
const catalog = () => ({ok:true,json:async () => ({models:[catalogModel]})});
const tick = () => new Promise(resolve => setImmediate(resolve));
async function settle() { for (let i=0;i<8;i++) await tick(); }
function uiHarness() {
  const elements = new Map(), timers = [], requests = [], writes = [], records = new Map(), initial = deferred();
  let callback, saveHook;
  function element() { return {value:'',options:[],files:[],disabled:false,hidden:false,textContent:'',replaceChildren(){this.options=[];this.value='';},append(){},prepend(){},before(){},setAttribute(){},querySelectorAll(){return [];},add(option){this.options.push(option);if(this.options.length===1)this.value=option.value;}}; }
  const store = {
    async list(userId) { return [...records.values()].filter(chat=>chat.userId===userId).map(chat=>structuredClone(chat)); },
    async save(chat) { const snapshot=structuredClone(chat); writes.push(snapshot); await saveHook?.(snapshot); records.set(`${snapshot.userId}/${snapshot.id}`,snapshot); },
    async delete(userId,id) { records.delete(`${userId}/${id}`); },
    async clear(userId) { for(const [key,chat] of records)if(chat.userId===userId)records.delete(key); }
  };
  const context = vm.createContext({
    ...core,chatStore:store,AbortController,TextEncoder,TextDecoder,Blob,structuredClone,crypto,URL,console,
    document:{getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},createElement:element},
    window:{supabase:{createClient:()=>({auth:{onAuthStateChange(fn){callback=fn;},getSession:()=>initial.promise}})},addEventListener(){}},
    ClubI18n:{t:key=>key},marked:{Renderer:class {},parse:()=>''},DOMPurify:{sanitize:()=>({querySelectorAll:()=>[]})},
    Option:class {constructor(text,value){this.textContent=text;this.value=value;}},
    setTimeout(fn){timers.push(fn);},fetch(url,init){const result=deferred();requests.push({body:JSON.parse(init.body),token:init.headers.Authorization,signal:init.signal,...result});return result.promise;}
  });
  vm.runInContext(chatSource,context,{filename:'chat.js'});
  const evaluate = code => vm.runInContext(code,context);
  return {initial,elements,requests,writes,records,evaluate,store,
    auth(next){callback('SIGNED_IN',next);while(timers.length)timers.shift()();},
    setSaveHook(fn){saveHook=fn;},
    async login(id){this.auth(account(id));requests.at(-1).resolve(catalog());await settle();}
  };
}
{
  const ui=uiHarness();
  await ui.login('B');
  ui.initial.resolve({data:{session:account('A')}});await settle();
  assert.equal(ui.evaluate('session.user.id'),'B','stale startup session must not restore the previous account');
}
{
  const ui=uiHarness();
  await ui.login('A');
  ui.auth(account('A','fresh'));
  assert.equal(ui.requests.length,1,'same-user refresh must preserve the loaded workspace');
  assert.equal(ui.evaluate('session.access_token'),'fresh');
  ui.evaluate("document.getElementById('prompt').value='hello'; void generate();");await settle();
  assert.equal(ui.requests.at(-1).token,'Bearer fresh','generation must use the refreshed token');
  ui.requests.at(-1).resolve({ok:true,headers:new Headers({'content-type':'text/event-stream'}),body:stream(delta)});await settle();
  assert.equal(ui.evaluate('active'),null);
}
{
  const ui=uiHarness();
  ui.auth(account('A','expired'));
  ui.auth(account('A','fresh'));
  ui.requests[0].resolve({ok:false,status:401,json:async()=>({error:'login'})});await settle();
  assert.equal(ui.requests.length,2,'catalog rejected during refresh must retry with the new token');
  assert.equal(ui.requests[1].token,'Bearer fresh');ui.requests[1].resolve(catalog());await settle();
  assert.equal(ui.elements.get('workspace').hidden,false);
}
{
  const ui=uiHarness();
  ui.auth(account('A'));ui.auth(account('B'));
  ui.requests[1].resolve(catalog());await settle();
  ui.requests[0].resolve(catalog());await settle();
  assert.equal(ui.evaluate('current.userId'),'B','late catalog must not overwrite the new account');
  ui.auth(null);
  assert.equal(ui.evaluate('current'),null);assert.equal(ui.elements.get('workspace').hidden,true);
}
{
  const ui=uiHarness();await ui.login('A');
  const finalSave=deferred(), entered=deferred();let saves=0;
  ui.setSaveHook(async chat=>{if(chat.userId==='A'&&++saves===2){entered.resolve();await finalSave.promise;}});
  ui.evaluate("document.getElementById('prompt').value='old account'; void generate();");await settle();
  const oldRequest=ui.requests.at(-1);
  // Let the old request finish only after B has its own workspace.
  await ui.login('B');
  oldRequest.reject(new Error('aborted'));await entered.promise;
  assert.equal(ui.evaluate('current.userId'),'B');
  ui.auth(account('A'));ui.requests.at(-1).resolve(catalog());await settle();
  assert.equal(ui.elements.get('workspace').hidden,true,'returning account must wait for its prior final save');
  finalSave.resolve();await settle();
  assert.equal(ui.evaluate('current.userId'),'A');
  assert.equal(ui.evaluate('current.turns[0].status'),'interrupted');
  assert.ok(ui.writes.every(chat=>chat.userId==='A'),'old generation must only write its original account');
  assert.equal(ui.evaluate('active'),null);
}
{
  const ui=uiHarness();await ui.login('A');
  ui.evaluate("document.getElementById('prompt').value='budget'; void generate();");await settle();
  assert.equal(ui.requests.at(-1).body.max_output_tokens,50,'ordinary chat must use the admin-configured default budget');
  ui.requests.at(-1).resolve({ok:true,headers:new Headers({'content-type':'text/event-stream'}),body:stream(delta)});await settle();
}
{
  const ui=uiHarness();await ui.login('A');
  ui.setSaveHook(async()=>{throw new Error('storage');});
  ui.evaluate("document.getElementById('prompt').value='failed save'; void generate();");await settle();
  assert.equal(ui.evaluate('current.turns[0].status'),'failure','failed initial save must not leave a running turn');
  assert.equal(ui.evaluate('generations.size'),0);assert.equal(ui.evaluate('active'),null);
}
for (const [code, httpStatus] of [['quota',429],['blacklisted',403]]) {
  const ui=uiHarness();await ui.login('A');
  ui.evaluate("document.getElementById('prompt').value='limited'; void generate();");await settle();
  ui.requests.at(-1).resolve({ok:false,status:httpStatus,json:async()=>({error:code})});await settle();
  assert.equal(ui.evaluate('statusKey'),code,'finally must preserve the specific admission error');
  assert.equal(ui.evaluate('active'),null);
  assert.equal(ui.evaluate('current.turns[0].status'),'failure');
}
{
  const ui=uiHarness();await ui.login('A');
  ui.evaluate("document.getElementById('prompt').value='reset'; void generate();");await settle();
  const reset='2026-11-01T00:00:00Z';
  ui.requests.at(-1).resolve({ok:false,status:429,json:async()=>({error:'quota',quota:{global:{daily_limit:10,remaining:0,resets_at:'2026-10-17T00:00:00Z'},periods:[{limit:10,remaining:0,resets_at:reset}]}})});await settle();
  assert.equal(ui.evaluate('statusKey'),'quotaReset');
  assert.equal(ui.evaluate('statusVars.reset'),reset);
  ui.evaluate('render()');
  assert.equal(ui.evaluate('statusVars.reset'),reset,'rerender must retain untranslated reset variables');
}
for (const [terminal,key] of [['response.incomplete','quotaTruncated'],['response.completed','quotaLimited']]) {
  const ui=uiHarness();await ui.login('A');
  ui.evaluate("document.getElementById('prompt').value='short'; void generate();");await settle();
  ui.requests.at(-1).resolve({ok:true,headers:new Headers({'content-type':'text/event-stream','x-chat-quota-limited':'true'}),body:stream(delta+`data: ${JSON.stringify({type:terminal})}\n\n`)});await settle();
  assert.equal(ui.evaluate('statusKey'),key);
  assert.equal(ui.evaluate('current.turns[0].text'),'你好');
  assert.equal(ui.evaluate('current.turns[0].quotaLimited'),true);
}
{
  const ui=uiHarness();ui.auth(account('A'));
  ui.requests.at(-1).resolve({ok:false,status:403,json:async()=>({error:'blacklisted'})});await settle();
  assert.equal(ui.evaluate('gateKey'),'blacklisted');
  assert.equal(ui.elements.get('workspace').hidden,true);
}
{
  const ui=uiHarness();await ui.login('A');
  assert.equal(ui.elements.get('modelIntroductionText').textContent,catalogModel.introduction);
  ui.evaluate("models.push({...models[0],id:'second',introduction:'Second introduction'}); document.getElementById('model').value='second'; configureModel();");
  assert.equal(ui.elements.get('modelIntroductionText').textContent,'Second introduction');
}
console.log('Chat UI: auth isolation, fixed output budget, introductions, quota/blacklist errors, reset variables and limited SSE preservation passed.');
