import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const source=read('public/home-capabilities.js');
const pure={module:{exports:{}},console};vm.runInNewContext(source,pure);const api=pure.module.exports;
const plain=value=>JSON.parse(JSON.stringify(value));
const d=api.shortestPath();
assert.deepEqual(plain(d.at(-1).dist),[0,3,1,4,7]);
assert.equal(d.at(-1).vars.route,'A → C → B → D → E');
// Independent Floyd-Warshall truth, including every reachable vertex.
const truth=Array.from({length:5},(_,a)=>Array.from({length:5},(_,b)=>a===b?0:Infinity));
api.edges.forEach(([a,b,w])=>truth[a][b]=truth[b][a]=w);
for(let k=0;k<5;k++)for(let a=0;a<5;a++)for(let b=0;b<5;b++)truth[a][b]=Math.min(truth[a][b],truth[a][k]+truth[k][b]);
assert.deepEqual([...d.at(-1).dist],truth[0]);
d.forEach(f=>f.settled.forEach(i=>assert.equal(f.dist[i],truth[0][i])));
const mini=api.minimax().at(-1);
assert.equal(mini.alpha,Math.max(Math.min(3,5),Math.min(2,9),Math.min(4,6)));
assert.deepEqual(plain(mini.pruned),[3]);assert.equal(mini.visited.length,5);assert.equal(mini.values[1],2);
const breadth=api.bfs();assert.deepEqual(plain(breadth.at(-1).order),[0,1,2,3,4]);assert.deepEqual(plain(breadth.at(-1).distance),[0,1,1,2,2]);
breadth.forEach(f=>assert.equal(new Set(f.queue).size,f.queue.length));
api.correspondence().forEach(f=>{f.matrix.forEach((row,a)=>row.forEach((n,b)=>{assert.equal(n,f.matrix[b][a]);if(a===b)assert.equal(n,0);}));assert.equal(f.matrix.flat().reduce((a,b)=>a+b,0),f.links.length*2);});
assert.deepEqual(Object.keys(api.dictionaries.zh).sort(),Object.keys(api.dictionaries.en).sort());
for(const fn of ['shortestPath','minimax','bfs','correspondence','engineering'])for(const f of api[fn]())for(const lang of ['zh','en']){
  const template=api.dictionaries[lang][f.key];assert.ok(template,f.key);for(const [,key] of template.matchAll(/\{(\w+)\}/g))assert.ok(key in f.vars,`${lang} ${f.key} ${key}`);
}
function scheduler(){let id=0;const pending=new Map();return {pending,setTimeout(fn){pending.set(++id,fn);return id;},clearTimeout(key){pending.delete(key);},tick(){const [key,fn]=pending.entries().next().value||[];if(fn){pending.delete(key);fn();}}};}
const clock=scheduler();let rendered;
const p=api.createPlayer(3,s=>rendered=s,clock);p.toggle();assert.equal(clock.pending.size,1);clock.tick();assert.equal(rendered.step,1);p.pause();assert.equal(clock.pending.size,0);p.next();assert.equal(rendered.done,true);p.toggle();assert.equal(rendered.step,0);clock.tick();clock.tick();assert.equal(rendered.done,true);assert.equal(rendered.playing,false);assert.equal(clock.pending.size,0);p.reset();p.toggle();p.dispose();assert.equal(clock.pending.size,0);p.next();assert.equal(p.state.step,0);
// Minimal DOM adapter exercises real renderer and all interruption paths without a browser.
class El {
  constructor(dataset={}){this.dataset=dataset;this.attributes={};this.handlers={};this.style={};this.textContent='';this.innerHTML='';this.classList={toggle(){}};}
  setAttribute(k,v){this.attributes[k]=v;} addEventListener(k,fn){(this.handlers[k]??=[]).push(fn);} fire(k,e={}){for(const fn of this.handlers[k]||[])fn(e);} focus(){this.focused=true;}
  querySelector(q){return this.children?.[q]||null;}
}
const names=['ai','systems','ai-lab','math','resources'];
const tabs=names.map(axis=>{const el=new El({axis});el.id=`cap-tab-${axis}`;el.children={strong:new El(),small:new El()};return el;});
const selectors=['.cap-controls','[role="tabpanel"]','[data-cap-figure]','[data-cap-explanation]','[data-cap-title]','[data-cap-next]','[data-cap-play]','[data-cap-reset]','[data-cap-step]','[data-matrix-title]','[data-matrix-copy]','[data-matrix-link]','[data-cap-demo]','[data-matrix-code]','[data-cap-text]','[data-cap-transcript]'];
const host=new El();host.children=Object.fromEntries(selectors.map(s=>[s,new El()]));host.querySelectorAll=()=>tabs;
const doc=new El();doc.hidden=false;doc.querySelector=()=>host;
const win=new El();const c=scheduler();Object.assign(win,{document:doc,setTimeout:c.setTimeout,clearTimeout:c.clearTimeout,matchMedia:()=>media});
const media=new El();let locale='zh', observer, merges=0;
win.IntersectionObserver=class {constructor(fn){observer=fn;}observe(){}};
win.ClubI18n={getLang:()=>locale,mergeDict(){merges++;},t:key=>key};
vm.runInNewContext(source,{window:win,console});
const get=s=>host.children[`[data-${s}]`];
assert.ok(get('cap-figure').innerHTML.includes('<svg'));assert.ok(merges>0);c.tick();
for(const [i,axis]of names.entries()){
 tabs[i].fire('click');assert.equal(host.dataset.activeAxis,axis);assert.equal(tabs[i].attributes['aria-selected'],'true');assert.equal(host.children['[role="tabpanel"]'].attributes['aria-labelledby'],tabs[i].id);
 assert.ok(!get('cap-explanation').textContent.includes('homeCapabilities.'));
 get('cap-play').fire('click');assert.equal(c.pending.size,1);doc.hidden=true;doc.fire('visibilitychange');assert.equal(c.pending.size,0);doc.hidden=false;
 get('cap-next').fire('click');locale='en';win.fire('club:langchange');assert.equal(get('cap-next').textContent,'Next');assert.ok(!get('cap-transcript').innerHTML.includes('undefined'));locale='zh';
 get('cap-play').fire('click');win.fire('pagehide');assert.equal(c.pending.size,0);
 get('cap-play').fire('click');win.fire('club:sceneprogress',{detail:{section:'home'}});assert.equal(c.pending.size,0);
 get('cap-play').fire('click');observer([{isIntersecting:false}]);assert.equal(c.pending.size,0);observer([{isIntersecting:true}]);
 get('cap-play').fire('click');media.fire('change');assert.equal(c.pending.size,0);
}
tabs[0].fire('keydown',{key:'End',preventDefault(){}});assert.ok(tabs.at(-1).focused);
// Paused GSAP timelines follow the existing clock, with no outer-stage ownership.
const motion=read('public/home-motion.js');
let subscriber=null, subscriptions=0, reverts=0, sleeps=0, tweens=0;
const motionDoc=new El();motionDoc.hidden=false;motionDoc.body={classList:{contains:()=>false}};
motionDoc.getElementById=()=>({querySelectorAll:()=>[new El(),new El()]});
const motionWin=new El(), motionMedia=new El();motionMedia.matches=false;
const timelineStates=[];
const gsap={ticker:{sleep(){sleeps++;}},context(fn){fn();return {revert(){reverts++;}};},timeline(options){assert.equal(options.paused,true);const state={progress:0};timelineStates.push(state);return {fromTo(target,from,to){assert.equal(from.y,12);assert.equal(to.y,0);tweens++;return this;},progress(value){state.progress=value;}};}};
const bus={state:{smoothProgress:2},subscribe(fn){subscriber=fn;subscriptions++;return ()=>{subscriber=null;subscriptions--;};}};
motionWin.gsap=gsap;motionWin.ScrollBus=bus;
vm.runInNewContext(motion,{window:motionWin,document:motionDoc,matchMedia:()=>motionMedia,addEventListener:(...a)=>motionWin.addEventListener(...a)});
assert.equal(subscriptions,1);assert.equal(tweens,4);assert.equal(timelineStates[1].progress,1);subscriber({smoothProgress:1.5});assert.equal(timelineStates[0].progress,.5);assert.equal(timelineStates[1].progress,.5);
motionDoc.hidden=true;motionDoc.fire('visibilitychange');assert.equal(subscriptions,0);assert.equal(reverts,1);
motionDoc.hidden=false;motionDoc.fire('visibilitychange');assert.equal(subscriptions,1);
motionWin.fire('pagehide');assert.equal(subscriptions,0);motionWin.fire('pageshow');assert.equal(subscriptions,1);
motionMedia.matches=true;motionMedia.fire('change');assert.equal(subscriptions,0);assert.ok(sleeps>0);
assert.ok(!/requestAnimationFrame|ScrollTrigger|addEventListener\(['"]scroll/.test(motion));
// Original fingerprints are captured from the pre-premium baseline, not current output.
// Run these guards in CI even when the optional local baseline directory is absent.
const hash=value=>createHash('sha256').update(value).digest('hex');
const normalize=value=>value.replace(/\r/g,'');
// Contract hashes omit asset query versions, matching test-premium-page-contracts.
// Separate raw-byte guards below still protect the unchanged scene code.
const contractHash=value=>hash(value.replace(/([?&])v=[^&"'\s<>)]*(&?)/g,(_,prefix,suffix)=>suffix?prefix:''));
const index=normalize(read('index.html'));
const scripts=s=>[...s.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(m=>!/\bsrc\s*=/i.test(m[1]));
const originalHashes=[
 'e9bcf42ddf5624d9bb6770c57929be958b9f6ed1429f2ae787c446ad67a0d52c',
 'ef8fc059da982533129d9ac3e1873d2bb2701b836d4036f598a0c604b6a0973a'
];
const activityAfter='7c32748ea658e6860d92393a871f905a3445c1d9e37206e78dc58d0243cc4496';
const contract=JSON.parse(read('docs/premium-upgrade-2026-11/source-contracts.json')).pages.find(page=>page.path==='index.html');
assert.ok(contract,'homepage source contract required');
assert.equal(contract.intentionalInlineChanges?.length,1,'only the recorded activity exception is permitted');
const exception=contract.intentionalInlineChanges[0];
assert.equal(exception.beforeSha256,originalHashes[1],'activity exception must match original baseline hash');
assert.equal(exception.afterSha256,activityAfter,'activity exception must match reviewed replacement hash');
assert.ok(exception.beforeEvidence?.length && exception.afterEvidence?.length,'activity exception requires before/after evidence');
assert.deepEqual(contract.inlineScripts,[originalHashes[0],activityAfter],'contract must protect every script in order');
const currentScripts=scripts(index);
assert.deepEqual(currentScripts.map(m=>m[1]),[' type="importmap"',''],'inline script count/order/attributes protection');
assert.deepEqual(currentScripts.map(m=>contractHash(m[2])),contract.inlineScripts,'only the exact documented activity replacement is permitted');
assert.deepEqual(currentScripts.map(m=>hash(m[2])),[
 originalHashes[0],'e1835be33762d1c0e03aff09b2b1ba461f62d7b0257f1dbe296e0b193210ddbf'
],'reviewed script bytes must match, including asset references');
// The changed script also contains scene/boot/chapter code. Keep its original bytes
// outside the activity renderer/build region independently pinned, never skip it.
const outsideActivities=s=>s
 .replace(/      function getActivityExcerpt[\s\S]*?(?=      function renderActivities)/,'')
 .replace(/      function renderActivities[\s\S]*?(?=      function closeFeedModal)/,'');
assert.equal(hash(outsideActivities(currentScripts[1][2])),'cb94b6e5ff4347b5a02473a207ad7d28006b9257336cc068148b06f83c03b3db','original scene/boot/chapter and non-activity code must remain byte-identical');
const hero=s=>{
 const start=s.indexOf('<section id="home"'),end=s.indexOf('<section id="capabilities"');
 assert.ok(start>=0 && end>start,'hero protection boundaries required');
 return s.slice(start,end);
};
assert.equal(hash(hero(index)),'f1802cadc29762b724a1b2a7a171e3829acd09879d52eac518af36f1ba7cdea7','hero markup/copy/CTA order must be byte-identical');
const ids=s=>[...s.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
for(const id of contract.ids)assert.ok(ids(index).includes(id),`missing ID ${id}`);
const sceneCss=s=>{
 const end=s.indexOf('/* Homepage content composition.');
 assert.ok(end>0,'scene CSS protection boundary required');
 return s.slice(0,end);
};
const cssNow=normalize(read('public/home-showcase.css'));
assert.equal(hash(sceneCss(cssNow)),'d3a80df9cf9fb009d0a625e59d5edcd55b19410bb84df561a5ca2efc83326cd1','scene and compositor CSS protection');
const baseline=process.env.SIA_HOME_BASELINE||'C:/Users/ASUS/AppData/Local/Temp/sia-premium-2026-11-baseline';
if(fs.existsSync(path.join(baseline,'index.html'))){
 const before=normalize(fs.readFileSync(path.join(baseline,'index.html'),'utf8'));
 const baselineScripts=scripts(before);
 assert.deepEqual(baselineScripts.map(m=>contractHash(m[2])),originalHashes,'baseline scripts must retain original fingerprints');
 assert.deepEqual(baselineScripts.map(m=>hash(m[2])),[
  originalHashes[0],'d303df7514114a5f73ae7686af95e0d2cdf3eeaad582c29718e490bdb5a3c25a'
 ],'original baseline bytes must not be reset');
 const expectedScripts=baselineScripts.map(m=>{
  if(contractHash(m[2])!==exception.beforeSha256)return m[0];
  assert.equal(currentScripts[1][1],m[1],'activity script attributes must remain unchanged');
  assert.equal(outsideActivities(currentScripts[1][2]),outsideActivities(m[2]),'activity exception cannot change scene/boot/chapter bytes');
  return `<script${m[1]}>${currentScripts[1][2]}</script>`;
 });
 assert.deepEqual(currentScripts.map(m=>m[0]),expectedScripts,'all baseline scripts must match except the exact documented activity replacement');
 assert.equal(hero(index),hero(before),'hero markup/copy/CTA order must be byte-identical');
 for(const id of ids(before))assert.ok(ids(index).includes(id),`missing ID ${id}`);
 const cssBefore=normalize(fs.readFileSync(path.join(baseline,'public/home-showcase.css'),'utf8'));
 assert.equal(sceneCss(cssNow),sceneCss(cssBefore),'scene and compositor CSS protection');
}
console.log('Protected inline scripts SHA-256:',hash(currentScripts.map(m=>m[0]).join('\n')));
assert.ok(!/new Worker|fetch\(|WebGL|requestAnimationFrame\(/.test(source));
console.log('PASS: shortest paths, alpha-beta bounds, BFS, symmetric matrix, bilingual renderer, keyboard controls, finite player, visibility/pagehide/chapter/offscreen interruption, IDs, hero and rendering protection.');
