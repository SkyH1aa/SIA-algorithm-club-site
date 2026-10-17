import {MAX_FILE_BYTES, MAX_REQUEST_BYTES, MAX_ATTACHMENTS, buildContext, readResponses, continuation} from './chat-core.js';
import {chatStore} from './chat-store.js';

const URL = 'https://jgezpvmlnhycxslqbwcx.supabase.co';
const KEY = 'sb_publishable_B29ClgwZagW32Ow5x6VdKQ_IL65F7dl';
const client = window.supabase.createClient(URL, KEY);
const $ = id => document.getElementById(id);
const t = (key, vars) => ClubI18n.t(`chat.${key}`, vars);
let session = null, epoch = 0, models = [], chats = [], current = null, pending = [], active = null;
let statusKey = 'loading', statusVars = {}, gateKey = 'loading', attaching = false, catalogController = null;
const generations = new Set();
const renderer = new marked.Renderer();
renderer.html = ({text}) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
renderer.image = ({text}) => `[${text || t('image')}]`;
function markdown(text) {
  const fragment = DOMPurify.sanitize(marked.parse(text || '', {renderer}), {
    RETURN_DOM_FRAGMENT:true, FORBID_TAGS:['img','style','iframe','form','input','button','svg','math'],
    FORBID_ATTR:['style','id','name'], ALLOW_DATA_ATTR:false
  });
  for (const link of fragment.querySelectorAll('a')) {
    try {
      const url = new globalThis.URL(link.getAttribute('href'));
      if (!['https:','http:','mailto:'].includes(url.protocol)) throw new Error();
      link.rel = 'noopener noreferrer'; link.target = '_blank';
    } catch { link.removeAttribute('href'); }
  }
  return fragment;
}
const model = () => models.find(x => x.id === $('model').value);
function status(key, vars = {}) { statusKey = key; statusVars = vars; $('status').textContent = t(key, vars); }
function quotaReset(quota) {
  const buckets = [{...quota?.global, limit:quota?.global?.daily_limit}, ...(quota?.periods || [])];
  const dates = buckets.filter(row => row && row.limit != null && row.remaining === 0 && row.resets_at).map(row => row.resets_at);
  return dates.sort().at(-1) || '';
}
function button(key, handler) {
  const node = document.createElement('button'); node.type = 'button'; node.textContent = t(key);
  node.onclick = handler; return node;
}
function controls() {
  const busy = !!active || attaching;
  for (const id of ['send','retry','new','rename','delete','clear','export','files','model','effort']) $(id).disabled = busy || !session || !models.length;
  $('stop').disabled = !active;
}
function renderMessages() {
  const box = $('messages');
  const follow = box.scrollHeight - box.scrollTop - box.clientHeight < 48;
  box.replaceChildren();
  if (!current?.turns.length) { box.textContent = t('empty'); return; }
  for (const turn of current.turns) {
    for (const role of ['user','assistant']) {
      const article = document.createElement('article'); article.className = `chat-message ${role}`;
      const head = document.createElement('header'), label = document.createElement('strong');
      label.textContent = role === 'user' ? t('user') : `${t('assistant')} · ${turn.modelName || ''} · ${t(turn.status === 'running' ? 'sending' : turn.status)}`;
      const text = role === 'user' ? turn.prompt : turn.text;
      head.append(label,button('copy', () => navigator.clipboard.writeText(text || '').then(() => status('copied')).catch(() => status('error'))));
      article.append(head);
      const body = document.createElement('div');
      if (role === 'user') { body.className = 'plain'; body.textContent = text; }
      else body.append(markdown(text));
      article.append(body);
      if (role === 'user') for (const file of turn.attachments || []) {
        const note = document.createElement('p'); note.textContent = `${t('attachment')}: ${file.name}`; article.append(note);
        if (file.kind === 'image') { const img = document.createElement('img'); img.src = file.data; img.alt = file.name; article.append(img); }
      }
      for (const pre of body.querySelectorAll('pre')) pre.before(button('copy', () => navigator.clipboard.writeText(pre.textContent).then(() => status('copied')).catch(() => status('error'))));
      box.append(article);
    }
  }
  if (follow) box.scrollTop = box.scrollHeight;
}
function renderList() {
  $('conversations').replaceChildren();
  for (const chat of chats) {
    const node = button('new', () => { if (!active && !attaching) { current = chat; pending = []; $('prompt').value = ''; render(); } });
    node.textContent = chat.title || t('new'); node.setAttribute('aria-current', String(chat.id === current?.id));
    $('conversations').append(node);
  }
}
function renderAttachments() {
  $('attachments').replaceChildren();
  for (const file of pending) {
    const row = document.createElement('div'); row.className = 'chat-attachment';
    const name = document.createElement('span'); name.textContent = `${file.name} (${Math.ceil(file.size / 1024)} KiB)`;
    row.append(name,button('remove', () => { if (!active) { pending = pending.filter(x => x !== file); renderAttachments(); } }));
    if (file.kind === 'image') { const img = document.createElement('img'); img.className = 'chat-preview'; img.src = file.data; img.alt = file.name; row.prepend(img); }
    $('attachments').append(row);
  }
}
function render() {
  renderList(); renderMessages(); renderAttachments(); controls();
  const selected = model(), introduction = $('modelIntroduction'), introductionText = $('modelIntroductionText');
  if (introduction && introductionText) {
    introductionText.textContent = selected?.introduction || '';
    introduction.hidden = !selected?.introduction;
  }
  const defaultOption = [...$('effort').options].find(option => option.value === '');
  if (defaultOption) defaultOption.textContent = t('default');
  $('status').textContent = t(statusKey, statusVars); $('gate').textContent = gateKey ? t(gateKey) : '';
}
async function persist(chat, guard) {
  chat.updatedAt = Date.now();
  try { await chatStore.save(chat); }
  catch { if (guard === epoch) status('storage'); throw new Error('storage'); }
}
function newChat() {
  if (!session || active || attaching) return;
  current = {userId:session.user.id,id:crypto.randomUUID(),title:'',updatedAt:Date.now(),turns:[]};
  chats.unshift(current); pending = []; $('prompt').value = ''; render();
}
function configureModel() {
  const item = model(); $('effort').replaceChildren();
  for (const value of item?.reasoning_efforts || []) { const opt = new Option(value,value); $('effort').add(opt); }
  if (!$('effort').options.length) $('effort').add(new Option(t('default'),''));
  $('effort').value = item?.default_reasoning_effort || '';
  render();
}
async function request(action, body = {}, signal, token = session?.access_token) {
  if (!token) throw new Error('login');
  const response = await fetch(`${URL}/functions/v1/chat`, {method:'POST',headers:{'Content-Type':'application/json',apikey:KEY,Authorization:`Bearer ${token}`},body:JSON.stringify({action,...body}),signal});
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw Object.assign(new Error(response.status === 409 ? 'busy' : response.status === 401 ? 'login' : ['context','request_too_large','file','login','profile','quota','blacklisted'].includes(data.error) ? data.error : 'request'), {status:response.status, quota:data.quota});
  }
  return response;
}
function fileData(file) { return new Promise((resolve,reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(new Error('file')); r.readAsDataURL(file); }); }
async function prepareFile(file, item) {
  if (!file.size || file.size > MAX_FILE_BYTES) throw new Error('file');
  const base = {name:file.name,size:file.size,type:file.type,blob:file};
  const ext = file.name.split('.').pop().toLowerCase();
  if (['png','jpg','jpeg','webp'].includes(ext)) {
    const bytes = new Uint8Array(await file.slice(0,12).arrayBuffer());
    const valid = ext === 'png' ? [137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v) : ['jpg','jpeg'].includes(ext) ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 : String.fromCharCode(...bytes.slice(0,4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8,12)) === 'WEBP';
    if (!valid || !item.supports_images) throw new Error('file');
    const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    const data = await fileData(new Blob([file],{type:mime}));
    return {...base,kind:'image',data};
  }
  if (ext === 'pdf') {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (new TextDecoder().decode(bytes.slice(0,5)) !== '%PDF-') throw new Error('file');
    const pdfjs = await import('./vendor/chat/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = new globalThis.URL('./vendor/chat/pdf.worker.mjs',import.meta.url).href;
    const task = pdfjs.getDocument({data:bytes,isEvalSupported:false,useSystemFonts:true});
    let pdf, text = '', pages = 0;
    try {
      pdf = await task.promise;
      if (pdf.numPages > 300) throw new Error('file');
      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n), content = await page.getTextContent();
        const line = content.items.map(x => x.str || '').join(' ');
        if (line.trim().length >= 30) pages++;
        text += `\n[${n}] ${line}\n`;
        if (text.length > 1000000) throw new Error('file');
        page.cleanup();
      }
      if (pages >= Math.ceil(pdf.numPages * .8) && text.trim().length >= 30) return {...base,kind:'text',text};
    } finally { await task.destroy(); }
    if (!item.supports_pdf) throw new Error('pdf');
    status('native'); return {...base,kind:'pdf',data:await fileData(new Blob([file],{type:'application/pdf'}))};
  }
  if (!['txt','md','csv','js','ts','jsx','tsx','py','json','html','css','c','cpp','h','java','rs','go','sql','yaml','yml','xml','sh','log'].includes(ext)) throw new Error('file');
  const text = new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());
  if (text.includes('\0')) throw new Error('file');
  return {...base,kind:'text',text};
}
function inputFor(prompt, files, item) {
  const content = [{type:'input_text',text:prompt || ' '}];
  for (const file of files) {
    if (file.kind === 'text') content.push({type:'input_text',text:`\n--- Attachment: ${file.name} ---\n${file.text}\n--- End attachment ---`});
    else if (file.kind === 'image' && item.supports_images) content.push({type:'input_image',image_url:file.data,detail:'auto'});
    else if (file.kind === 'pdf' && item.supports_pdf) content.push({type:'input_file',filename:file.name,file_data:file.data});
    else throw new Error('file');
  }
  return [{role:'user',content}];
}
async function generate(retry = false) {
  if (active || attaching || !session || !model()) return;
  const guard = epoch, chat = current, item = model();
  if (!chat) return;
  const output = item.default_max_output_tokens;
  const previous = retry ? chat.turns.at(-1) : null;
  if (retry && !previous) return;
  const prompt = previous?.prompt ?? $('prompt').value.trim(), files = previous?.attachments ?? pending.slice();
  if (!prompt && !files.length) return;
  const controller = new AbortController();
  let finish;
  const run = {controller,stopped:false,userId:chat.userId,done:new Promise(resolve => { finish = resolve; })};
  generations.add(run); active = run; controls();
  let turn, persisted = false, saveAt = 0, saveQueue = Promise.resolve(), storageError = false, failureKey = '', failureVars = {};
  try {
    turn = {id:crypto.randomUUID(),prompt,attachments:files,input:inputFor(prompt,files,item),output:[],text:'',status:'running',modelId:item.id,modelName:item.display_name,createdAt:Date.now()};
    const prior = (retry ? chat.turns.slice(0,-1) : chat.turns).filter(x => x.status === 'success').map(x => ({...x,output:continuation(x.output,x.modelId === item.id && item.preserve_reasoning)}));
    const context = buildContext([...prior,turn],item,output);
    const body = {model_id:item.id,input:context.input,reasoning_effort:$('effort').value || null,max_output_tokens:output};
    if (new TextEncoder().encode(JSON.stringify({action:'respond',...body})).length > MAX_REQUEST_BYTES) throw new Error('request_too_large');
    if (retry) chat.turns.pop();
    chat.turns.push(turn); if (!chat.title) chat.title = prompt.slice(0,60) || files[0]?.name || '';
    await persist(chat,guard); persisted = true;
    if (guard !== epoch) return;
    pending = []; $('prompt').value = ''; status(context.truncated ? 'truncated' : 'sending'); render();
    const response = await request('respond',body,controller.signal);
    if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('request');
    turn.quotaLimited = response.headers.get('x-chat-quota-limited') === 'true';
    const result = await readResponses(response.body, value => {
      if (guard !== epoch || run !== active) return;
      turn.text = value.text; turn.output = value.output; turn.usage = value.usage;
      if (value.status !== 'interrupted') turn.status = value.status;
      renderMessages();
      if (Date.now() - saveAt > 1000) {
        saveAt = Date.now(); const snapshot = structuredClone(chat);
        saveQueue = saveQueue.then(() => chatStore.save(snapshot)).catch(() => { storageError = true; controller.abort(); });
      }
    });
    if (guard === epoch) Object.assign(turn,{...result,status:result.status});
  } catch (error) {
    if (turn) turn.status = run.stopped ? 'cancelled' : controller.signal.aborted ? 'interrupted' : 'failure';
    failureKey = storageError ? 'storage' : ['context','request_too_large','file','pdf','busy','storage','quota','blacklisted'].includes(error.message) ? error.message : run.stopped ? 'cancelled' : 'request';
    const reset = quotaReset(error.quota);
    if (failureKey === 'quota' && reset) { failureKey = 'quotaReset'; failureVars = {reset}; }
    if (guard === epoch) status(failureKey, failureVars);
  } finally {
    await saveQueue;
    if (persisted) {
      if (turn.status === 'running') turn.status = run.stopped ? 'cancelled' : 'interrupted';
      try { await persist(chat,guard); } catch { storageError = true; }
    }
    generations.delete(run); finish();
    if (guard === epoch && active === run) {
      active = null;
      if (storageError) status('storage');
      else if (failureKey) status(failureKey, failureVars);
      else if (persisted) status(turn.quotaLimited && turn.status === 'incomplete' ? 'quotaTruncated' : turn.quotaLimited && turn.status === 'success' ? 'quotaLimited' : turn.status);
      render();
    }
  }
}
async function auth(next, reload = false) {
  if (!reload && session?.user.id === next?.user.id && next) {
    // Token refreshes belong to the same account epoch, including during startup.
    session = next;
    return;
  }
  const guard = ++epoch, staleRuns = [...generations];
  for (const run of staleRuns) { run.stopped = false; run.controller.abort(); }
  catalogController?.abort();
  active = null; attaching = false;
  session = next; models = []; chats = []; current = null; pending = []; $('prompt').value = ''; $('workspace').hidden = true;
  $('model').replaceChildren(); gateKey = next ? 'loading' : 'login'; render();
  if (!next) return;
  try {
    const controller = new AbortController();
    catalogController = controller;
    let token = next.access_token, response;
    try {
      response = await request('catalog',{},controller.signal,token);
    } catch (error) {
      // Retry once only when this account has received a newer token.
      if (error.status !== 401 || guard !== epoch || session?.user.id !== next.user.id || session.access_token === token || controller.signal.aborted) throw error;
      token = session.access_token;
      response = await request('catalog',{},controller.signal,token);
    }
    const data = await response.json();
    if (guard !== epoch) return;
    catalogController = null;
    await Promise.allSettled(staleRuns.filter(run => run.userId === next.user.id).map(run => run.done));
    if (guard !== epoch) return;
    let saved;
    try { saved = await chatStore.list(next.user.id); } catch { throw new Error('storage'); }
    if (guard !== epoch) return;
    models = data.models || []; chats = saved;
    for (const chat of chats) for (const turn of chat.turns) if (turn.status === 'running') { turn.status = 'interrupted'; await persist(chat,guard); }
    if (guard !== epoch) return;
    for (const item of models) $('model').add(new Option(item.display_name,item.id));
    configureModel(); gateKey = models.length ? '' : 'noModels'; status('ready');
    current = chats[0] || null; if (!current) newChat();
    $('workspace').hidden = false; render();
  } catch (error) { if (guard === epoch) { catalogController = null; gateKey = ['storage','profile','login','blacklisted','quota'].includes(error.message) ? error.message : 'request'; render(); } }
}
$('composer').onsubmit = event => { event.preventDefault(); void generate(); };
$('prompt').onkeydown = event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); void generate(); } };
$('stop').onclick = () => { if (active) { active.stopped = true; active.controller.abort(); } };
$('retry').onclick = () => void generate(true);
$('new').onclick = newChat;
$('model').onchange = configureModel;
$('files').onchange = async () => {
  const guard = epoch, selected = [...$('files').files], item = model(); $('files').value = '';
  if (!item || active || attaching) return;
  attaching = true; controls();
  try {
    if (pending.length + selected.length > MAX_ATTACHMENTS) throw new Error('file');
    const prepared = [];
    for (const file of selected) prepared.push(await prepareFile(file,item));
    if (guard === epoch) { pending.push(...prepared); renderAttachments(); }
  } catch (error) { if (guard === epoch) status(['pdf','file'].includes(error.message) ? error.message : 'file'); }
  finally { if (guard === epoch) { attaching = false; controls(); } }
};
$('rename').onclick = async () => {
  if (!current || active) return;
  const chat = current, guard = epoch, title = prompt(t('renamePrompt'),chat.title);
  if (title === null) return; chat.title = title.trim().slice(0,120);
  try { await persist(chat,guard); if (guard === epoch) renderList(); } catch {}
};
$('delete').onclick = async () => {
  if (!current || active || !confirm(t('confirmDelete'))) return;
  const id = current.id, userId = session.user.id, guard = epoch;
  try {
    await chatStore.delete(userId,id);
    if (guard !== epoch) return;
    chats = chats.filter(x => x.id !== id); current = chats[0] || null;
    if (!current) newChat();
    render();
  } catch {
    if (guard === epoch) status('storage');
  }
};
$('clear').onclick = async () => {
  if (active || !session || !confirm(t('confirmClear'))) return;
  const guard = epoch, userId = session.user.id;
  try {
    await chatStore.clear(userId);
    if (guard !== epoch) return;
    chats = []; current = null; newChat();
  } catch {
    if (guard === epoch) status('storage');
  }
};
$('export').onclick = async () => {
  if (!current || active) return;
  const guard = epoch;
  try {
    const chat = structuredClone(current);
    for (const turn of chat.turns) for (const file of turn.attachments || []) {
      if (file.blob) file.originalData = await fileData(file.blob);
      delete file.blob;
    }
    if (guard !== epoch) return;
    const url = globalThis.URL.createObjectURL(new Blob([JSON.stringify(chat,null,2)],{type:'application/json'}));
    const link = document.createElement('a'); link.href = url; link.download = `chat-${chat.id}.json`; link.click();
    setTimeout(() => globalThis.URL.revokeObjectURL(url),1000);
  } catch {
    if (guard === epoch) status('storage');
  }
};
$('language').onclick = () => ClubI18n.setLang(ClubI18n.getLang() === 'zh' ? 'en' : 'zh');
window.addEventListener('club:langchange',render); setTimeout(render,0);
let authEvent = 0;
// Capture startup ownership before subscribing: subscription may emit synchronously.
const initialAuthEvent = authEvent, initialEpoch = epoch;
client.auth.onAuthStateChange((_event,next) => {
  authEvent++;
  setTimeout(() => void auth(next),0);
});
client.auth.getSession().then(({data,error}) => {
  if (authEvent !== initialAuthEvent || epoch !== initialEpoch) return;
  if (error) { status('login'); return; }
  void auth(data.session);
}).catch(() => { if (authEvent === initialAuthEvent && epoch === initialEpoch) status('login'); });
