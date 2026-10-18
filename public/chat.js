import {MAX_FILE_BYTES, MAX_REQUEST_BYTES, MAX_ATTACHMENTS, buildContext, estimateTokens, readResponses, continuation, chatEndpoint, nativeRequest, normalizeChatResponse} from './chat-core.js';
import {chatStore} from './chat-store.js';

const URL = 'https://jgezpvmlnhycxslqbwcx.supabase.co';
const KEY = 'sb_publishable_B29ClgwZagW32Ow5x6VdKQ_IL65F7dl';
const client = window.supabase.createClient(URL, KEY);
const $ = id => document.getElementById(id);
const t = (key, vars) => ClubI18n.t(`chat.${key}`, vars);
let session = null, epoch = 0, models = [], customModels = [], chats = [], current = null, pending = [], active = null;
let memberName = '';
let customStatusKey = '', customStatusVars = {}, customBusy = false;
/* 自动/手动压缩进行中：与生成同样属于忙碌状态，期间禁止发送与编辑。 */
let compacting = false;
let statusKey = 'loading', statusVars = {}, gateKey = 'loading', attaching = false, catalogController = null;
const customKeys = new Map();
const CUSTOM_PROXY_ORIGIN = 'https://jgezpvmlnhycxslqbwcx.supabase.co';
const CUSTOM_PROXY_PATH = /^\/functions\/v1\/chat-api-proxy\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?:\/(?:v1(?:\/(?:responses|messages?|chat\/completions))?|responses|messages?|chat\/completions))?$/i;
const CUSTOM_METADATA = Object.freeze({context_window:128000,max_output_tokens:8192,default_max_output_tokens:8192,reasoning_efforts:[],default_reasoning_effort:null,supports_images:true,supports_pdf:true,preserve_reasoning:false});
const generations = new Set();
const ICONS = {
  copy:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2.1"/><path d="M5.5 15.5V6.5a2 2 0 0 1 2-2h8"/></svg>',
  retry:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.6 5.9"/><path d="M20 4v7h-7"/></svg>',
  edit:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>',
  compact:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h16M4 15h16"/><path d="M12 3v4M12 17v4"/></svg>'
};

/* 上下文压缩：回复完成后达到该比例即自动摘要；保留最近若干轮原文。 */
const CONTEXT_AUTO_RATIO = 0.85;
const CONTEXT_KEEP_TURNS = 4;
const CONTEXT_SUMMARY_MAX_INPUT = 120000;

/* 编辑中的轮次 id；为 null 表示普通新消息。 */
let editingTurnId = null;
const timeFmt = new Intl.DateTimeFormat(undefined, {hour:'2-digit', minute:'2-digit'});
const dateFmt = new Intl.DateTimeFormat(undefined, {month:'short', day:'numeric'});
const renderer = new marked.Renderer();

/* ---------- 小工具：全部对 stub DOM 容错，便于 tools/test-chat-core.mjs 在虚拟机里跑 ---------- */
function classOn(node, name, on = true) { node?.classList?.toggle?.(name, on); }
function setHidden(node, hidden) { if (node) node.hidden = hidden; }
function inner(node, value) { if (node) node.innerHTML = value; }
function iconButton(icon, key, handler, className = 'chat-msg-action') {
  const node = document.createElement('button');
  node.type = 'button'; node.className = className; node.innerHTML = icon;
  node.setAttribute('aria-label', t(key)); node.title = t(key);
  node.onclick = handler;
  return node;
}
function textButton(key, handler, className = '') {
  const node = document.createElement('button');
  node.type = 'button'; node.className = className; node.textContent = t(key);
  node.onclick = handler;
  return node;
}
function shortStamp(value) {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  return date.toDateString() === now.toDateString() ? timeFmt.format(date) : dateFmt.format(date);
}
function pluralMessages(count) {
  if (!count) return '';
  return t(count === 1 ? 'messageCountOne' : 'messageCount', {n:count});
}

function setSidebarOpen(open) {
  const layout = $('workspace'), toggle = $('sidebarToggle'), sidebar = $('chatSidebar'), backdrop = $('sidebarBackdrop');
  if (!layout || !toggle || !sidebar) return;
  classOn(layout, 'sidebar-open', open);
  toggle.setAttribute('aria-expanded', String(open));
  sidebar.setAttribute('aria-hidden', String(!open));
  if (backdrop) backdrop.hidden = !open;
}
function closeSidebarOnMobile() {
  if (globalThis.matchMedia?.('(max-width: 760px)').matches) setSidebarOpen(false);
}

/* ---------- 设置抽屉 ---------- */
let settingsTimer = 0;
function setSettingsOpen(open) {
  const panel = $('chatSettings'), backdrop = $('settingsBackdrop'), button = $('settingsToggle');
  if (!panel) return;
  clearTimeout(settingsTimer);
  button?.setAttribute('aria-expanded', String(open));
  if (open) {
    panel.hidden = false;
    if (backdrop) backdrop.hidden = false;
    // 强制一次布局（隐藏 → 显示后立刻加类），不要用 rAF：后台标签页里 rAF 可能长期不触发。
    void panel.offsetWidth;
    classOn(panel, 'is-open', true);
  } else {
    classOn(panel, 'is-open', false);
    if (backdrop) backdrop.hidden = true;
    settingsTimer = setTimeout(() => { if (!open) panel.hidden = true; }, 280);
  }
}
function syncHeaderUi() {
  const title = $('headerChatTitle');
  if (title) title.textContent = current?.title || t('new');
  const count = $('conversationCount');
  if (count) { count.textContent = String(chats.length); count.hidden = !chats.length; }
  const name = $('accountName');
  const label = memberName || session?.user?.user_metadata?.member_name || session?.user?.email || t('accountFallback');
  if (name) name.textContent = label;
  const avatar = $('accountAvatar');
  if (avatar) avatar.textContent = String(label).trim().charAt(0).toUpperCase() || '·';
}

function customUrl(value) {
  try {
    const url = new globalThis.URL(String(value).trim());
    url.pathname = url.pathname.replace(/\/+$/, '');
    if (url.origin !== CUSTOM_PROXY_ORIGIN || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !CUSTOM_PROXY_PATH.test(url.pathname)) throw new Error('proxy_url');
    return `${url.origin}${url.pathname}`;
  } catch { throw new Error('proxy_url'); }
}
function customModel(item) { return item?.source === 'custom'; }
function customKey(item) { return item?.source === 'custom' ? customKeys.get(item.profileId) || '' : ''; }
function clearCustomKeys() { customKeys.clear(); $('customApiKey').value = ''; }
function customForm(item = model()) {
  $('customModelId').value = item?.source === 'custom' ? item.profileId : '';
  $('customModelName').value = item?.source === 'custom' ? item.profileName : '';
  $('customModelKey').value = item?.source === 'custom' ? item.model_key : '';
  $('customBaseUrl').value = item?.source === 'custom' ? item.base_url : '';
  $('customApiKey').value = item?.source === 'custom' ? customKey(item) : '';
}
function customStatus(key = '', vars = {}) { customStatusKey = key; customStatusVars = vars; $('customModelStatus').textContent = key ? t(key, vars) : ''; }
async function customRequest(item, body, signal) {
  const key = customKey(item);
  if (!key) throw new Error('customKey');
  const endpoint = chatEndpoint(customUrl(item.base_url), true);
  const payload = nativeRequest({...body,model:item.model_key,stream:true}, endpoint.protocol);
  const serialized = JSON.stringify(payload);
  if (new TextEncoder().encode(serialized).length > MAX_REQUEST_BYTES) throw new Error('request_too_large');
  const response = await fetch(endpoint.url, {method:'POST',headers:{'Content-Type':'application/json',Accept:'text/event-stream','Authorization':`Bearer ${key}`},body:serialized,signal});
  if (!response.ok) throw new Error('request');
  if (response.body && response.headers.get('content-type')?.includes('text/event-stream')) return {response,stream:true,protocol:endpoint.protocol};
  return {response,stream:false,result:normalizeChatResponse(await response.json(), endpoint.protocol)};
}
renderer.html = ({text}) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
renderer.image = ({text}) => `[${text || t('image')}]`;
function markdown(text) {
  const fragment = DOMPurify.sanitize(marked.parse(text || '', {renderer}), {
    RETURN_DOM_FRAGMENT:true, FORBID_TAGS:['img','style','iframe','form','input','button','svg','math'],
    FORBID_ATTR:['style','id','name'], ALLOW_DATA_ATTR:false
  });
  for (const link of fragment.querySelectorAll?.('a') || []) {
    try {
      const url = new globalThis.URL(link.getAttribute('href'));
      if (!['https:','http:','mailto:'].includes(url.protocol)) throw new Error();
      link.rel = 'noopener noreferrer'; link.target = '_blank';
    } catch { link.removeAttribute('href'); }
  }
  decorateCode(fragment);
  return fragment;
}
/* 给每个代码块加语言标签与复制按钮（不改变 DOM 净化结果，只做外层包装）。 */
function decorateCode(fragment) {
  const blocks = fragment?.querySelectorAll ? fragment.querySelectorAll('pre') : [];
  for (const pre of blocks) {
    if (pre.closest?.('.chat-code')) continue;
    const wrap = document.createElement('div'); wrap.className = 'chat-code';
    const bar = document.createElement('div'); bar.className = 'chat-code-bar';
    const code = pre.querySelector ? pre.querySelector('code') : null;
    const match = String(code?.className || '').match(/language-([\w+#.-]+)/);
    const label = document.createElement('span'); label.textContent = match ? match[1] : t('codeBlock');
    const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'chat-code-copy';
    copy.textContent = t('copy');
    copy.onclick = () => navigator.clipboard.writeText(pre.textContent || '').then(() => status('copied')).catch(() => status('error'));
    bar.append(label, copy);
    wrap.append(bar);
    if (pre.parentNode) { pre.parentNode.replaceChild(wrap, pre); wrap.append(pre); }
  }
}
const model = () => models.find(x => x.id === $('model').value);
function mergeModels(catalog, saved) {
  return [...catalog, ...saved.map(item => ({...CUSTOM_METADATA,...item,profileId:item.id,id:`custom:${item.id}`,source:'custom',profileName:item.display_name,display_name:`${item.display_name} · ${t('customBadge')}`}))];
}
const ERROR_STATUS = new Set(['failure','interrupted','cancelled','storage','request','quota','quotaReset','context','request_too_large','file','pdf','blacklisted','busy','customKey','profile','login','claude_thinking','claude_thinking_budget','claude_effort']);
function status(key, vars = {}) {
  statusKey = key; statusVars = vars;
  const node = $('status');
  if (node) { node.textContent = t(key, vars); classOn(node, 'is-error', ERROR_STATUS.has(key)); }
  const spinner = $('statusSpinner');
  if (spinner) spinner.hidden = !isBusy();
}
function quotaReset(quota) {
  const buckets = [{...quota?.global, limit:quota?.global?.daily_limit}, ...(quota?.periods || [])];
  const dates = buckets.filter(row => row && row.limit != null && row.remaining === 0 && row.resets_at).map(row => row.resets_at);
  return dates.sort().at(-1) || '';
}
function button(key, handler) {
  const node = document.createElement('button'); node.type = 'button'; node.textContent = t(key);
  node.onclick = handler; return node;
}
/* 生成、附件解析、自定义模型保存、上下文压缩期间都算忙碌。 */
function isBusy() { return !!active || attaching || customBusy || compacting; }
function controls() {
  const busy = isBusy();
  for (const id of ['send','retry','new','rename','delete','clear','export','files','model','effort']) $(id).disabled = busy || !session || !models.length;
  for (const id of ['customSave','customDelete','customClearKey','customModelName','customModelKey','customBaseUrl','customApiKey']) $(id).disabled = busy || !session;
  const trigger = $('modelTrigger');
  // 原生 select 已隐藏，忙碌状态必须同样禁用可见的触发按钮。
  if (trigger) trigger.disabled = busy || !session || !models.length;
  const effortTrigger = $('effortTrigger');
  if (effortTrigger) effortTrigger.disabled = busy || !session;
  $('stop').disabled = !active;
  const prompt = $('prompt');
  // 压缩期间锁定输入，明确告诉用户现在不能发送，而不是静默吞掉回车。
  if (prompt) prompt.disabled = compacting;
  const spinner = $('statusSpinner');
  if (spinner) spinner.hidden = !busy;
}

/* ---------- 消息渲染（增量：只有轮次集合变化才重建，流式时只更新正文） ---------- */
let rendered = {key:'', nodes:[]};

function emptyState() {
  const wrap = document.createElement('div'); wrap.className = 'chat-empty';
  const mark = document.createElement('div'); mark.className = 'chat-empty-mark'; mark.textContent = '✦';
  const title = document.createElement('h2'); title.textContent = t('emptyTitle');
  const body = document.createElement('p'); body.textContent = t('emptyBody');
  const grid = document.createElement('div'); grid.className = 'chat-suggestions';
  for (let i = 1; i <= 4; i++) {
    const card = document.createElement('button'); card.type = 'button'; card.className = 'chat-suggestion';
    const strong = document.createElement('strong'); strong.textContent = t(`suggest${i}Title`);
    const span = document.createElement('span'); span.textContent = t(`suggest${i}Desc`);
    card.append(strong, span);
    card.onclick = () => {
      if (active || !session || !models.length) return;
      $('prompt').value = t(`suggest${i}Prompt`);
      resetPromptHeight();
      $('prompt').focus?.();
      $('prompt').scrollIntoView?.({behavior:'smooth', block:'nearest'});
    };
    grid.append(card);
  }
  const hint = document.createElement('div'); hint.className = 'chat-empty-hint';
  const kbd = document.createElement('kbd'); kbd.textContent = 'Enter';
  const hintText = document.createElement('span'); hintText.textContent = t('emptyHint');
  hint.append(kbd, hintText);
  wrap.append(mark, title, body, grid, hint);
  return wrap;
}

function statusPill(turn) {
  const pill = document.createElement('span');
  pill.className = `chat-status-pill is-${turn.status}`;
  pill.textContent = t(turn.status === 'running' ? 'sending' : turn.status);
  return pill;
}

function fileChips(files) {
  const list = document.createElement('div'); list.className = 'chat-message-files';
  for (const file of files || []) {
    if (file.kind === 'image') {
      const img = document.createElement('img'); img.src = file.data; img.alt = file.name; img.title = file.name;
      list.append(img);
      continue;
    }
    const chip = document.createElement('span'); chip.className = 'chat-file-chip';
    chip.textContent = file.name;
    chip.title = file.name;
    list.append(chip);
  }
  return list;
}

function userInitial() {
  const label = String(memberName || session?.user?.user_metadata?.member_name || session?.user?.email || '').trim();
  return label ? label.charAt(0).toUpperCase() : t('userInitial');
}

function turnNode(turn, index, total) {
  const wrap = document.createElement('section'); wrap.className = 'chat-turn';

  /* 用户 */
  const user = document.createElement('article'); user.className = 'chat-message user';
  const userAvatar = document.createElement('div'); userAvatar.className = 'chat-avatar'; userAvatar.textContent = userInitial();
  const userBody = document.createElement('div'); userBody.className = 'chat-message-body';
  const userHead = document.createElement('header'); userHead.className = 'chat-message-head';
  const userLabel = document.createElement('strong'); userLabel.textContent = t('user');
  const userMeta = document.createElement('span'); userMeta.className = 'chat-message-meta'; userMeta.textContent = shortStamp(turn.createdAt);
  const userActions = document.createElement('div'); userActions.className = 'chat-message-actions';
  userActions.append(iconButton(ICONS.copy, 'copy', () => copyText(turn.prompt)));
  userActions.append(iconButton(ICONS.edit, 'editMessage', () => startEdit(turn.id)));
  userHead.append(userLabel, userMeta, userActions);
  const bubble = document.createElement('div'); bubble.className = 'chat-bubble'; bubble.textContent = turn.prompt || '';
  userBody.append(userHead, bubble);
  if (turn.attachments?.length) userBody.append(fileChips(turn.attachments));
  user.append(userAvatar, userBody);

  /* 助手 */
  const assistant = document.createElement('article'); assistant.className = 'chat-message assistant';
  const aiAvatar = document.createElement('div'); aiAvatar.className = 'chat-avatar'; aiAvatar.textContent = '✦';
  const aiBody = document.createElement('div'); aiBody.className = 'chat-message-body';
  const aiHead = document.createElement('header'); aiHead.className = 'chat-message-head';
  const aiLabel = document.createElement('strong'); aiLabel.textContent = t('assistant');
  const aiMeta = document.createElement('span'); aiMeta.className = 'chat-message-meta'; aiMeta.textContent = turn.modelName || '';
  const pill = statusPill(turn);
  const aiActions = document.createElement('div'); aiActions.className = 'chat-message-actions';
  aiActions.append(iconButton(ICONS.copy, 'copy', () => copyText(turn.text)));
  // 每一轮都可重试；重试较早的轮次会重新生成该轮并丢弃其后的问答。
  aiActions.append(iconButton(ICONS.retry, 'regenerate', () => { if (!active) void regenerate(turn.id); }));
  aiHead.append(aiLabel, aiMeta, pill, aiActions);
  const mark = document.createElement('div'); mark.className = 'chat-markdown';
  mark.append(markdown(turn.text));
  aiBody.append(aiHead, mark);
  assistant.append(aiAvatar, aiBody);

  classOn(assistant, 'is-streaming', turn.status === 'running');
  wrap.append(user, assistant);
  return {wrap, assistant, mark, pill, meta:aiMeta, text:turn.text || '', status:turn.status, actions:userActions, aiActions};
}

/* 压缩分隔条：插在消息流开头，说明「更早的内容已被摘要」，摘要本身可展开查看。 */
function compactionNode(summary) {
  const wrap = document.createElement('div'); wrap.className = 'chat-compaction';
  const icon = document.createElement('span'); icon.className = 'chat-compaction-icon'; icon.innerHTML = ICONS.compact;
  const body = document.createElement('span'); body.className = 'chat-compaction-body';
  const text = document.createElement('div'); text.textContent = t('compactedNotice', {n:summary.turns || 0});
  const details = document.createElement('details');
  const toggle = document.createElement('summary'); toggle.textContent = t('compactedShow');
  const detail = document.createElement('p'); detail.className = 'chat-compaction-detail'; detail.textContent = summary.text || '';
  details.append(toggle, detail);
  body.append(text, details);
  wrap.append(icon, body);
  return wrap;
}

function copyText(value) {
  navigator.clipboard.writeText(value || '').then(() => status('copied')).catch(() => status('error'));
}

function renderMessages() {
  const box = $('messages');
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 64;
  if (!current?.turns.length) {
    rendered = {key:'', nodes:[]};
    box.replaceChildren(emptyState());
    updateScrollButton();
    return;
  }
  // 语言也纳入 key：动态文案（角色、状态、复制）必须随语言重建，不能只换静态节点。
  const key = `${ClubI18n.getLang?.() || 'zh'}|${current.turns.map(turn => turn.id).join('|')}|${current.summary?.createdAt || 0}`;
  if (key !== rendered.key) {
    box.replaceChildren();
    rendered = {key, nodes:[]};
    if (current.summary?.text) box.append(compactionNode(current.summary));
    const total = current.turns.length;
    current.turns.forEach((turn, index) => {
      const node = turnNode(turn, index, total);
      rendered.nodes.push(node);
      box.append(node.wrap);
    });
    if (nearBottom) box.scrollTop = box.scrollHeight;
  } else {
    current.turns.forEach((turn, index) => {
      const node = rendered.nodes[index];
      if (!node) return;
      if ((turn.text || '') !== node.text) {
        node.text = turn.text || '';
        node.mark.replaceChildren();
        node.mark.append(markdown(node.text));
      }
      if (turn.status !== node.status) {
        node.status = turn.status;
        node.pill.className = `chat-status-pill is-${turn.status}`;
        node.pill.textContent = t(turn.status === 'running' ? 'sending' : turn.status);
      }
      classOn(node.assistant, 'is-streaming', turn.status === 'running');
      if (node.meta && (turn.modelName || '') !== node.meta.textContent) node.meta.textContent = turn.modelName || '';
    });
  }
  updateScrollButton();
}

function renderList() {
  const nav = $('conversations');
  nav.replaceChildren();
  const query = String($('chatSearch')?.value || '').trim().toLowerCase();
  const visible = query ? chats.filter(chat => String(chat.title || '').toLowerCase().includes(query)) : chats;
  if (!visible.length) {
    const empty = document.createElement('p'); empty.className = 'chat-thread-empty';
    empty.textContent = t(query ? 'noMatches' : 'noChats');
    nav.append(empty);
    syncHeaderUi();
    return;
  }
  for (const chat of visible) {
    const node = document.createElement('button');
    node.type = 'button'; node.className = 'chat-thread';
    node.setAttribute('aria-current', String(chat.id === current?.id));
    const title = document.createElement('span'); title.className = 'chat-thread-title';
    title.textContent = chat.title || t('new');
    const meta = document.createElement('span'); meta.className = 'chat-thread-meta';
    meta.textContent = [shortStamp(chat.updatedAt), pluralMessages(chat.turns?.length)].filter(Boolean).join(' · ');
    node.append(title, meta);
    node.onclick = () => {
      if (!active && !attaching) {
        if (editingTurnId !== null) cancelEdit();
        current = chat; pending = []; $('prompt').value = '';
        resetPromptHeight(); closeSidebarOnMobile(); render();
      }
    };
    nav.append(node);
  }
  syncHeaderUi();
}

function renderAttachments() {
  const box = $('attachments');
  box.replaceChildren();
  for (const file of pending) {
    const row = document.createElement('div'); row.className = 'chat-attachment';
    const name = document.createElement('span'); name.textContent = `${file.name} (${Math.ceil(file.size / 1024)} KiB)`;
    row.append(name, button('remove', () => { if (!active) { pending = pending.filter(x => x !== file); renderAttachments(); } }));
    if (file.kind === 'image') { const img = document.createElement('img'); img.className = 'chat-preview'; img.src = file.data; img.alt = file.name; row.prepend(img); }
    box.append(row);
  }
}

/* ---------- 上下文用量与压缩 ---------- */
/* 摘要以一条 input_text 前缀的形式进入请求；本地原文保持不变，可随时查看与导出。 */
function summaryPrefix(chat) {
  return chat?.summary?.text ? [{role:'system',content:[{type:'input_text',text:`Earlier in this conversation (compressed):\n${chat.summary.text}`}]}] : [];
}
function contextBudget(item, output) { return Math.max(1, item.context_window - output); }
/* 真正会发给模型的轮次：摘要覆盖的前 N 轮已被替换，不再计入用量。 */
function contextTurns(chat) {
  if (!chat) return [];
  const from = Math.min(chat.summary?.turns || 0, chat.turns.length);
  return chat.turns.slice(from);
}
function contextUsed(chat, item, output) {
  if (!chat) return 0;
  const turns = contextTurns(chat).map(turn => ({...turn, output:turn.status === 'success' ? continuation(turn.output, false) : []}));
  return estimateTokens(summaryPrefix(chat).concat(turns.flatMap(turn => turn.input.concat(turn.output))));
}
function renderContextMeter() {
  const meter = $('contextMeter'), fill = $('contextFill'), textNode = $('contextText'), track = meter?.querySelector?.('.chat-context-track');
  const item = model();
  if (!meter || !item || !current) { setHidden(meter, true); return; }
  const output = item.default_max_output_tokens;
  const total = contextBudget(item, output);
  const used = contextUsed(current, item, output);
  // 百分比不封顶：真实超出时必须显示 138% 而不是误导性的 100%。
  const ratio = total > 0 ? used / total : 0;
  const width = Math.min(1, ratio);
  setHidden(meter, false);
  if (fill?.style) fill.style.width = `${(width * 100).toFixed(1)}%`;
  classOn(fill, 'is-warn', ratio >= CONTEXT_AUTO_RATIO && ratio < 0.92);
  classOn(fill, 'is-danger', ratio >= 0.92);
  if (textNode) textNode.textContent = t('contextUsage', {used:formatTokens(used), total:formatTokens(total), percent:Math.round(ratio * 100)});
  if (track) { track.setAttribute('aria-valuenow', String(Math.round(ratio * 100))); track.setAttribute('aria-valuetext', textNode.textContent); }
  const button = $('compactNow');
  if (button) {
    button.textContent = t(current.summary?.text ? 'recompact' : 'compactNow');
    button.disabled = !!active || !current.turns.length;
    button.title = current.summary?.text ? t('recompactTitle') : t('compactTitle');
  }
}
function formatTokens(value) {
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
  return String(value);
}

/* 取要压缩的轮次：只压缩「尚未被摘要覆盖」的部分，并保留最近 CONTEXT_KEEP_TURNS 轮原文，
   且至少保留最后一轮，否则刚发的一轮会被立刻摘要、原文从对话里「消失」。 */
function compactableTurns(chat) {
  const remaining = contextTurns(chat);
  const total = remaining.length;
  if (total < 2) return [];
  const keep = Math.max(1, Math.min(CONTEXT_KEEP_TURNS, total - 1));
  return remaining.slice(0, total - keep);
}
function transcriptFor(turns, limit) {
  const lines = [];
  let bytes = 0;
  for (const turn of turns) {
    const answer = (turn.text || '').trim();
    const block = `${t('summaryUserLabel')}: ${turn.prompt || ''}\n${t('summaryAssistantLabel')}: ${answer}\n`;
    bytes += new TextEncoder().encode(block).length;
    if (bytes > limit) break;
    lines.push(block);
  }
  return lines.join('\n---\n');
}
/**
 * 是否需要压缩。直接用会话现有的全部轮次统计用量——自动压缩发生在回复完成之后，
 * 此时历史里已经包含这一轮，不需要再额外传「待发送轮次」。
 */
function needsCompaction(chat, item, output, force = false) {
  if (!chat.turns.length || !compactableTurns(chat).length) return false;
  if (force) return true;
  // 从未成功生成过回复的失败轮次不应触发压缩。
  if (!chat.turns.some(turn => turn.status === 'success')) return false;
  return contextUsed(chat, item, output) >= contextBudget(item, output) * CONTEXT_AUTO_RATIO;
}

/**
 * 生成摘要。摘要失败不应该挡住对话，因此除取消外的错误都静默降级，
 * 由下一次回复完成后再尝试。
 */
async function ensureContextSummary(chat, item, output, guard, force = false) {
  if (!needsCompaction(chat, item, output, force)) return summaryPrefix(chat);
  // 已有摘要时只需要把「上次摘要 + 摘要之后未压缩的轮次」重新合并。
  const candidates = compactableTurns(chat);
  const compacted = candidates.slice(-24);
  const transcript = transcriptFor(compacted, CONTEXT_SUMMARY_MAX_INPUT);
  if (!transcript.trim()) return summaryPrefix(chat);

  const instruction = [
    chat.summary?.text ? `${t('summaryInstructionCarry')}\n\n${chat.summary.text}` : '',
    transcript
  ].filter(Boolean).join('\n\n');

  const body = {
    model_id: item.id,
    input: [{role:'user',content:[{type:'input_text',text:`${t('summaryInstruction')}\n\n${instruction}`}]}],
    max_output_tokens: Math.min(item.default_max_output_tokens, 2048)
  };
  status('compacting');
  let text = '';
  try {
    const response = customModel(item)
      ? await customRequest(item, {input:body.input, max_output_tokens:body.max_output_tokens}, undefined)
      : {response:await request('respond', body, undefined), stream:true};
    if (response.stream) {
      if (!response.response.body || !response.response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('request');
      const result = await readResponses(response.response.body, () => {}, response.protocol);
      if (result.status !== 'success') return summaryPrefix(chat);
      text = (result.text || '').trim();
    } else if (response.result?.status === 'success') text = (response.result.text || '').trim();
  } catch (error) {
    // 取消或切账号时不要重写状态；其余情况静默降级。
    if (guard !== epoch) return summaryPrefix(chat);
    if (error?.message === 'busy' || error?.status === 409) throw error;
    return summaryPrefix(chat);
  }
  if (guard !== epoch) return summaryPrefix(chat);
  if (!text) return summaryPrefix(chat);
  // 记录累计被摘要覆盖的轮次数（多次压缩要累加），而不是这一次的轮数。
  const covered = Math.min(chat.summary?.turns || 0, chat.turns.length) + compacted.length;
  chat.summary = {text, createdAt:Date.now(), turns:covered, upToId:compacted.at(-1)?.id || ''};
  await persist(chat, guard).catch(() => {});
  return summaryPrefix(chat);
}
function turnById(id) { return current?.turns.find(turn => turn.id === id) || null; }

function setEditBanner(open) {
  const banner = $('editBanner'), label = $('sendLabel');
  if (!banner) return;
  banner.hidden = !open;
  if (open) {
    const turn = turnById(editingTurnId);
    // 截断提示必须说清代价：编辑之后的所有问答都会被移除。
    const removed = current ? current.turns.length - current.turns.findIndex(x => x.id === editingTurnId) - 1 : 0;
    $('editBannerText').textContent = t(removed > 0 ? 'editBannerWithRemoval' : 'editBanner', {n:removed});
    if (turn) $('editBannerText').title = turn.prompt || '';
  }
  if (label) label.textContent = t(open ? 'resend' : 'send');
  classOn($('send'), 'is-editing', open);
}

function startEdit(id) {
  if (isBusy()) return;
  const turn = turnById(id);
  if (!turn) return;
  editingTurnId = id;
  $('prompt').value = turn.prompt || '';
  pending = (turn.attachments || []).map(file => ({...file}));
  renderAttachments();
  resetPromptHeight();
  setEditBanner(true);
  $('prompt').focus?.();
  const box = $('messages'), node = rendered.nodes[current.turns.indexOf(turn)];
  node?.wrap.scrollIntoView?.({behavior:'smooth', block:'center'});
  void box;
}

function cancelEdit() {
  if (editingTurnId === null) return;
  editingTurnId = null;
  $('prompt').value = '';
  pending = [];
  renderAttachments();
  resetPromptHeight();
  setEditBanner(false);
}

/* 重试任意一轮：删除该轮及之后的所有轮次，用原提示词重新生成。 */
function regenerate(id) {
  if (isBusy() || !current) return;
  const index = current.turns.findIndex(turn => turn.id === id);
  if (index < 0) return;
  if (index < current.turns.length - 1 && !confirm(t('confirmRegenerateEarlier'))) return;
  if (editingTurnId !== null) cancelEdit();
  void generate({retryTurnId: id});
}
function setModelMenuOpen(open, focusActive = false) {
  const menu = $('modelMenu'), trigger = $('modelTrigger');
  if (!menu || !trigger) return;
  menu.hidden = !open;
  trigger.setAttribute('aria-expanded', String(open));
  if (!open) return;
  const active = menu.querySelector?.('.chat-model-option[aria-selected="true"]') || menu.querySelector?.('.chat-model-option');
  for (const option of menu.querySelectorAll?.('.chat-model-option') || []) classOn(option, 'is-active', option === active);
  if (focusActive) active?.focus?.();
}
function syncModelTrigger() {
  const select = $('model'), trigger = $('modelTrigger'), text = $('modelTriggerText');
  if (!select || !trigger) return;
  const selected = select.options[select.selectedIndex];
  const label = selected?.textContent || '';
  if (text) text.textContent = label || t('noModels');
  trigger.disabled = !label;
  trigger.title = label;
  const menu = $('modelMenu');
  if (menu) {
    menu.replaceChildren();
    if (!select.options.length) {
      const empty = document.createElement('p'); empty.className = 'chat-model-empty'; empty.textContent = t('noModels');
      menu.append(empty);
      return;
    }
    for (const option of select.options) {
      const item = document.createElement('button');
      item.type = 'button'; item.className = 'chat-model-option'; item.setAttribute('role', 'option');
      if (item.dataset) item.dataset.value = option.value;
      item.setAttribute('aria-selected', String(option.selected));
      const span = document.createElement('span'); span.textContent = option.textContent;
      item.append(span);
      item.onclick = () => {
        select.value = option.value;
        setModelMenuOpen(false);
        syncModelTrigger();
        select.dispatchEvent(new Event('change'));
        trigger.focus?.();
      };
      menu.append(item);
    }
  }
}
function moveModelMenuFocus(delta) {
  const menu = $('modelMenu');
  const items = [...(menu?.querySelectorAll?.('.chat-model-option') || [])];
  if (!items.length) return;
  const index = items.indexOf(document.activeElement);
  const next = items[(index + delta + items.length) % items.length] || items[0];
  for (const item of items) classOn(item, 'is-active', item === next);
  next.focus?.();
}

function syncLangButton() {
  const lang = ClubI18n.getLang?.() || 'zh';
  for (const option of document.querySelectorAll?.('[data-lang-option]') || []) {
    classOn(option, 'is-active', option.dataset?.langOption === lang);
  }
  const button = $('language');
  if (button) button.setAttribute('aria-label', t('language'));
}

function syncGatePanel() {
  const panel = $('gatePanel');
  if (!panel) return;
  const visible = !!gateKey && $('workspace').hidden;
  panel.hidden = !visible;
  const gate = $('gate');
  if (gate) gate.hidden = visible;
  if (!visible) return;
  const titles = {login:'gateTitleLogin', profile:'gateTitleProfile', blacklisted:'gateTitleBlocked', loading:'gateTitleLoading'};
  $('gateTitle').textContent = t(titles[gateKey] || 'gateTitleError');
  $('gateText').textContent = t(gateKey);
}

function render() {
  renderList(); renderMessages(); renderAttachments(); controls(); syncHeaderUi(); syncLangButton(); syncModelTrigger(); renderContextMeter();
  const selected = model(), introduction = $('modelIntroduction'), introductionText = $('modelIntroductionText');
  if (introduction && introductionText) {
    introductionText.textContent = selected?.introduction || '';
    introduction.hidden = !selected?.introduction;
  }
  const defaultOption = [...$('effort').options].find(option => option.value === '');
  if (defaultOption) defaultOption.textContent = t('default');
  const node = $('status');
  if (node) { node.textContent = t(statusKey, statusVars); classOn(node, 'is-error', ERROR_STATUS.has(statusKey)); }
  $('gate').textContent = gateKey ? t(gateKey) : '';
  syncGatePanel();
  syncEffortPicker();
  renderContextMeter();
  updateScrollButton();
}
async function persist(chat, guard) {
  chat.updatedAt = Date.now();
  try { await chatStore.save(chat); }
  catch { if (guard === epoch) status('storage'); throw new Error('storage'); }
}
function newChat() {
  if (!session || isBusy()) return;
  if (editingTurnId !== null) cancelEdit();
  current = {userId:session.user.id,id:crypto.randomUUID(),title:'',updatedAt:Date.now(),turns:[]};
  chats.unshift(current); pending = []; $('prompt').value = ''; resetPromptHeight();
  status('ready'); render();
  $('prompt').focus?.();
}
function modelEfforts(item) {
  if (item?.api_protocol !== 'messages') return {values: item?.reasoning_efforts || [], defaultValue: item?.default_reasoning_effort || ''};
  const config = item.claude_thinking;
  if (config?.mode !== 'adaptive') return {values: [], defaultValue: ''};
  const values = Array.isArray(config.efforts) ? config.efforts.filter(value => ['low', 'medium', 'high', 'xhigh', 'max'].includes(value)) : [];
  return {values, defaultValue: values.includes(config.default_effort) ? config.default_effort : ''};
}
function selectedEffort(item) {
  const config = modelEfforts(item), value = $('effort').value;
  return config.values.includes(value) ? value : null;
}
function configureModel() {
  const item = model(), config = modelEfforts(item); $('effort').replaceChildren();
  if (item?.api_protocol === 'messages' && item.claude_thinking?.mode === 'adaptive') $('effort').add(new Option(t('default'), ''));
  for (const value of config.values) { const opt = new Option(value,value); $('effort').add(opt); }
  if (!$('effort').options.length) $('effort').add(new Option(t('default'),''));
  $('effort').value = config.defaultValue;
  syncEffortPicker();
  render();
}

/* ---------- 思考强度（输入框内，只对配置了 reasoning_efforts 的模型显示） ---------- */
function setEffortMenuOpen(open) {
  const menu = $('effortMenu'), trigger = $('effortTrigger');
  if (!menu || !trigger) return;
  menu.hidden = !open;
  trigger.setAttribute('aria-expanded', String(open));
  if (!open) return;
  const active = menu.querySelector?.('.chat-model-option[aria-selected="true"]') || menu.querySelector?.('.chat-model-option');
  for (const option of menu.querySelectorAll?.('.chat-model-option') || []) classOn(option, 'is-active', option === active);
}
/* 思考强度取值可能是 none/low/medium/high/xhigh/max，也可能是供应商自定义字符串；
   有对应译文就用译文，没有就原样显示。匹配不区分大小写与连字符。 */
const EFFORT_KEYS = Object.freeze({
  none:'off', minimal:'minimal', low:'low', medium:'medium', high:'high',
  xhigh:'xhigh', 'x-high':'xhigh', max:'max', maximum:'max'
});
function effortKey(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[_\s]+/g, '-');
  return EFFORT_KEYS[normalized] || null;
}
function effortLabel(value) {
  if (!value) return t('default');
  const key = effortKey(value);
  if (!key) return value;
  const translated = t(`effort_${key}`);
  return translated === `chat.effort_${key}` ? value : translated;
}
function syncEffortPicker() {
  const select = $('effort'), picker = $('effortPicker'), text = $('effortTriggerText'), menu = $('effortMenu');
  if (!select || !picker) return;
  // 少于两项（只有「默认」）时没有可切换的内容，隐藏胶囊以免占位。
  const meaningful = select.options.length > 1;
  picker.hidden = !meaningful;
  if (!meaningful) { setEffortMenuOpen(false); return; }
  const selected = select.options[select.selectedIndex];
  const claude = model()?.api_protocol === 'messages';
  const label = t(claude ? 'claudeEffort' : 'effort');
  select.setAttribute('aria-label', label);
  $('effortTrigger')?.setAttribute('aria-label', label);
  if (text) text.textContent = `${t(claude ? 'claudeEffort' : 'effortShort')} ${effortLabel(selected?.value)}`;
  if (!menu) return;
  menu.replaceChildren();
  for (const option of select.options) {
    const item = document.createElement('button');
    item.type = 'button'; item.className = 'chat-model-option'; item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(option.selected));
    const span = document.createElement('span'); span.textContent = effortLabel(option.value);
    item.append(span);
    item.onclick = () => {
      select.value = option.value;
      setEffortMenuOpen(false);
      syncEffortPicker();
      select.dispatchEvent(new Event('change'));
    };
    menu.append(item);
  }
}
async function loadCustomModels(token, signal) {
  const response = await request('custom_model_list', {}, signal, token);
  const data = await response.json();
  return Array.isArray(data.models) ? data.models : Array.isArray(data) ? data : [];
}
async function saveCustomModel(event) {
  event.preventDefault();
  if (!session || active || customBusy || !$('customModelForm').reportValidity()) return;
  const guard = epoch, token = session.access_token;
  let baseUrl;
  try { baseUrl = customUrl($('customBaseUrl').value); } catch { return customStatus('customInvalidUrl'); }
  const id = $('customModelId').value || crypto.randomUUID();
  const body = {id,display_name:$('customModelName').value.trim(),model_key:$('customModelKey').value.trim(),base_url:baseUrl,expected_version:customModels.find(item => item.id === id)?.version ?? 0};
  if (!body.display_name || body.display_name.length > 120 || !body.model_key || body.model_key.length > 160) return customStatus('customInvalid');
  const key = $('customApiKey').value.trim();
  if (!key && !customKeys.has(id)) return customStatus('customKeyRequired');
  customBusy = true; controls();
  try {
    const response = await request('custom_model_save', body, undefined, token);
    const data = await response.json();
    if (guard !== epoch) return;
    if (data.code === 'conflict') throw Object.assign(new Error('conflict'),{status:409});
    if (key) customKeys.set(id, key);
    customModels = customModels.filter(item => item.id !== id).concat(data.model || data);
    models = mergeModels(models.filter(item => item.source !== 'custom'), customModels);
    $('model').replaceChildren(...models.map(item => new Option(item.display_name,item.id)));
    $('model').value = `custom:${id}`;
    configureModel(); customForm(model()); customStatus('customSaved');
  } catch (error) { if (guard === epoch) { if (error.status === 409) await refreshCustomProfiles(guard, token); customStatus(error.status === 409 ? 'customConflict' : 'customSaveFailed'); } }
  finally { if (guard === epoch) { customBusy = false; controls(); } }
}
async function deleteCustomModel() {
  const id = $('customModelId').value;
  const item = customModels.find(row => row.id === id);
  if (!item || active || customBusy || !session || !confirm(t('customConfirmDelete'))) return;
  const guard = epoch, token = session.access_token;
  customBusy = true; controls();
  try {
    await request('custom_model_delete', {id,expected_version:item.version}, undefined, token);
    if (guard !== epoch) return;
    customModels = customModels.filter(row => row.id !== id); customKeys.delete(id);
    models = mergeModels(models.filter(row => row.source !== 'custom'), customModels);
    $('model').replaceChildren(...models.map(row => new Option(row.display_name,row.id)));
    configureModel(); customForm(); customStatus('customDeleted');
  } catch (error) { if (guard === epoch) { if (error.status === 409) await refreshCustomProfiles(guard, token); customStatus(error.status === 409 ? 'customConflict' : 'customDeleteFailed'); } }
  finally { if (guard === epoch) { customBusy = false; controls(); } }
}
async function refreshCustomProfiles(guard, token) {
  try {
    const saved = await loadCustomModels(token);
    if (guard !== epoch) return;
    const selected = $('model').value;
    customModels = saved;
    const validIds = new Set(saved.map(item => item.id));
    for (const id of customKeys.keys()) if (!validIds.has(id)) customKeys.delete(id);
    models = mergeModels(models.filter(item => !customModel(item)), saved);
    $('model').replaceChildren(...models.map(item => new Option(item.display_name,item.id)));
    if (models.some(item => item.id === selected)) $('model').value = selected;
    configureModel(); customForm();
  } catch { if (guard === epoch) customStatus('customSaveFailed'); }
}
async function request(action, body = {}, signal, token = session?.access_token) {
  if (!token) throw new Error('login');
  const response = await fetch(`${URL}/functions/v1/chat`, {method:'POST',headers:{'Content-Type':'application/json',apikey:KEY,Authorization:`Bearer ${token}`},body:JSON.stringify({action,...body}),signal});
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw Object.assign(new Error(response.status === 409 ? 'busy' : response.status === 401 ? 'login' : ['context','request_too_large','file','login','profile','quota','blacklisted','claude_thinking','claude_thinking_budget','claude_effort'].includes(data.error) ? data.error : 'request'), {status:response.status, quota:data.quota});
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
/**
 * 三个入口共用一条生成路径：
 *  - 普通发送：prompt 取自输入框
 *  - 编辑重发（editingTurnId）：替换该轮的提示词，并删除其后的所有轮次
 *  - 重试某轮（retryTurnId）：删除该轮及之后的轮次，用原提示词重新生成
 */
function generateGate() {
  if (compacting) return false;
  return !(isBusy() || !session || !model());
}

async function generate({ retryTurnId = null } = {}) {
  if (!generateGate()) return;
  const guard = epoch, chat = current, item = model();
  if (!chat) return;
  const output = item.default_max_output_tokens;

  let editIndex = -1, retryIndex = -1, prompt, files;
  if (retryTurnId) {
    retryIndex = chat.turns.findIndex(turn => turn.id === retryTurnId);
    if (retryIndex < 0) return;
    prompt = chat.turns[retryIndex].prompt;
    files = chat.turns[retryIndex].attachments || [];
  } else if (editingTurnId) {
    editIndex = chat.turns.findIndex(turn => turn.id === editingTurnId);
    prompt = $('prompt').value.trim();
    files = pending.slice();
    if (editIndex < 0) { cancelEdit(); return; }
  } else {
    prompt = $('prompt').value.trim();
    files = pending.slice();
  }
  if (!prompt && !files.length) return;

  const controller = new AbortController();
  let finish;
  const run = {controller,stopped:false,userId:chat.userId,done:new Promise(resolve => { finish = resolve; })};
  generations.add(run); active = run; controls();
  let turn, persisted = false, saveAt = 0, saveQueue = Promise.resolve(), storageError = false, failureKey = '', failureVars = {};
  try {
    turn = {id:crypto.randomUUID(),prompt,attachments:files,input:inputFor(prompt,files,item),output:[],text:'',status:'running',modelId:item.id,modelName:item.display_name,createdAt:Date.now()};
    // 先把这一轮的输入历史确定下来：编辑/重试都从被替换轮之前截断。
    const kept = chat.turns.slice(0, editIndex >= 0 ? editIndex : retryIndex >= 0 ? retryIndex : chat.turns.length);
    const prior = kept.filter(x => x.status === 'success').map(x => ({...x,output:continuation(x.output,x.modelId === item.id && item.preserve_reasoning)}));
    // 自动压缩已移到「回复完成后」，这里只带上已有摘要作为前缀。
    const summary = summaryPrefix(chat);
    const context = buildContext([...prior,turn],item,output, summary);
    const body = {model_id:item.id,input:context.input,reasoning_effort:selectedEffort(item),max_output_tokens:output};
    if (new TextEncoder().encode(JSON.stringify({action:'respond',...body})).length > MAX_REQUEST_BYTES) throw new Error('request_too_large');

    // 只有请求真正要发出时才改动历史，失败不会提前毁掉对话。
    chat.turns = kept;
    chat.turns.push(turn);
    if (!chat.title) chat.title = prompt.slice(0,60) || files[0]?.name || '';
    await persist(chat,guard); persisted = true;
    if (guard !== epoch) return;
    pending = []; $('prompt').value = ''; resetPromptHeight();
    editingTurnId = null; setEditBanner(false);
    status(context.truncated ? 'truncated' : 'sending'); render();
    const response = customModel(item) ? await customRequest(item,{input:context.input,reasoning:body.reasoning_effort ? {effort:body.reasoning_effort} : undefined,max_output_tokens:output},controller.signal) : {response:await request('respond',body,controller.signal),stream:true};
    let result;
    if (response.stream) {
      if (!response.response.body || !response.response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('request');
      turn.quotaLimited = !customModel(item) && response.response.headers.get('x-chat-quota-limited') === 'true';
      result = await readResponses(response.response.body, value => {
        if (guard !== epoch || run !== active) return;
        turn.text = value.text; turn.output = value.output; turn.usage = value.usage;
        if (value.status !== 'interrupted') turn.status = value.status;
        renderMessages();
        if (Date.now() - saveAt > 1000) {
          saveAt = Date.now(); const snapshot = structuredClone(chat);
          saveQueue = saveQueue.then(() => chatStore.save(snapshot)).catch(() => { storageError = true; controller.abort(); });
        }
      }, response.protocol);
    } else result = response.result;
    if (guard === epoch) Object.assign(turn,{...result,status:result.status});
  } catch (error) {
    if (turn) turn.status = run.stopped ? 'cancelled' : controller.signal.aborted ? 'interrupted' : 'failure';
    failureKey = storageError ? 'storage' : ['context','request_too_large','file','pdf','busy','storage','quota','blacklisted','customKey','claude_thinking','claude_thinking_budget','claude_effort'].includes(error.message) ? error.message : run.stopped ? 'cancelled' : 'request';
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
    // 回复结束后再判断是否需要压缩：此时用量才包含这一轮的完整回答。
    if (guard === epoch && persisted && turn?.status === 'success') await autoCompact(chat, item, guard);
  }
}

/**
 * 回复完成后的自动压缩。压缩期间锁定输入（compacting 计入 busy），
 * 完成或失败后都会解锁，并保留一条可读的状态提示。
 */
async function autoCompact(chat, item, guard) {
  if (compacting || active) return;
  const output = item.default_max_output_tokens;
  if (!needsCompaction(chat, item, output)) return;
  compacting = true;
  controls();
  status('compacting');
  try {
    const prefix = await ensureContextSummary(chat, item, output, guard, true);
    if (guard !== epoch) return;
    // 摘要前缀只有 1 项，判断成功要看是否真的产出了摘要文本。
    status(chat.summary?.text ? 'compacted' : 'compactSkipped');
  } catch (error) {
    if (guard === epoch) status(error?.message === 'busy' ? 'busy' : 'compactFailed');
  } finally {
    compacting = false;
    if (guard === epoch) { render(); }
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
  session = next; models = []; customModels = []; customBusy = false; memberName = ''; clearCustomKeys(); customForm(null); customStatus(); chats = []; current = null; pending = []; $('prompt').value = ''; $('workspace').hidden = true;
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
    let saved, custom;
    try { saved = await chatStore.list(next.user.id); } catch { throw new Error('storage'); }
    custom = await loadCustomModels(token, controller.signal);
    if (guard !== epoch) return;
    customModels = custom || []; models = mergeModels(data.models || [], customModels); chats = saved;
    memberName = data.member_name || '';
    for (const chat of chats) for (const turn of chat.turns) if (turn.status === 'running') { turn.status = 'interrupted'; await persist(chat,guard); }
    if (guard !== epoch) return;
    for (const item of models) $('model').add(new Option(item.display_name,item.id));
    configureModel(); gateKey = models.length ? '' : 'noModels'; status('ready');
    current = chats[0] || null; if (!current) newChat();
    $('workspace').hidden = false;
    setSidebarOpen(!globalThis.matchMedia?.('(max-width: 760px)').matches);
    render();
  } catch (error) { if (guard === epoch) { catalogController = null; gateKey = ['storage','profile','login','blacklisted','quota'].includes(error.message) ? error.message : 'request'; render(); } }
}

/* ---------- 输入框自适应高度 ---------- */
function resetPromptHeight() {
  const node = $('prompt');
  if (!node?.style) return;
  node.style.height = 'auto';
  node.style.height = `${Math.min(node.scrollHeight || 0, Math.round(globalThis.innerHeight * .34))}px`;
}

/* ---------- 滚动 ---------- */
function updateScrollButton() {
  const box = $('messages'), buttonNode = $('scrollBottom');
  if (!box || !buttonNode) return;
  const distance = box.scrollHeight - box.scrollTop - box.clientHeight;
  buttonNode.hidden = !(distance > 160);
}

/* ---------- 事件绑定 ---------- */
$('composer').onsubmit = event => { event.preventDefault(); void generate(); };
$('sidebarToggle').onclick = () => setSidebarOpen(!$('workspace').classList.contains('sidebar-open'));
$('sidebarClose').onclick = () => setSidebarOpen(false);
$('sidebarBackdrop').onclick = () => setSidebarOpen(false);
$('settingsToggle').onclick = () => setSettingsOpen($('chatSettings').hidden || !$('chatSettings').classList.contains('is-open'));
$('settingsClose').onclick = () => setSettingsOpen(false);
$('settingsBackdrop').onclick = () => setSettingsOpen(false);
$('chatSearch').oninput = () => renderList();
$('prompt').oninput = () => resetPromptHeight();
$('prompt').onkeydown = event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); void generate(); } };
$('stop').onclick = () => { if (active) { active.stopped = true; active.controller.abort(); } };
$('retry').onclick = () => { const last = current?.turns.at(-1); if (last) regenerate(last.id); };
$('new').onclick = () => { newChat(); closeSidebarOnMobile(); };
$('scrollBottom').onclick = () => { const box = $('messages'); box.scrollTo?.({top:box.scrollHeight, behavior:'smooth'}); if (!box.scrollTo) box.scrollTop = box.scrollHeight; };
$('messages').addEventListener?.('scroll', updateScrollButton, {passive:true});
$('model').onchange = () => { syncModelTrigger(); configureModel(); customForm(); customStatus(); };
$('effort').onchange = () => syncEffortPicker();
$('effortTrigger').onclick = () => setEffortMenuOpen($('effortMenu').hidden);
$('editCancel').onclick = () => cancelEdit();
$('compactNow').onclick = () => void compactNow();
$('modelTrigger').onclick = () => setModelMenuOpen($('modelMenu').hidden, true);
$('modelTrigger').onkeydown = event => {
  if (['ArrowDown','ArrowUp'].includes(event.key)) { event.preventDefault(); setModelMenuOpen(true, true); }
};
$('modelMenu').onkeydown = event => {
  if (event.key === 'ArrowDown') { event.preventDefault(); moveModelMenuFocus(1); }
  else if (event.key === 'ArrowUp') { event.preventDefault(); moveModelMenuFocus(-1); }
  else if (event.key === 'Escape') { event.preventDefault(); setModelMenuOpen(false); $('modelTrigger').focus?.(); }
  else if (event.key === 'Tab') setModelMenuOpen(false);
};
document.addEventListener?.('click', event => {
  const wrap = document.querySelector('.chat-model-select');
  if (wrap && !wrap.contains(event.target)) setModelMenuOpen(false);
  const effortWrap = $('effortPicker');
  if (effortWrap && !effortWrap.contains(event.target)) setEffortMenuOpen(false);
});
$('files').onchange = async () => {
  const guard = epoch, selected = [...$('files').files], item = model(); $('files').value = '';
  if (!item || isBusy()) return;
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
$('themeToggle').onclick = () => {
  if (!window.ClubTheme) return;
  const next = window.ClubTheme.getTheme() === 'light' ? 'dark' : 'light';
  window.ClubTheme.setMode(next, {persist:true, syncRemote:true});
};
$('customModelForm').onsubmit = saveCustomModel;
$('openCustomModel').onclick = () => { setSettingsOpen(true); const panel = $('customModelPanel'); if (panel) panel.open = true; panel?.scrollIntoView?.({behavior:'smooth',block:'nearest'}); $('customModelName').focus?.(); };
$('customDelete').onclick = () => void deleteCustomModel();
$('customClearKey').onclick = () => { const id = $('customModelId').value; if (id) customKeys.delete(id); $('customApiKey').value = ''; customStatus('customKeyCleared'); };

/* 手动压缩：强制生成一次摘要，立即回写用量。与自动压缩共用锁定与提示。 */
async function compactNow() {
  if (isBusy() || !current || !model()) return;
  const chat = current, item = model(), guard = epoch;
  compacting = true; controls(); status('compacting');
  try {
    const prefix = await ensureContextSummary(chat, item, item.default_max_output_tokens, guard, true);
    if (guard !== epoch) return;
    // 摘要前缀只有 1 项，判断成功要看是否真的产出了摘要文本。
    status(chat.summary?.text ? 'compacted' : 'compactSkipped');
  } catch (error) {
    if (guard === epoch) status(error?.message === 'busy' ? 'busy' : 'compactFailed');
  } finally {
    compacting = false;
    if (guard === epoch) render();
  }
}

document.addEventListener?.('keydown', event => {
  if (event.key !== 'Escape') return;
  if (!($('modelMenu')?.hidden)) { setModelMenuOpen(false); $('modelTrigger')?.focus?.(); return; }
  if (!($('effortMenu')?.hidden)) { setEffortMenuOpen(false); $('effortTrigger')?.focus?.(); return; }
  if (editingTurnId !== null) { cancelEdit(); return; }
  if (!($('chatSettings')?.hidden)) { setSettingsOpen(false); return; }
  if (active) { active.stopped = true; active.controller.abort(); return; }
  if (globalThis.matchMedia?.('(max-width: 760px)').matches) setSidebarOpen(false);
});

window.addEventListener('pagehide', clearCustomKeys);
function refreshLocalizedUi() {
  const selected = $('model').value;
  models = mergeModels(models.filter(item => !customModel(item)), customModels);
  $('model').replaceChildren(...models.map(item => new Option(item.display_name,item.id)));
  if (models.some(item => item.id === selected)) $('model').value = selected;
  render(); customStatus(customStatusKey, customStatusVars);
}
window.addEventListener('club:langchange', refreshLocalizedUi); setTimeout(refreshLocalizedUi,0);
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
