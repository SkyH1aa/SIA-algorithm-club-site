import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

// The production controller and core run unchanged apart from ESM import/export syntax.
// The network and persistent store below are local substitutes, never real services.
const controller = await readFile(new URL('../public/chat-images.js', import.meta.url), 'utf8');
const core = await readFile(new URL('../public/chat-images-core.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../public/chat-images.html', import.meta.url), 'utf8');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
assert.equal(new Set(ids).size, ids.length, 'HTML IDs must be unique');
const source = core.replace(/^export /gm, '') + '\n' + controller.replace(/^import .*;\s*$/gm, '');
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=';
const session = id => ({access_token:`token-${id}`, user:{id,email:`${id}@example.invalid`}});
const deferred = () => {let resolve, reject; const promise = new Promise((a,b)=>{resolve=a;reject=b;}); return {promise,resolve,reject};};
async function until(predicate, label) {
  for (let i=0;i<200;i++) {if (predicate()) return; await new Promise(resolve=>setTimeout(resolve, 2));}
  assert.fail(`timed out waiting for ${label}`);
}
function element(tag='div') {
  const handlers = new Map(), classes = new Set();
  const node = {tagName:tag.toUpperCase(), children:[], dataset:{}, attributes:{}, value:'', textContent:'', hidden:false, disabled:false, checked:false, open:false,
    classList:{add:(x)=>classes.add(x),remove:(x)=>classes.delete(x),contains:(x)=>classes.has(x)},
    addEventListener(type, fn){const list=handlers.get(type)||[];list.push(fn);handlers.set(type,list);},
    dispatch(type, extra={}){const e={type,target:this,preventDefault(){},...extra};for(const fn of handlers.get(type)||[])fn(e);this[`on${type}`]?.(e);},
    append(...children){this.children.push(...children);},
    replaceChildren(...children){this.children=children;if(this.tagName==='SELECT')this.value=children[0]?.value||'';},
    setAttribute(k,v){this.attributes[k]=String(v);}, removeAttribute(k){delete this.attributes[k];delete this[k];},
    replaceWith(other){this.replacement=other;}, querySelectorAll(){return [];},getClientRects(){return [1];},focus(){},click(){this.dispatch('click');},
    showModal(){this.open=true;},close(){this.open=false;},
    get options(){return this.children;}
  }; return node;
}
function descendants(node) {return [node,...node.children.flatMap(descendants)];}
function harness() {
  const nodes = new Map(ids.map(id=>[id,element(['imageModel','imageResolution','imageRatio','imageQuality'].includes(id)?'select':'div')]));
  const node = id => {assert(nodes.has(id),`missing DOM element ${id}`);return nodes.get(id);};
  node('imageQuantity').value='1'; node('imageWidth').value='1024'; node('imageHeight').value='1024';
  const calls=[], saved=new Map(), assets=new Map(), deletes=[], urlCreated=[], urlRevoked=[];
  let authListener, uuid=0, create=0;
  const state={saveHook:null,network:null,confirm:true};
  const clone = record => structuredClone(record);
  const store={
    async save(record){if(state.saveHook)await state.saveHook(record);const copy=clone(record);for(const field of ['images','references'])for(const item of copy[field]||[]){if(item.blob){assets.set(`${copy.userId}/${copy.id}/${item.assetId}`,item.blob);delete item.blob;}}saved.set(`${copy.userId}/${copy.id}`,copy);return clone(copy);},
    async list(userId){const records=[...saved.values()].filter(x=>x.userId===userId).map(clone);return {records,total:records.length,nextCursor:null};},
    async get(userId,id){const r=saved.get(`${userId}/${id}`);return r?clone(r):null;},
    async getAsset(userId,id,assetId){return assets.get(`${userId}/${id}/${assetId}`)||null;},
    async pending(userId){return [...saved.values()].filter(x=>x.userId===userId&&x.archivePending).map(clone);},
    async deleteMany(userId,ids){deletes.push({userId,ids:[...ids]});for(const id of ids)saved.delete(`${userId}/${id}`);}
  };
  const model={id:'test-model',display_name:'Test',image_config:{sizes:['auto'],qualities:['auto'],max_batch:3,supports_references:true}};
  const response = data => ({ok:true,status:200,json:async()=>data});
  async function fetchStub(url,options){
    const action=options.headers['x-drive-action']||JSON.parse(options.body).action;
    const call={url,action,headers:options.headers,body:options.body,signal:options.signal};calls.push(call);
    if(state.network){const result=await state.network(call);if(result!==undefined)return result;}
    if(action==='image_catalog')return response({models:[model],member_name:'test'});
    if(action==='image_begin')return response({allowed:true});
    if(action==='image_generate')return response({image:{b64_json:png},status:'succeeded',archive:{ok:false}});
    return response({ok:true});
  }
  const listeners = new Map();
  const window={matchMedia:()=>({matches:false,addEventListener(){}}),addEventListener(type,fn){listeners.set(type,fn);},supabase:{createClient:()=>({auth:{onAuthStateChange(fn){authListener=fn;},getSession:async()=>({data:{session:session('alice')}})}})}};
  const context=vm.createContext({window,document:{getElementById:node,createElement:element,querySelectorAll:()=>[],addEventListener(){},body:element('body'),hidden:false},
    Option:function(text,value){return {text,value};},imageStore:store,ClubI18n:{t:(key,vars)=>`${key}${vars?JSON.stringify(vars):''}`,getLang:()=> 'en'},ClubCommon:{confirm:async()=>state.confirm},ClubTheme:{},
    fetch:fetchStub,crypto:{subtle:webcrypto.subtle,randomUUID:()=>`id-${++uuid}`},Blob,AbortController,TypeError,Date,Intl,Uint8Array,DataView,Map,Set,Promise,Number,String,Math,Error,Array,Object,JSON,
    atob, FileReader:class {readAsDataURL(blob){blob.arrayBuffer().then(bytes=>{this.result=`data:${blob.type};base64,${Buffer.from(bytes).toString('base64')}`;this.onload();},()=>this.onerror());}},
    setTimeout,clearTimeout,URL:{createObjectURL(blob){const url=`blob:local-${++create}`;urlCreated.push({url,blob});return url;},revokeObjectURL(url){urlRevoked.push(url);}},console,navigator:{}});
  vm.runInContext(source,context,{filename:'chat-images-controller-vm.js'});
  const run = text=>vm.runInContext(text,context);
  return {node,calls,saved,assets,deletes,urlCreated,urlRevoked,state,run,response,auth:next=>authListener('SIGNED_IN',next),listeners};
}
async function ready(h){await until(()=>!h.node('imageWorkspace').hidden&&h.calls.some(c=>c.action==='image_catalog'),'catalog');await until(()=>h.run('!loading && !retrying'),'initial history');h.node('imagePrompt').value='a test image';}
function generate(h){return h.run('startGeneration({preventDefault(){}})');}
const actions=(h,name)=>h.calls.filter(c=>c.action===name);

 test('double submit reserves one batch',async()=>{
  const h=harness();await ready(h);const gate=deferred();h.state.network=call=>call.action==='image_begin'?gate.promise:undefined;
  h.node('imageForm').dispatch('submit');h.node('imageForm').dispatch('submit');await until(()=>actions(h,'image_begin').length===1,'first begin');
  assert.equal(actions(h,'image_begin').length,1);gate.resolve(h.response({allowed:true}));await until(()=>h.run('run===null'),'batch completion');
  assert.equal(actions(h,'image_generate').length,1);
});

test('account change ignores old generation response and keeps account data separate',async()=>{
  const h=harness();await ready(h);const gate=deferred();h.state.network=call=>call.action==='image_generate'?gate.promise:undefined;
  const old=generate(h);await until(()=>actions(h,'image_generate').length===1,'old request');h.auth(session('bob'));await until(()=>h.run('session?.user.id')==='bob'&&actions(h,'image_catalog').length===2,'new account');
  gate.resolve(h.response({image:{b64_json:png},status:'succeeded'}));await old;
  assert.equal(h.run('session.user.id'),'bob');assert.equal(h.run('currentRecord'),null);assert.equal(h.node('resultGrid').children.length,0);
  assert.equal([...h.saved.values()].filter(r=>r.userId==='bob').length,0);
  assert.equal(actions(h,'image_cancel').every(c=>c.headers.authorization==='Bearer token-alice'),true);
});

test('uncertain response with an image is persisted and downloadable without another slot',async()=>{
  const h=harness();await ready(h);h.node('imageQuantity').value='2';h.state.network=call=>call.action==='image_generate'?h.response({status:'uncertain',image:{b64_json:png},archive:{ok:false}}):undefined;
  await generate(h);await until(()=>descendants(h.node('resultGrid')).some(n=>n.tagName==='A'),'download link');
  const r=h.saved.get('alice/id-1');assert.equal(r.status,'uncertain');assert.deepEqual(r.slots.map(s=>s.status),['uncertain','cancelled']);assert.equal(r.images.length,1);assert(h.assets.get('alice/id-1/image-0') instanceof Blob);
  assert.equal(actions(h,'image_generate').length,1);const link=descendants(h.node('resultGrid')).find(n=>n.tagName==='A');assert.match(link.href,/^blob:/);assert.match(link.download,/image-id-1-1\.png$/);
});

test('unknown failure without image is not retried',async()=>{
  const h=harness();await ready(h);h.node('imageQuantity').value='2';h.state.network=call=>{if(call.action==='image_generate')throw new TypeError('offline');};
  await generate(h);const r=h.saved.get('alice/id-1');assert.equal(r.status,'uncertain');assert.deepEqual(r.slots.map(s=>s.status),['uncertain','cancelled']);assert.equal(r.images.length,0);assert.equal(actions(h,'image_generate').length,1);
});

test('stop while initial storage is pending does not begin generation',async()=>{
  const h=harness();await ready(h);const gate=deferred();let blocked=false;h.state.saveHook=async()=>{if(!blocked){blocked=true;await gate.promise;}};
  const task=generate(h);await until(()=>blocked,'initial save');h.node('stopImage').click();gate.resolve();await task;
  assert.equal(actions(h,'image_begin').length,0);assert.equal(actions(h,'image_generate').length,0);assert.equal(h.saved.get('alice/id-1').status,'cancelled');
});

test('archive rejects truthy non-boolean acknowledgements for attachment and snapshot',async()=>{
  for(const badAction of ['image-attachment','image-archive']){
    const h=harness();await ready(h);h.state.network=call=>call.action===badAction?h.response({ok:'true'}):undefined;
    await generate(h);const r=h.saved.get('alice/id-1');assert.equal(r.archivePending,true,`${badAction} must remain pending`);
    if(badAction==='image-attachment')assert.equal(r.images[0].archived,false);
    else assert.equal(r.images[0].archived,false,'snapshot failure must not commit attachment metadata');
  }
});

test('generation response cannot mark references archived with non-boolean ok',async()=>{
  const h=harness();await ready(h);
  // A validated reference is supplied as if selected in the form, with real core decoding/hash.
  await h.run(`(async()=>{const img=await generatedImage({b64_json:${JSON.stringify(png)}});refs=[{...img,name:'reference.png'}];})()`);
  h.state.network=call=>call.action==='image_generate'?h.response({status:'succeeded',image:{b64_json:png},archive:{ok:'true'}}):call.action==='image-attachment'?h.response({ok:false}):undefined;
  await generate(h);const r=h.saved.get('alice/id-1');assert.equal(r.references[0].archived,false,`non-boolean generation archive acknowledgement must not mark reference archived; actions=${h.calls.map(c=>c.action).join(',')}`);
});

test('record reuse validates options before changing the current form',async()=>{
  const h=harness();await ready(h);
  const saved={id:'saved-1',userId:'alice',prompt:'Reusable prompt',modelId:'test-model',modelName:'Test',options:{size:'auto',quality:'auto',background:'auto'},count:1,createdAt:1,finishedAt:2,references:[],images:[],slots:[{slot:0,status:'succeeded'}],status:'completed',archivePending:false};
  h.saved.set('alice/saved-1',saved);
  await h.run('showSelectedRecord("saved-1")');
  assert.equal(h.run('currentRecord?.id'),'saved-1');assert.equal(h.node('imagePrompt').value,'Reusable prompt');assert.equal(h.node('imageResolution').value,'auto');
  h.run('resetForNew()');h.node('imagePrompt').value='Keep this form';
  h.saved.set('alice/saved-invalid',{...saved,id:'saved-invalid',prompt:'Must not partially load',options:{size:'99999x99999',quality:'auto',background:'auto'}});
  await h.run('showSelectedRecord("saved-invalid")');
  assert.equal(h.run('currentRecord'),null);assert.equal(h.node('imagePrompt').value,'Keep this form');assert.match(h.node('imageStatus').textContent,/statusSize/);
});

test('delete only after every selected record has a complete archive',async()=>{
  const h=harness();await ready(h);await generate(h);h.node('imagePrompt').value='second';await generate(h);
  h.node('selectRecords').click();h.node('selectAll').click();let archiveCount=0;
  h.state.network=call=>{if(call.action==='image-archive'&&++archiveCount===2)return h.response({ok:false});};
  h.node('deleteRecords').click();await until(()=>h.node('imageStatus').textContent.includes('statusDeleteArchive'),'failed delete');
  assert.equal(archiveCount,2);assert.equal(h.deletes.length,0);assert.equal(h.saved.size,2);assert.match(h.node('imageStatus').textContent,/statusDeleteArchive/);
  h.state.network=null;h.node('deleteRecords').click();await until(()=>h.deletes.length===1,'successful delete');
  assert.equal(h.deletes[0].userId,'alice');assert.equal(h.deletes[0].ids.length,2);await until(()=>!h.run('deleting'),'delete completion');assert.equal(h.saved.size,0);
});

test('storage failure after image arrival preserves memory and download',async()=>{
  const h=harness();await ready(h);h.state.saveHook=record=>{if(record.images.length)throw Error('disk full');};
  await generate(h);await until(()=>descendants(h.node('resultGrid')).some(n=>n.tagName==='A'),'in-memory download');
  assert.equal(h.run('currentRecord.localError'),true);assert.equal(h.run('currentRecord.images.length'),1);assert(h.run('currentRecord.images[0].blob') instanceof Blob);assert.match(h.node('imageStatus').textContent,/statusStorage/);
});

test('object URLs have independent result, history, reference and preview lifetimes',async()=>{
  const h=harness();await ready(h);await generate(h);await until(()=>descendants(h.node('resultGrid')).some(n=>n.tagName==='A'),'result link');
  await until(()=>h.run('objectUrls.history.size')>0,'history URL');
  const results=h.run('[...objectUrls.results]')[0], history=h.run('[...objectUrls.history]')[0];assert.notEqual(results,history);
  const preview=descendants(h.node('resultGrid')).find(n=>n.className==='image-card-preview');preview.click();const previewUrl=h.node('previewDownload').href;
  assert.notEqual(previewUrl,results);h.node('previewClose').click();assert(h.urlRevoked.includes(previewUrl));assert(!h.urlRevoked.includes(results));assert(!h.urlRevoked.includes(history));
  assert.equal(h.node('imagePreview').open,false);assert.equal(h.node('previewImage').attributes.hidden,'');assert.equal(h.node('previewImage').src,undefined);assert.equal(h.node('previewDownload').href,undefined);
  preview.click();const escapeUrl=h.node('previewDownload').href;let prevented=false;h.node('imagePreview').dispatch('cancel',{preventDefault(){prevented=true;}});
  assert(prevented);assert.equal(h.node('imagePreview').open,false);assert.equal(h.node('previewImage').attributes.hidden,'');assert.equal(h.node('previewImage').src,undefined);assert.equal(h.node('previewDownload').href,undefined);assert(h.urlRevoked.includes(escapeUrl));
  assert(!h.urlRevoked.includes(results));assert(!h.urlRevoked.includes(history));
  await h.run(`(async()=>{refs=[{...await generatedImage({b64_json:${JSON.stringify(png)}}),name:'reference.png'}];refreshReferences();})()`);
  const reference=h.run('[...objectUrls.references]')[0];assert(reference);assert.notEqual(reference,results);
  h.run('refreshReferences()');assert(h.urlRevoked.includes(reference));assert(!h.urlRevoked.includes(results));assert(!h.urlRevoked.includes(history));
  h.run('renderCurrentRecord()');assert(h.urlRevoked.includes(results));assert(!h.urlRevoked.includes(history));
  h.listeners.get('pagehide')();for(const {url} of h.urlCreated)assert(h.urlRevoked.includes(url),`pagehide must revoke ${url}`);
});
