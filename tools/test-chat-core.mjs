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
const assistantCopy = await readFile(new URL('../public/assistant-i18n.js', import.meta.url), 'utf8');
const DICT = new Set(['chat.thinking','chat.thinkingRunning','chat.thinkingNote','chat.effort_off','chat.effort_low','chat.effort_medium','chat.effort_high','chat.effort_xhigh','chat.effort_max','chat.effortShort','chat.default','chat.claudeEffort','chat.claude_thinking','chat.claude_thinking_budget','chat.claude_effort']);
const deferred = () => { let resolve, reject; const promise = new Promise((yes,no) => { resolve=yes; reject=no; }); return {promise,resolve,reject}; };
const account = (id, token = id) => ({user:{id},access_token:token});
const catalogModel = {id:'test-model',display_name:'Test',introduction:'A model for testing.',context_window:10000,max_output_tokens:100,default_max_output_tokens:50,reasoning_efforts:[]};
const catalog = () => ({ok:true,json:async () => ({models:[catalogModel]})});
const tick = () => new Promise(resolve => setImmediate(resolve));
async function settle() { for (let i=0;i<8;i++) await tick(); }
function uiHarness({assistant = false, embedded = false, protocol = 'https:'} = {}) {
  const elements = new Map(), timers = [], requests = [], writes = [], records = new Map(), initial = deferred(), copied = [], messages = [], events = new Map(), documentEvents = new Map(), databases = [];
  const origin = protocol === 'file:' ? 'null' : 'https://club.example';
  const frameParent = {postMessage(data,target){messages.push({data,target});}};
  let callback, saveHook, lang = 'zh';
  const assistantDict = {};
  const i18n = {
    mergeDict(dict) { Object.assign(assistantDict, dict); },
    t(key, vars = {}) {
      const value = key.startsWith('assistant.') ? assistantDict[lang]?.assistant?.[key.slice(10)] : undefined;
      return value === undefined ? DICT.has(key) ? `[${lang === 'en' ? 'en:' : ''}${key}]` : key : value.replace(/\{(\w+)\}/g, (match, name) => String(vars[name] ?? match));
    },
    getLang:()=>lang
  };
  function element(tagName = 'div') { return {
    tagName:String(tagName).toUpperCase(),children:[],attributes:{},innerHTML:'',open:false,
    value:'',options:[],files:[],disabled:false,hidden:false,textContent:'',
    // 真实 <select> 会按 value 反查当前项，桩必须同样支持，否则读不到默认强度。
    get selectedIndex(){ const i=this.options.findIndex(o=>o.value===this.value); return i<0?0:i; },
    reportValidity(){return true;},
    replaceChildren(...nodes){this.options=[];this.value='';this.children=[];this.append(...nodes);},
    append(...nodes){this.children.push(...nodes);this.options.push(...nodes.filter(node=>node instanceof context.Option));if(!this.value&&this.options.length)this.value=this.options[0].value;},
    prepend(...nodes){this.children.unshift(...nodes);},before(){},setAttribute(key,value){this.attributes[key]=String(value);},querySelectorAll(){return [];},
    add(option){this.options.push(option);if(this.options.length===1)this.value=option.value;}
  }; }
  const store = {
    async list(userId) { return [...records.values()].filter(chat=>chat.userId===userId).map(chat=>structuredClone(chat)); },
    async save(chat) { const snapshot=structuredClone(chat); writes.push(snapshot); await saveHook?.(snapshot); records.set(`${snapshot.userId}/${snapshot.id}`,snapshot); },
    async delete(userId,id) { records.delete(`${userId}/${id}`); },
    async clear(userId) { for(const [key,chat] of records)if(chat.userId===userId)records.delete(key); }
  };
  const context = vm.createContext({
    ...core,chatStore:store,createChatStore(name){databases.push(name);return store;},AbortController,TextEncoder,TextDecoder,Blob,structuredClone,crypto,URL,URLSearchParams,console,
    location: {pathname:`/project/public/${assistant ? 'assistant' : 'chat'}.html`,search:embedded ? '?embed=1' : '',protocol,origin},
    parent: embedded ? frameParent : undefined,
    document:{getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},createElement:element,querySelectorAll:()=>[],addEventListener(type,handler){documentEvents.set(type,handler);}},
    window:{supabase:{createClient:()=>({auth:{onAuthStateChange(fn){callback=fn;},getSession:()=>initial.promise}})},addEventListener(type,handler){events.set(type,handler);}},
    // 桩 t() 必须像真实 runtime 一样「缺键返回 key」；否则 effortLabel 无法区分已翻译与回退。
    ClubI18n:i18n,marked:{Renderer:class {},parse:()=>''},DOMPurify:{sanitize:()=>({querySelectorAll:()=>[]})},
    navigator:{clipboard:{async writeText(value){copied.push(value);}}},
    Option:class {constructor(text,value){this.textContent=text;this.value=value;}},
    setTimeout(fn){timers.push(fn);},fetch(url,init){const result=deferred(), body=JSON.parse(init.body);requests.push({url,headers:init.headers,body,token:init.headers.Authorization,signal:init.signal,...result});if(body.action==='custom_model_list') result.resolve({ok:true,json:async()=>[]});return result.promise;}
  });
  const source = assistant ? chatSource.replaceAll(JSON.stringify(new URL('../public/chat.js', import.meta.url).href), JSON.stringify(protocol === 'file:' ? 'file:///site/project/public/chat.js' : 'https://club.example/project/public/chat.js')) : chatSource;
  if (assistant) {
    context.window.ClubI18n = i18n;
    vm.runInContext(assistantCopy, context, {filename:'assistant-i18n.js'});
  }
  vm.runInContext(source,context,{filename:'chat.js'});
  const evaluate = code => vm.runInContext(code,context);
  return {initial,elements,requests,writes,records,evaluate,store,copied,messages,events,documentEvents,databases,
    message(data,source = frameParent,messageOrigin = origin){events.get('message')?.({data,source,origin:messageOrigin});},
    setLang(value){lang=value;evaluate('refreshLocalizedUi()');},
    auth(next){callback('SIGNED_IN',next);while(timers.length)timers.shift()();},
    setSaveHook(fn){saveHook=fn;},
    async login(id){this.auth(account(id));requests.at(-1).resolve(catalog());await settle();if(requests.at(-1).body.action==='custom_model_list') requests.at(-1).resolve({ok:true,json:async()=>[]});await settle();}
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
  assert.equal(ui.requests.length,2,'same-user refresh must preserve the loaded workspace and refresh custom profiles');
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
  assert.equal(ui.requests.length,3,'profile listing follows the successful catalog response');
  ui.requests[2].resolve({ok:true,json:async()=>[]});await settle();
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

// Exercise the real disclosure nodes and generation persistence, without a paid provider.
{
  const ui = uiHarness(); await ui.login('thinking-ui');
  const exposed = '<img src=x onerror=alert(1)>\nReadable provider summary';
  ui.evaluate(`current.turns=[{id:'thinking-turn',prompt:'question',input:[],output:[],text:'Answer only',thinking:${JSON.stringify(exposed)},status:'running'}];renderMessages()`);
  let node = ui.evaluate('rendered.nodes[0]');
  assert.equal(node.thinking.tagName, 'DETAILS');
  assert.equal(node.thinkingLabel.tagName, 'SUMMARY');
  assert.equal(node.thinking.open, false, 'thinking starts collapsed');
  assert.equal(node.thinking.hidden, false);
  assert.equal(node.thinkingLabel.textContent, '[chat.thinkingRunning]');
  assert.equal(node.thinkingBody.textContent, exposed, 'provider text is assigned through textContent');
  assert.equal(node.thinkingBody.innerHTML, '', 'provider text never uses the raw HTML setter');
  assert.equal(node.thinkingBody.children.length, 0);
  assert.ok(node.assistant.children[1].children.indexOf(node.thinking) < node.assistant.children[1].children.indexOf(node.mark), 'thinking precedes the answer');
  node.thinking.open = true;
  ui.evaluate("current.turns[0].thinking+=' streamed';current.turns[0].text+=' streamed';renderMessages()");
  assert.equal(ui.evaluate('rendered.nodes[0]'), node, 'streaming updates preserve the native details node');
  assert.equal(node.thinking.open, true);
  node.aiActions.children[0].onclick(); await settle();
  assert.equal(ui.copied.at(-1), 'Answer only streamed', 'copy must contain only the answer');
  ui.setLang('en'); node = ui.evaluate('rendered.nodes[0]');
  assert.equal(node.thinking.open, true, 'language rebuild preserves an opened disclosure even before toggle fires');
  assert.equal(node.thinkingLabel.textContent, '[en:chat.thinkingRunning]');
  assert.equal(node.thinkingNote.textContent, '[en:chat.thinkingNote]');
  assert.equal(ui.evaluate('current.turns[0].thinking'), exposed + ' streamed', 'language changes leave stored provider text untouched');
  node.thinking.open = false;
  ui.setLang('zh'); node = ui.evaluate('rendered.nodes[0]');
  assert.equal(node.thinking.open, false, 'language rebuild also preserves a closed disclosure');
  ui.evaluate("current.turns[0].status='interrupted';current.turns[0].text='';renderMessages()");
  assert.equal(node.thinkingLabel.textContent, '[chat.thinking]');
  assert.equal(node.mark.hidden, true, 'thinking-only output never gets an empty answer bubble');
  assert.equal(node.thinking.hidden, false);
  ui.evaluate("current.turns[0].thinking='';current.turns[0].text='search_results and ordinary prose';renderMessages()");
  assert.equal(node.thinking.hidden, true, 'ordinary answer prose is never classified as thinking');
  assert.equal(node.mark.hidden, false);
  ui.evaluate("current.turns[0].output=[{type:'reasoning',encrypted_content:'SECRET',summary:[{type:'summary_text',text:'Older readable summary'}]}];renderMessages()");
  assert.equal(node.thinkingBody.textContent, 'Older readable summary', 'older saved output summaries remain readable');
  assert.equal(node.thinking.hidden, false);
}
for (const outcome of ['success','interrupted','cancelled']) {
  const ui = uiHarness(); await ui.login(`thinking-${outcome}`);
  const exposed = `retained ${outcome} thinking`;
  ui.evaluate(`readResponses=async (_body,onUpdate)=>{onUpdate({text:'',thinking:${JSON.stringify(exposed)},output:[],status:'running'});${outcome === 'success' ? "return {text:'final answer',thinking:'final thinking',output:[],status:'success'};" : `active.stopped=${outcome === 'cancelled'};active.controller.abort();throw new Error('aborted');`}};document.getElementById('prompt').value='thinking persistence';void generate()`);
  await settle();
  ui.requests.at(-1).resolve({ok:true,headers:new Headers({'content-type':'text/event-stream'}),body:stream('')}); await settle();
  assert.equal(ui.evaluate('current.turns[0].status'), outcome);
  const expected = outcome === 'success' ? 'final thinking' : exposed;
  assert.equal(ui.evaluate('current.turns[0].thinking'), expected);
  assert.equal(ui.writes.at(-1).turns[0].thinking, expected, 'whole-conversation storage retains received thinking');
  assert.equal(ui.writes.at(-1).turns[0].text, outcome === 'success' ? 'final answer' : '');
}
console.log('Chat UI: native thinking disclosure, safe text, answer-only copy, streaming/language state, legacy summaries and success/interruption/cancellation persistence passed.');

/* ---------- 编辑重发 / 指定轮次重试 / 上下文压缩 ---------- */
const completedEvent = `data: ${JSON.stringify({type:'response.completed',response:{output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'你好！'}]}],usage:{output_tokens:3}}})}\n\n`;
const okStream = () => ({ok:true,headers:new Headers({'content-type':'text/event-stream'}),body:stream(delta + completedEvent)});
/** 发一轮并让它成功完成，返回该轮 id。 */
async function sendTurn(ui, text) {
  ui.evaluate(`document.getElementById('prompt').value=${JSON.stringify(text)}; void generate();`);
  await settle();
  ui.requests.at(-1).resolve(okStream());
  await settle();
  return ui.evaluate(`current.turns.at(-1).id`);
}
{
  const ui = uiHarness();
  await ui.login('A');
  const first = await sendTurn(ui, 'first question');
  const second = await sendTurn(ui, 'second question');
  assert.equal(ui.evaluate('current.turns.length'), 2);

  // 编辑第一条并重发：第二条必须被移除，第一条的提示词被替换。
  ui.evaluate(`startEdit(${JSON.stringify(first)})`);
  assert.equal(ui.evaluate(`document.getElementById('prompt').value`), 'first question');
  assert.equal(ui.evaluate('editingTurnId'), first);
  ui.evaluate(`document.getElementById('prompt').value='edited question'; void generate();`);
  await settle();
  assert.equal(ui.evaluate('editingTurnId'), null, 'editing state must clear once the request starts');
  assert.equal(ui.evaluate('current.turns.length'), 1, 'editing must drop every later turn');
  assert.equal(ui.evaluate('current.turns[0].prompt'), 'edited question');
  assert.equal(ui.requests.at(-1).body.input[0].content[0].text, 'edited question');
  ui.requests.at(-1).resolve(okStream());
  await settle();
  assert.equal(ui.evaluate('current.turns[0].status'), 'success');
  assert.ok(ui.evaluate('Boolean(current.turns[0].id !== ' + JSON.stringify(first) + ')'), 'edited turn gets a fresh id');
  assert.ok(ui.evaluate('Boolean(current.turns[0].id !== ' + JSON.stringify(second) + ')'));
}
{
  // 重试较早的一轮同样截断其后内容，并复用原提示词（而不是输入框内容）。
  const ui = uiHarness();
  await ui.login('A');
  const first = await sendTurn(ui, 'keep me');
  await sendTurn(ui, 'drop me');
  // 无 DOM 环境没有全局 confirm，先注入再触发（regenerate 会先询问是否丢弃后续轮次）。
  ui.evaluate('window.confirm = () => true; globalThis.confirm = () => true;');
  ui.evaluate(`document.getElementById('prompt').value='unrelated draft'; void regenerate(${JSON.stringify(first)});`);
  await settle();
  assert.equal(ui.evaluate('current.turns.length'), 1);
  assert.equal(ui.evaluate('current.turns[0].prompt'), 'keep me');
  assert.equal(ui.requests.at(-1).body.input[0].content[0].text, 'keep me', 'retry must not reuse the draft in the textarea');
  ui.requests.at(-1).resolve(okStream());
  await settle();
}
{
  // 自动压缩发生在「回复完成之后」：完成一个回复 → 触发摘要请求 → 下一次发送带上摘要前缀。
  const ui = uiHarness();
  await ui.login('A');
  await sendTurn(ui, 'a'.repeat(300));
  await sendTurn(ui, 'b'.repeat(300));
  // 把窗口调小到本次回复结束后必然越过 85% 阈值。
  ui.evaluate(`models[0].context_window = 220; models[0].default_max_output_tokens = 50; configureModel();`);
  const before = ui.requests.length;
  ui.evaluate("document.getElementById('prompt').value='c'.repeat(300); void generate();");
  await settle();
  // 先完成这一轮回复；压缩应在其后的 finally 中自动发起。
  ui.requests.slice(before).find(r => r.body.action === 'respond' || r.body.input?.[0]?.content?.[0]?.text?.endsWith('compact'))?.resolve(okStream());
  await settle();
  const summaryRequest = ui.requests.slice(before).find(r => r.body.input?.[0]?.content?.[0]?.text?.includes('chat.summaryInstruction'));
  assert.ok(summaryRequest, 'compaction must run automatically after the reply completes');
  assert.equal(ui.evaluate('compacting'), true, 'compaction must lock the composer while it runs');
  assert.equal(ui.evaluate("document.getElementById('prompt').disabled"), true, 'prompt must be disabled during compaction');
  summaryRequest.resolve(okStream());
  await settle();
  assert.equal(ui.evaluate('compacting'), false, 'compaction must release the lock when it finishes');
  assert.equal(ui.evaluate('statusKey'), 'compacted');
  assert.ok(ui.evaluate('Boolean(current.summary?.text)'), 'summary must be stored on the conversation');
  assert.ok(ui.evaluate('current.turns.length >= 2'), 'compaction must never summarize away the whole conversation');

  // 下一次发送：摘要作为系统前缀，而不是重新生成摘要。
  const before2 = ui.requests.length;
  ui.evaluate("document.getElementById('prompt').value='next question'; void generate();");
  await settle();
  const next = ui.requests.slice(before2).find(r => r.body.input?.[0]?.role === 'system');
  assert.ok(next, 'the stored summary must be sent as the first input item next time');
  assert.match(next.body.input[0].content[0].text, /compressed/i);
  next.resolve(okStream());
  await settle();
}

/* buildContext：摘要前缀独立占预算，不会把最后一轮挤出上下文。 */
{
  const prefix = [{role:'system',content:[{type:'input_text',text:'x'.repeat(90)}]}];
  const one = [{input:[{role:'user',content:[{type:'input_text',text:'y'.repeat(30)}]}],status:'success',output:[]}];
  const withPrefix = buildContext(one,{context_window:120},10,prefix);
  assert.equal(withPrefix.input.length, 1 + 1, 'last turn must survive alongside the summary');
  assert.equal(withPrefix.input[0].role, 'system');
  assert.throws(() => buildContext(one,{context_window:40},10,prefix), /context/, 'an oversized summary must fail rather than silently drop the turn');
  const fits = buildContext(one,{context_window:120},10);
  assert.equal(fits.input.length, 1, 'without a prefix behaviour is unchanged');
}
console.log('Chat UI: edit-and-resend truncation, per-turn retry, and summary-prefixed compaction passed.');

/* 思考强度标签：none/xhigh/max 必须映射到词典，而不是回显英文原始值。 */
{
  const ui = uiHarness();
  await ui.login('A');
  ui.evaluate(`models[0].reasoning_efforts=['none','low','medium','high','xhigh','max']; models[0].default_reasoning_effort='xhigh'; configureModel();`);
  const labels = ui.evaluate(`[...document.getElementById('effort').options].map(o => effortLabel(o.value))`);
  // VM 沙箱里的数组来自另一个 realm，deepEqual 会因原型不同误判，逐项比较。
  assert.equal(labels.join(','), ['[chat.effort_off]','[chat.effort_low]','[chat.effort_medium]','[chat.effort_high]','[chat.effort_xhigh]','[chat.effort_max]'].join(','),
    'each known level must resolve to its dictionary entry');
  assert.equal(ui.evaluate('effortLabel("XHigh")'), '[chat.effort_xhigh]', 'matching must be case-insensitive');
  assert.equal(ui.evaluate('effortLabel("x-high")'), '[chat.effort_xhigh]', 'hyphenated vendor spelling maps to the same level');
  assert.equal(ui.evaluate('effortLabel("ultra")'), 'ultra', 'unknown vendor values are shown verbatim');
  assert.equal(ui.evaluate('effortLabel("")'), '[chat.default]', 'empty value falls back to Default');
  assert.equal(ui.evaluate("document.getElementById('effortTriggerText').textContent"), '[chat.effortShort] [chat.effort_xhigh]');
  assert.equal(ui.evaluate("document.getElementById('effortPicker').hidden"), false);
}
console.log('Chat UI: reasoning-effort labels map none/xhigh/max and vendor values passed.');

{
  const ui = uiHarness(); await ui.login('Claude');
  const old = {reasoning_efforts:['low','medium','high'],default_reasoning_effort:'low'};
  for (const mode of [null, 'omit', 'disabled', 'enabled', 'adaptive']) {
    const config = mode ? {mode, budget_tokens:1024, efforts:['high','max'], default_effort:'max'} : undefined;
    ui.evaluate(`Object.assign(models[0],${JSON.stringify({...old,api_protocol:'messages',claude_thinking:config})});configureModel()`);
    assert.equal(ui.evaluate("document.getElementById('effortPicker').hidden"), mode !== 'adaptive', 'Only dedicated adaptive Messages efforts can show the picker');
    assert.equal(ui.evaluate("document.getElementById('effort').value"), mode === 'adaptive' ? 'max' : '');
    if (mode === 'adaptive') {
      assert.deepEqual(Array.from(ui.evaluate("[...document.getElementById('effort').options].map(row=>row.value)")), ['', 'high', 'max']);
      assert.equal(ui.evaluate("document.getElementById('effortTriggerText').textContent"), '[chat.claudeEffort] [chat.effort_max]');
    }
    ui.evaluate("document.getElementById('effort').value='low';document.getElementById('prompt').value='no stale generic replay';void generate()"); await settle();
    const req = ui.requests.at(-1);
    assert.equal(req.body.reasoning_effort, null, 'Even an injected stale generic selection must not reach generation');
    req.resolve({ok:true,headers:new Headers({'content-type':'text/event-stream'}),body:stream(delta)}); await settle();
  }
  ui.evaluate("models[0].claude_thinking={mode:'adaptive',efforts:['high'],default_effort:null};configureModel();document.getElementById('prompt').value='draft retained';document.getElementById('effort').value='high';refreshLocalizedUi()");
  assert.equal(ui.evaluate("document.getElementById('effort').value"), 'high', 'Language refresh preserves chosen adaptive effort');
  assert.equal(ui.evaluate("document.getElementById('prompt').value"), 'draft retained');
  ui.evaluate('void generate()'); await settle();
  assert.equal(ui.requests.at(-1).body.reasoning_effort, 'high');
  ui.requests.at(-1).resolve({ok:true,headers:new Headers({'content-type':'text/event-stream'}),body:stream(delta)}); await settle();
  ui.evaluate("models[0].claude_thinking={mode:'adaptive',efforts:['high'],default_effort:'stale'};configureModel()");
  assert.equal(ui.evaluate("document.getElementById('effort').value"), '', 'Unlisted default uses native provider default');
  ui.evaluate("delete models[0].api_protocol;configureModel()");
  assert.equal(ui.evaluate("document.getElementById('effort').value"), 'low', 'Older catalogs without resolved protocol keep generic compatibility');
  assert.equal(ui.evaluate("document.getElementById('effortPicker').hidden"), false);
  for (const error of ['claude_thinking','claude_thinking_budget','claude_effort']) {
    ui.evaluate("document.getElementById('prompt').value='localized error';void generate()"); await settle();
    ui.requests.at(-1).resolve({ok:false,status:400,json:async()=>({error})}); await settle();
    assert.equal(ui.evaluate('statusKey'), error);
    assert.equal(ui.evaluate("document.getElementById('status').textContent"), `[chat.${error}]`);
  }
}
console.log('Chat UI: Messages omit/nonadaptive suppress old efforts, adaptive native defaults/efforts, language drafts, legacy catalog fallback and localized errors passed.');

// Native protocols use the same Responses-shaped conversation store and adapters.
const proxyRoot = 'https://jgezpvmlnhycxslqbwcx.supabase.co/functions/v1/chat-api-proxy/22222222-2222-4222-8222-222222222222';
const sse = (...events) => events.map(event => `data: ${JSON.stringify(event)}\r\n\r\n`).join('');
function nativeStream(protocol, text = '原生 reply', reason) {
  return protocol === 'messages' ? sse(
    {type:'message_start',message:{usage:{input_tokens:7,output_tokens:0,cache_read_input_tokens:2}}},
    {type:'content_block_start',index:0,content_block:{type:'text',text:''}},
    {type:'content_block_delta',index:0,delta:{type:'text_delta',text}},
    {type:'message_delta',delta:{stop_reason:reason || 'end_turn'},usage:{output_tokens:3}},
    {type:'message_stop'}
  ) : sse(
    {choices:[{index:0,delta:{content:text},finish_reason:null}]},
    {choices:[{index:0,delta:{},finish_reason:reason || 'stop'}]},
    {choices:[],usage:{prompt_tokens:9,completion_tokens:3,total_tokens:12}}
  ) + 'data: [DONE]\r\n\r\n';
}
for (const [suffix, protocol, target] of [
  ['', 'responses','/v1/responses'], ['/v1','responses','/v1/responses'], ['/v1/responses','responses','/v1/responses'],
  ['/v1/message','messages','/v1/messages'], ['/v1/messages','messages','/v1/messages'], ['/messages','messages','/messages'],
  ['/v1/chat/completions','chat_completions','/v1/chat/completions'], ['/chat/completions','chat_completions','/chat/completions']
]) {
  assert.equal(core.chatEndpoint(proxyRoot + suffix,true).protocol,protocol);
  assert.equal(core.chatEndpoint(proxyRoot + suffix,true).url,proxyRoot + target);
  const ui=uiHarness();
  assert.equal(ui.evaluate(`customUrl(${JSON.stringify(proxyRoot + suffix)})`),proxyRoot + suffix);
}
assert.equal(core.chatEndpoint('https://provider.example/v1').url,'https://provider.example/v1/responses');
for (const invalid of [proxyRoot + '/other',proxyRoot + '/v1/models',proxyRoot + '/v1/messages/extra',proxyRoot + '?key=x',proxyRoot + '#x',proxyRoot.replace('supabase.co','supabase.co.evil.test'),proxyRoot.replace('https://','http://'),proxyRoot.replace('https://','https://user:pass@')]) {
  const ui=uiHarness();
  assert.throws(()=>ui.evaluate(`customUrl(${JSON.stringify(invalid)})`),/proxy_url/);
}
const nativeInput = [
  {role:'system',content:[{type:'input_text',text:'compressed summary'}]},
  {role:'user',content:[{type:'input_text',text:'question'},{type:'input_image',image_url:'data:image/png;base64,aGVsbG8=',detail:'low'},{type:'input_file',filename:'scan.pdf',file_data:'data:application/pdf;base64,JVBERg=='}]},
  {type:'message',role:'assistant',content:[{type:'output_text',text:'prior answer'}]}
];
for (const protocol of ['messages','chat_completions']) {
  const payload=core.nativeRequest({model:'native',input:nativeInput,max_output_tokens:90},protocol);
  assert.equal(payload.model,'native'); assert.equal(payload.input,undefined);
  if (protocol === 'messages') {
    assert.equal(payload.system[0].text,'compressed summary');
    assert.equal(payload.messages[0].content[1].source.media_type,'image/png');
    assert.equal(payload.messages[0].content[2].source.data,'JVBERg==');
    assert.equal(payload.max_tokens,90);
  } else {
    assert.equal(payload.messages[0].role,'system');
    assert.equal(payload.messages[1].content[1].image_url.detail,'low');
    assert.equal(payload.messages[1].content[2].file.filename,'scan.pdf');
    assert.equal(payload.max_completion_tokens,90);
  }
  assert.throws(()=>core.nativeRequest({input:[{type:'reasoning',encrypted_content:'opaque'}]},protocol),/request/);
  assert.throws(()=>core.nativeRequest({input:[{role:'user',content:[{type:'input_file',file_id:'not-portable'}]}]},protocol),/pdf/);
  const result=await readResponses(stream(nativeStream(protocol)),()=>{},protocol);
  assert.equal(result.text,'原生 reply');assert.equal(result.status,'success');
  assert.deepEqual(result.usage,{input_tokens:9,output_tokens:3,total_tokens:12});
  assert.equal(continuation(result.output,false)[0].content[0].text,'原生 reply');
  assert.equal((await readResponses(stream(nativeStream(protocol,'partial',protocol === 'messages' ? 'max_tokens' : 'length')),()=>{},protocol)).status,'incomplete');
  assert.equal((await readResponses(stream(nativeStream(protocol,'partial',protocol === 'messages' ? 'tool_use' : 'tool_calls')),()=>{},protocol)).status,'failure');
  const partial=protocol === 'messages' ? sse({type:'content_block_delta',index:0,delta:{type:'text_delta',text:'partial'}}) : sse({choices:[{index:0,delta:{content:'partial'}}]});
  assert.equal((await readResponses(stream(partial),()=>{},protocol)).status,'interrupted');
  assert.equal((await readResponses(stream(sse({error:{message:'failed'}})),()=>{},protocol)).status,'failure');
  const json=protocol === 'messages' ? {content:[{type:'text',text:'json answer'}],stop_reason:'end_turn',usage:{input_tokens:2,output_tokens:1}} : {choices:[{index:0,message:{content:'json answer'},finish_reason:'stop'}],usage:{prompt_tokens:2,completion_tokens:1}};
  assert.equal(core.normalizeChatResponse(json,protocol).text,'json answer');
  assert.equal(core.normalizeChatResponse(json,protocol).status,'success');
}
for (const protocol of ['messages','chat_completions']) {
  const ui=uiHarness();await ui.login('native-user');
  const suffix=protocol === 'messages' ? '/v1/message' : '/v1/chat/completions';
  ui.evaluate(`customModels=[{id:'native-profile',display_name:'Native',model_key:'native-model',base_url:${JSON.stringify(proxyRoot + suffix)}}]; models=mergeModels(models,customModels); customKeys.set('native-profile','MEMORY_ONLY'); document.getElementById('model').replaceChildren(...models.map(item=>new Option(item.display_name,item.id))); document.getElementById('model').value='custom:native-profile'; configureModel();`);
  ui.evaluate("document.getElementById('prompt').value='native first'; void generate();");await settle();
  let req=ui.requests.at(-1);
  assert.equal(req.body.model,'native-model');assert.equal(req.body.input,undefined);
  assert.equal(req.token,'Bearer MEMORY_ONLY');
  assert.equal(req.url,proxyRoot + (protocol === 'messages' ? '/v1/messages' : suffix));
  req.resolve({ok:true,headers:new Headers({'content-type':'text/event-stream'}),body:stream(nativeStream(protocol))});await settle();
  assert.equal(ui.evaluate('current.turns[0].status'),'success');
  assert.equal(ui.evaluate('current.turns[0].text'),'原生 reply');
  ui.evaluate("current.summary={text:'summary carried',turns:0}; document.getElementById('prompt').value='second'; void generate();");await settle();
  req=ui.requests.at(-1);
  const messages=req.body.messages;
  assert(messages.some(message=>message.role === 'assistant' && message.content[0].text === '原生 reply'));
  assert(protocol === 'messages' ? req.body.system[0].text.includes('summary carried') : messages[0].content[0].text.includes('summary carried'));
  req.resolve({ok:true,headers:new Headers({'content-type':'text/event-stream'}),body:stream(nativeStream(protocol))});await settle();
  ui.evaluate("void ensureContextSummary(current,model(),8192,epoch,true)");await settle();
  req=ui.requests.at(-1);
  assert(req.body.messages[0].content[0].text.includes('chat.summaryInstruction'),'compression must pass through the native adapter');
  req.resolve({ok:true,headers:new Headers({'content-type':'text/event-stream'}),body:stream(nativeStream(protocol,'native summary'))});await settle();
  assert.equal(ui.evaluate('current.summary.text'),'native summary');
  assert(!JSON.stringify(ui.writes).includes('MEMORY_ONLY'),'API key must never enter conversation persistence');
  // Switching back to a catalog model must replay only normalized assistant text.
  ui.evaluate("document.getElementById('model').value=models[0].id; configureModel(); document.getElementById('prompt').value='switched'; void generate();");await settle();
  req=ui.requests.at(-1);assert.equal(req.body.action,'respond');
  assert(req.body.input.some(item=>item.role === 'assistant' && item.content[0].type === 'output_text'));
  req.resolve(okStream());await settle();
  ui.auth(null);assert.equal(ui.evaluate('customKeys.size'),0);
}
console.log('Chat native protocols: URL whitelist/alias/defaults, text/images/PDF, summary/continuation/model switch, usage, JSON/SSE and memory-only keys passed.');
{
  const ui=uiHarness();await ui.login('A');
  ui.evaluate(`document.getElementById('customModelName').value='Saved native'; document.getElementById('customModelKey').value='claude'; document.getElementById('customBaseUrl').value=${JSON.stringify(proxyRoot + '/v1/messages')}; document.getElementById('customApiKey').value='PRIVATE_MEMORY_ONLY'; void saveCustomModel({preventDefault(){}});`);
  await settle();
  const req=ui.requests.at(-1);
  assert.equal(req.body.action,'custom_model_save');
  assert.equal(req.body.base_url,proxyRoot + '/v1/messages');
  assert(!JSON.stringify(req.body).includes('PRIVATE_MEMORY_ONLY'));
  assert.deepEqual(Object.keys(req.body).sort(),['action','id','display_name','model_key','base_url','expected_version'].sort(),'save uses only existing metadata fields');
  ui.auth(null);
  req.resolve({ok:true,json:async()=>({model:{id:req.body.id,display_name:'Saved native',model_key:'claude',base_url:req.body.base_url}})});await settle();
  assert.equal(ui.evaluate('customKeys.size'),0,'late profile save after signout cannot restore a key');
  assert.equal(ui.evaluate('customModels.length'),0);
}
// Bundled core shares scope with the app URL constant: use the platform constructor explicitly.
const coreSource=await readFile(new URL('../public/chat-core.js',import.meta.url),'utf8');
const bundledCore=vm.createContext({URL,TextEncoder,TextDecoder,ReadableStream,console});
vm.runInContext(coreSource.replace(/^export /gm,'') + `\nconst URL='app base URL'; globalThis.bundleEndpoint=chatEndpoint('https://provider.example/v1/messages');`,bundledCore);
assert.equal(bundledCore.bundleEndpoint.protocol,'messages');

for (const assistant of [false,true]) {
  const ui=uiHarness({assistant});
  ui.evaluate('globalThis.mathCalled=0;window.ChatMath={renderMarkdown(text,options){mathCalled++;if(text!=="**answer**"||typeof options.decorateCode!=="function")throw Error("math contract");return {mathFragment:true};}}');
  assert.equal(ui.evaluate('markdown("**answer**").mathFragment'),true,'both workspaces use the shared math renderer');
  assert.equal(ui.evaluate('mathCalled'),1);
}

// Dedicated assistant uses the same controller with isolated storage and server-managed requests.
for (const protocol of ['https:', 'file:']) {
  const ui = uiHarness({assistant:true,embedded:true,protocol});
  assert.deepEqual(ui.databases,['club-ai-assistant']);
  assert.equal(ui.messages[0].data.action,'ready','ready must precede authentication');
  assert.equal(ui.requests.length,0);
  ui.message({type:'club-assistant',action:'sync',modal:true},{},protocol === 'file:' ? 'null' : 'https://club.example');
  assert.equal(ui.evaluate('assistantModal'),false,'untrusted window cannot synchronize frame');
  ui.message({type:'club-assistant',action:'sync',modal:true},undefined,'https://evil.example');
  assert.equal(ui.evaluate('assistantModal'),false,'wrong origin rejected');
  ui.message({type:'club-assistant',action:'sync',modal:true});
  assert.equal(ui.evaluate('assistantModal'),true);
  ui.evaluate('globalThis.focused="";globalThis.firstFocus={tabIndex:0,getClientRects:()=>[{}],focus:()=>{focused="first"}};globalThis.lastFocus={tabIndex:0,getClientRects:()=>[{}],focus:()=>{focused="last"}};document.querySelectorAll=()=>[firstFocus,lastFocus]');
  ui.message({type:'club-assistant',action:'focus',direction:'first'});assert.equal(ui.evaluate('focused'),'first');
  ui.message({type:'club-assistant',action:'focus',direction:'last'});assert.equal(ui.evaluate('focused'),'last');
  ui.evaluate('document.activeElement=lastFocus');
  ui.documentEvents.get('keydown')({key:'Tab',shiftKey:false,preventDefault(){}});
  assert.equal(ui.messages.at(-1).data.direction,'next');
  ui.evaluate('document.activeElement=firstFocus');
  ui.documentEvents.get('keydown')({key:'Tab',shiftKey:true,preventDefault(){}});
  assert.equal(ui.messages.at(-1).data.direction,'previous');
  ui.message({type:'club-assistant',action:'sync',modal:false});
  const count=ui.messages.length;ui.documentEvents.get('keydown')({key:'Tab',shiftKey:true,preventDefault(){}});
  assert.equal(ui.messages.length,count,'desktop leaves native tab order alone');
  ui.evaluate('document.querySelectorAll=()=>[]');
  ui.auth(account('assistant-user'));
  assert.equal(ui.requests.at(-1).body.action,'assistant_catalog');
  ui.requests.at(-1).resolve({ok:true,json:async()=>({models:[{...catalogModel,context_window:10000,default_max_output_tokens:50}],assistant:{reserve_tokens:1000,welcome:'Welcome',suggestions:['Question']}})}); await settle();
  assert.equal(ui.requests.length,1,'assistant never loads custom model profiles');
  assert.equal(ui.elements.get('assistantModelName').textContent,catalogModel.display_name,'configured model name is visible before any answer');
  ui.setLang('en');assert.equal(ui.elements.get('assistantModelName').textContent,catalogModel.display_name,'language refresh preserves the configured name');
  assert.equal(ui.evaluate('contextBudget(model(),50)'),8950);
  assert.equal(ui.evaluate('summaryPrefix({summary:{text:"memory"}}).length'),0,'summary sent once as explicit field');
  ui.evaluate('current.summary={text:"memory",turns:0};document.getElementById("prompt").value="question";void generate()'); await settle();
  const request=ui.requests.at(-1);
  assert.deepEqual(Object.keys(request.body).sort(),['action','input','summary']);
  assert.equal(request.body.action,'assistant_respond'); assert.equal(request.body.summary,'memory');
  assert.ok(request.body.input.every(item=>item.role!=='system'));
  const sources=[{id:'S1',title:'Club page',source_path:'/public/member-center.html',excerpt:'Safe text <img>'},{id:'S2',title:'Unused',source_path:'/index.html'}];
  request.resolve({ok:true,headers:new Headers({'content-type':'text/event-stream','x-chat-assistant-sources':encodeURIComponent(JSON.stringify(sources)),'x-chat-assistant-release':'11111111-1111-4111-8111-111111111111'}),body:stream(`data: {"type":"response.output_text.delta","delta":"Answer [S1] [S99]"}

data: {"type":"response.completed"}

`)}); await settle();
  assert.equal(ui.evaluate('current.turns[0].sources.length'),2);
  assert.equal(ui.evaluate('rendered.nodes[0].sources.children.length'),1,'only cited valid sources rendered');
  assert.equal(ui.evaluate('rendered.nodes[0].sources.children[0].href'),'member-center.html');
  assert.equal(ui.evaluate('assistantPagePath("index.html")'),'../index.html');
  assert.equal(ui.evaluate('assistantPagePath("public/member-center.html")'),'member-center.html');
  assert.equal(ui.evaluate('assistantPagePath("../index.html")'),'');
  assert.equal(ui.writes.at(-1).turns[0].releaseId,'11111111-1111-4111-8111-111111111111');
  assert.match(ui.evaluate('rendered.nodes[0].sources.children[0].children.at(-1).textContent'),/11111111-1111-4111-8111-111111111111$/,'source shows persisted publication version');
  ui.evaluate('current.turns[0].assistantRelease="22222222-2222-4222-8222-222222222222";renderMessages()');
  assert.match(ui.evaluate('rendered.nodes[0].sources.children[0].children.at(-1).textContent'),/22222222-2222-4222-8222-222222222222$/,'version-only updates refresh source metadata');
  ui.evaluate('current.turns[0].sources=[{id:"S3",title:"Current board",source_path:"public/member-points.html",type:"live",fetched_at:"2026-10-19T08:00:00.000Z",dataset:"member_points",limit:20,truncated:true}];current.turns[0].text="Board [S3]";renderMessages()');
  assert.equal(ui.evaluate('rendered.nodes[0].sources.children[0].children.length'),5,'live source shows query timestamp and bounded scope');
  assert(!ui.evaluate('rendered.nodes[0].sources.children[0].children.map(x=>x.textContent).join(" ")').includes('22222222-2222-4222-8222-222222222222'),'live source must not imply published snapshot freshness');
  ui.evaluate('current.turns[0].sources[0]={...current.turns[0].sources[0],status:"success",query:{order_by:"points",direction:"asc",page:2,page_size:5},returned_count:5,has_more:true};renderMessages()');
  const sourceText = () => ui.evaluate('rendered.nodes[0].sources.children[0].children.map(x=>x.textContent).join(" | ")');
  assert.match(sourceText(), /Order ascending by points · Page 2 · Up to 5 rows/);
  assert.match(sourceText(), /More results are available/);
  assert.match(sourceText(), /Returned 5 rows; page order is not a global rank/);
  assert.match(sourceText(), /Queried at.*Retrieved/);
  ui.setLang('zh');
  assert.match(sourceText(), /按积分升序 · 第 2 页 · 每页最多 5 条/);
  assert.match(sourceText(), /还有更多结果可查询/);
  assert.match(sourceText(), /本次返回 5 条；页内顺序不代表全榜名次/);
  assert.match(sourceText(), /查询时间.*已读取/);
  ui.evaluate('current.turns[0].sources[0].has_more=null;renderMessages()');
  assert.doesNotMatch(sourceText(), /还有更多|没有更多/,'unknown pagination must not imply completeness');
  ui.evaluate('current.turns=Array.from({length:6},(_,i)=>({id:String(i),prompt:"question",text:"answer",input:[],output:[],status:"success"}));current.summary=undefined;compactJob=compactNow()');await settle();
  const compact=ui.requests.at(-1);assert.equal(compact.body.action,'assistant_compact');
  ui.message({type:'club-assistant',action:'suspend'});assert.equal(compact.signal.aborted,true,'suspend aborts compaction');
  compact.reject(new Error('aborted'));await settle();
  assert.equal(ui.evaluate('compacting'),false);
  assert.equal(ui.evaluate('suspended'),true);
}
assert.throws(()=>buildContext(turns,{context_window:100},10,[],95),/context/);
for (const path of ['javascript:alert(1)','https://evil.example/a.html','//evil/a.html','../a.html','public/%2e%2e/a.html','public/a.html?x=1','public/a.html\\evil']) assert.equal(core.assistantSourcePath(path),'');
assert.equal(core.assistantSources('%invalid').length,0);
const liveSource = {id:'S7',title:'Points',source_path:'/public/member-points.html',type:'live',fetched_at:'2026-10-19T08:00:00Z',dataset:'member_points',limit:20,truncated:true};
assert.equal(core.assistantSources(encodeURIComponent(JSON.stringify([liveSource])))[0].fetched_at,liveSource.fetched_at);
for (const invalid of [{fetched_at:'invalid'},{limit:101},{limit:-1},{dataset:'../admin'},{truncated:'yes'}]) assert.equal(core.assistantSources(encodeURIComponent(JSON.stringify([{...liveSource,...invalid}]))).length,0,'malformed live provenance cannot become a source card');
const semanticSource = {...liveSource,query:{order_by:'total_score',direction:'asc',page:1,page_size:1},returned_count:1,has_more:true,metric:'total_score'};
const parseSource = source => core.assistantSources(encodeURIComponent(JSON.stringify([source])));
assert.deepEqual(parseSource(semanticSource)[0].query, semanticSource.query);
assert.equal(parseSource({...semanticSource,has_more:null})[0].has_more,null);
assert.equal(parseSource({...semanticSource,has_more:false})[0].has_more,false);
for (const invalidQuery of [null,[],{}, {...semanticSource.query,extra:'no'}, {...semanticSource.query,filters:{name:'private'}},
  {...semanticSource.query,order_by:'total_score.desc'}, {...semanticSource.query,order_by:'x'.repeat(41)},
  {...semanticSource.query,direction:'ASC'}, {...semanticSource.query,page:0}, {...semanticSource.query,page:101},
  {...semanticSource.query,page:1.5}, {...semanticSource.query,page:'1'}, {...semanticSource.query,page_size:0}, {...semanticSource.query,page_size:51}]) {
  assert.equal(parseSource({...semanticSource,query:invalidQuery}).length,0,'reject malformed query provenance');
}
for (const invalid of [{returned_count:-1},{returned_count:51},{returned_count:1.5},{returned_count:'1'},{has_more:'yes'},{has_more:0}]) {
  assert.equal(parseSource({...semanticSource,...invalid}).length,0,'reject malformed count/pagination provenance');
}
for (const [page,page_size] of [[1,1],[100,50]]) assert.equal(parseSource({...semanticSource,query:{...semanticSource.query,page,page_size}}).length,1);
console.log('Assistant UI: catalog contract, isolated store, trusted frame sync, citations, localized live ordering/page/count/status, strict query validation and compaction suspend passed.');

// Shared server helpers are pure; exercise real metadata through the UI parser.
const {assistantToolPrompt,assistantToolReserve,assistantToolSource,assistantPrompt} = await import('../supabase/functions/_shared/chat-assistant.ts');
const {ASSISTANT_READ_TOOLS} = await import('../supabase/functions/_shared/chat-assistant-tools.ts');
const release = {id:'local-release',config:{system_prompt:'Old published prompt: no live access.',enabled:true},documents:Array.from({length:8},(_,i)=>({slug:`doc-${i}`,title:`Points ${i}`,category:'test',source_path:'/public/member-points.html',language:'en',content:'points '.repeat(200),keywords:['points']}))};
const toolPrompt = assistantToolPrompt(release,[{role:'user',content:[{type:'input_text',text:'points'}]}],ASSISTANT_READ_TOOLS);
const policy = toolPrompt.input[0].content[0].text;
assert(toolPrompt.sources.length>0 && toolPrompt.sources.length<=4);
assert(encodeURIComponent(JSON.stringify(toolPrompt.sources)).length<4000);
for(const tool of ASSISTANT_READ_TOOLS) assert(policy.includes(JSON.stringify(tool)),'full known tool definition is injected');
assert.match(policy,/MUST invoke.*even when previous answers/);
assert.match(policy,/highest value.*desc.*page 1.*lowest.*asc.*page 1/);
assert.match(policy,/Same-name member results are ambiguous/);
assert.match(policy,/Administrators.*same member-level access/);
assert(policy.includes(release.config.system_prompt));
const noCatalog = assistantToolPrompt(release,[],[]);
const catalogEstimate = core.estimateTokens(assistantToolPrompt(release,[],ASSISTANT_READ_TOOLS).input)-core.estimateTokens(noCatalog.input);
assert(assistantToolReserve(release)+catalogEstimate>=core.estimateTokens(toolPrompt.input));
assert.throws(()=>assistantToolPrompt(release,[],[{name:'write_points',description:'forbidden',parameters:{type:'object'}}]));
assert.throws(()=>assistantToolPrompt(release,[],[ASSISTANT_READ_TOOLS[0],ASSISTANT_READ_TOOLS[0]]));
assert.throws(()=>assistantToolPrompt(release,[],[{...ASSISTANT_READ_TOOLS[0],parameters:{type:'object',padding:'x'.repeat(32000)}}]));
const card = {dataset:'member_points',title:'社员积分'.repeat(80),source_path:'/public/member-points.html',metric:'积分'.repeat(80),status:'success',limit:50,truncated:true,
  query:{order_by:'points',direction:'desc',page:1,page_size:50,filters:{member_name:'Explicit user name'}},returned_count:50,has_more:true,id:'spoofed',
  data:Array.from({length:50},(_,i)=>({member_name:`member-${i}`,points:50-i}))};
const envelope = {status:'success',fetched_at:'2026-10-19T08:00:00.000Z',results:[card]};
const snapshot = JSON.stringify(envelope);
const citation = assistantToolSource(envelope,'S5');
assert(citation.source);
assert(encodeURIComponent(JSON.stringify(citation.source)).length<=980);
assert.equal(citation.result.id,'S5');
assert.equal(citation.result.fetched_at,envelope.fetched_at);
assert.deepEqual(citation.result.data,card.data,'complete adapter card remains model evidence');
assert.deepEqual(citation.result.query,card.query,'filters retained in model evidence');
assert(!JSON.stringify(citation.source).includes('Explicit user name'),'filter values never enter header');
assert(!Object.hasOwn(citation.source,'data'));
assert.equal(parseSource(citation.source)[0].query.page_size,50);
assert.equal(JSON.stringify(envelope),snapshot,'source helper does not mutate adapter data');
const combined = [...toolPrompt.sources,...Array.from({length:8},(_,i)=>assistantToolSource(envelope,`S${toolPrompt.sources.length+i+1}`).source)];
assert.equal(combined.length,toolPrompt.sources.length+8);
assert(encodeURIComponent(JSON.stringify(combined)).length<12000);
assert.equal(core.assistantSources(encodeURIComponent(JSON.stringify(combined))).length,combined.length);
for (const invalid of [{source_path:'//external/a.html'},{status:'unsafe'},{query:{...card.query,page:101}},{returned_count:51},{has_more:'yes'}]) {
  assert.equal(assistantToolSource({...envelope,results:[{...card,...invalid}]},'S5').source,null);
}
assert.throws(()=>assistantToolSource(envelope,'unsafe'));
assert.equal(assistantToolSource({...envelope,results:[]},'S5').source,null);
assert(assistantPrompt(release,[{role:'user',content:[{type:'input_text',text:'points'}]}]).sources.length,'legacy helper remains available');
console.log('Assistant helpers: semantic catalog/policy, static reserve/header bounds, complete tool result, compact sanitized source and legacy helper passed.');
