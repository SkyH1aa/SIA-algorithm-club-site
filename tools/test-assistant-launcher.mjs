import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const rootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source = fs.readFileSync(path.join(rootPath,'public/assistant-launcher.js'),'utf8');
function fixture({file = false, embedded = false, mobile = false} = {}) {
  const listeners = new Map(), elements = [], messages = [], navigations = [], timers = new Map();
  let id = 0;
  class Element {
    constructor(tag) {
      this.tagName = tag.toUpperCase(); this.children = []; this.attributes = {}; this.dataset = {}; this.events = new Map(); this.hidden = false; this.inert = false; this.isConnected = true;
      const classes = new Set();
      this.classList = {add:(...values) => values.forEach(value => classes.add(value)),remove:(...values) => values.forEach(value => classes.delete(value)),contains:value => classes.has(value),toggle:(value,on = !classes.has(value)) => on ? classes.add(value) : classes.delete(value)};
      if (tag === 'iframe') this.contentWindow = {postMessage:(message,origin) => messages.push({message,origin})};
      elements.push(this);
    }
    setAttribute(key,value) { this.attributes[key] = value; }
    addEventListener(type,listener) { this.events.set(type,[...(this.events.get(type) || []),listener]); }
    append(...items) { this.children.push(...items); }
    appendChild(item) { this.append(item); return item; }
    focus() { document.activeElement = this; }
    remove() { this.isConnected = false; }
    click() { for (const callback of this.events.get('click') || []) callback({}); }
  }
  const document = {readyState:'complete',createElement:tag => new Element(tag),getElementById:value => elements.find(element => element.id === value),currentScript:{src:file ? 'file:///D:/site/public/assistant-launcher.js' : 'http://localhost:4193/project/public/assistant-launcher.js'}};
  document.head = new Element('head'); document.body = new Element('body'); document.documentElement = new Element('html'); document.documentElement.lang = 'zh-CN'; document.documentElement.dataset.theme = 'dark';
  document.activeElement = document.body;
  const host = new Element('main'); document.body.append(host);
  const location = {protocol:file ? 'file:' : 'http:',origin:file ? 'null' : 'http://localhost:4193',pathname:file ? '/D:/site/public/guide.html' : '/project/public/guide.html',assign:url => navigations.push(url)};
  const window = {addEventListener:(type,listener) => listeners.set(type,[...(listeners.get(type)||[]),listener])};
  window.parent = embedded ? {} : window;
  const context = {window,document,location,URL,matchMedia:() => ({matches:mobile,addEventListener(){}}),setTimeout:callback => { const key = ++id; timers.set(key,callback); return key; },clearTimeout:key => timers.delete(key)};
  vm.runInNewContext(source,context,{filename:'assistant-launcher.js'});
  const emit = (type,data) => { for (const callback of listeners.get(type)||[]) callback(data); };
  return {document,elements,messages,navigations,window,emit,host,send:(data,origin = location.origin,sourceWindow = elements.find(element => element.tagName === 'IFRAME')?.contentWindow) => emit('message',{data:{type:'club-assistant',...data},origin,source:sourceWindow})};
}
const f = fixture();
assert.equal(f.elements.filter(element => element.tagName === 'IFRAME').length,0,'no iframe or auth work until opened');
f.window.ClubAssistant.open();
const frame = f.elements.find(element => element.tagName === 'IFRAME');
assert.equal(frame.src,'http://localhost:4193/project/public/assistant.html?embed=1');
f.send({action:'ready'});
assert.equal(f.document.getElementById('club-assistant').dataset.ready,'true');
f.send({action:'state',busy:true},'https://attacker.invalid');
assert.equal(f.document.getElementById('club-assistant').classList.contains('is-busy'),false);
f.send({action:'state',busy:true},undefined,{});
assert.equal(f.document.getElementById('club-assistant').classList.contains('is-busy'),false);
f.send({action:'state',busy:true});
assert.equal(f.document.getElementById('club-assistant').classList.contains('is-busy'),true);
for (const bad of ['https://attacker.invalid/member-center.html','javascript:alert(1)','../outside.html','//attacker.invalid/a.html','member-center.html\\evil','guide.html?secret=1','guide.html#bad%20fragment','guide.html#<script>']) f.send({action:'navigate',path:bad});
assert.equal(f.navigations.length,0,'messages cannot navigate outside public site directory');
f.window.ClubAssistant.close();
assert.equal(f.elements.filter(element => element.tagName === 'IFRAME').length,1,'minimize retains instance');
f.window.ClubAssistant.open();
assert.equal(f.elements.filter(element => element.tagName === 'IFRAME').length,1);
f.emit('pagehide',{});
assert.equal(f.messages.at(-1).message.action,'suspend');
f.send({action:'navigate',path:'member-center.html'});
assert.deepEqual(f.navigations,['http://localhost:4193/project/public/member-center.html']);
f.send({action:'navigate',path:'../index.html#join'});
assert.equal(f.navigations.at(-1),'http://localhost:4193/project/index.html#join');
const local = fixture({file:true}); local.window.ClubAssistant.open(); local.send({action:'ready'},'null');
assert.equal(local.document.getElementById('club-assistant').dataset.ready,'true');
assert.equal(local.messages.at(-1).origin,'*');
const expandedFixture = fixture();
expandedFixture.window.ClubAssistant.open();
const expandedRoot = expandedFixture.document.getElementById('club-assistant');
const expandButton = expandedFixture.elements.find(element => String(element.className || '').includes('club-assistant-expand'));
let panelStyle = {};
const panelNode = expandedFixture.elements.find(element => element.id === 'club-assistant-panel');
panelNode.style = panelStyle;
expandButton.click();
assert.equal(expandedRoot.classList.contains('is-expanded'), true, 'expand toggles a quarter-screen layout');
assert.equal(panelStyle.inset, '', 'expanded mode clears scripted coordinates so CSS can center the panel');
assert.equal(panelStyle.height, '', 'expanded mode clears scripted height');
const css = fs.readFileSync(path.join(rootPath, 'public/assistant-launcher.css'), 'utf8');
assert.match(css, /is-expanded \.club-assistant-panel \{[^}]*width: 50vw;[^}]*height: 50vh;/s, 'expanded panel uses half the viewport width and height');
assert.match(css, /is-expanded \.club-assistant-panel \{[^}]*inset: 25vh auto auto 25vw !important;/s, 'expanded panel is centered at quarter-screen size');
const modal = fixture({mobile:true}); modal.window.ClubAssistant.open(); assert.equal(modal.host.inert,true); modal.window.ClubAssistant.close(); assert.equal(modal.host.inert,false);
const nested = fixture({embedded:true}); assert.equal(nested.window.ClubAssistant,undefined,'nested frames never mount launcher');
const pages = fs.readdirSync(path.join(rootPath,'public')).filter(name => name.endsWith('.html') && name !== 'assistant.html');
for (const name of pages) {
  const html = fs.readFileSync(path.join(rootPath,'public',name),'utf8');
  assert.match(html,/(?:club-shell|assistant-launcher)\.js/,`missing assistant entry: public/${name}`);
}
assert.match(fs.readFileSync(path.join(rootPath,'index.html'),'utf8'),/public\/club-shell\.js/);
assert.match(fs.readFileSync(path.join(rootPath,'404.html'),'utf8'),/public\/club-shell\.js/,'root 404 page mounts the shared shell');
const rootGames = ['贪吃蛇.html','贪吃蛇专家系统.html','俄罗斯方块.html','俄罗斯方块AI.html'];
for (const name of rootGames) assert.match(fs.readFileSync(path.join(rootPath,name),'utf8'),/public\/assistant-launcher\.js/,`missing assistant entry: ${name}`);
console.log(`Assistant launcher: lazy mount, trusted messages, safe navigation, retained instance, pagehide, file origin, mobile focus isolation, nested exclusion and ${pages.length + 1 + rootGames.length} site pages passed.`);
