export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_REQUEST_BYTES = 12 * 1024 * 1024;
export const MAX_ATTACHMENTS = 4;
const IMAGE_TOKEN_ESTIMATE = {low:1024,auto:4096,high:8192};
const PDF_TOKEN_ESTIMATE = 8192;

// Accept only site HTML pages, without traversal, external URLs or script schemes.
export function assistantSourcePath(value) {
  if (typeof value !== 'string' || value.length > 512 || /[\\\s\u0000-\u001f]/.test(value)) return '';
  let decoded;
  try { decoded = decodeURIComponent(value); } catch { return ''; }
  if (decoded !== value || value.startsWith('//') || !/^\/?(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.html(?:#[A-Za-z0-9_-]+)?$/.test(value)) return '';
  return value.replace(/^\//, '');
}
export function assistantSources(header) {
  if (typeof header !== 'string' || header.length > 12 * 1024) return [];
  try {
    const data = JSON.parse(decodeURIComponent(header));
    if (!Array.isArray(data)) return [];
    const seen = new Set();
    return data.slice(0, 100).flatMap(item => {
      const path = assistantSourcePath(item?.source_path);
      if (!path || !/^S[1-9]\d{0,3}$/.test(item?.id) || seen.has(item.id) || typeof item.title !== 'string') return [];
      const source = {id:item.id,slug:String(item.slug || '').slice(0,160),title:item.title.slice(0,300),category:String(item.category || '').slice(0,100),source_path:path,language:String(item.language || '').slice(0,20),excerpt:String(item.excerpt || '').slice(0,2000)};
      if (item.type === 'live') {
        if (typeof item.fetched_at !== 'string' || item.fetched_at.length > 40 || !Number.isFinite(Date.parse(item.fetched_at)) || typeof item.dataset !== 'string' || !/^[a-z][a-z0-9_-]{0,79}$/.test(item.dataset) || !Number.isInteger(item.limit) || item.limit < 0 || item.limit > 100 || typeof item.truncated !== 'boolean') return [];
        const status = ['success','empty','unavailable','paused','ambiguous'].includes(item.status) ? item.status : '';
        Object.assign(source, {type:'live',fetched_at:item.fetched_at,dataset:item.dataset,limit:item.limit,truncated:item.truncated,status});
        if (item.query !== undefined) {
          const query = item.query;
          if (!query || typeof query !== 'object' || Array.isArray(query) || Object.keys(query).length !== 4 ||
            Object.keys(query).some(key => !['order_by','direction','page','page_size'].includes(key)) ||
            typeof query.order_by !== 'string' || !/^[a-z][a-z0-9_]{0,39}$/.test(query.order_by) || !['asc','desc'].includes(query.direction) ||
            !Number.isInteger(query.page) || query.page < 1 || query.page > 100 || !Number.isInteger(query.page_size) || query.page_size < 1 || query.page_size > 50) return [];
          source.query = {order_by:query.order_by,direction:query.direction,page:query.page,page_size:query.page_size};
        }
        if (item.returned_count !== undefined) {
          if (!Number.isInteger(item.returned_count) || item.returned_count < 0 || item.returned_count > 50) return [];
          source.returned_count = item.returned_count;
        }
        if (item.has_more !== undefined) {
          if (item.has_more !== null && typeof item.has_more !== 'boolean') return [];
          source.has_more = item.has_more;
        }
        if (item.metric !== undefined) {
          if (typeof item.metric !== 'string' || item.metric.length > 120) return [];
          source.metric = item.metric;
        }
      }
      seen.add(item.id);
      return [source];
    });
  } catch { return []; }
}
export function citedAssistantSources(text, sources) {
  const cited = new Set([...String(text || '').matchAll(/\[(S[1-9]\d{0,3})\]/g)].map(match => match[1]));
  return (Array.isArray(sources) ? sources : []).filter(source => cited.has(source.id) && assistantSourcePath(source.source_path));
}

export function estimateTokens(value) {
  let tokens = 0;
  for (const item of value || []) {
    if (item.type === 'reasoning') {
      tokens += Math.ceil(new TextEncoder().encode(item.encrypted_content || '').length / 3);
      continue;
    }
    for (const part of item.content || []) {
      if (part.type === 'input_text' || part.type === 'output_text') tokens += Math.ceil(new TextEncoder().encode(part.text || '').length / 3);
      else if (part.type === 'input_image') tokens += IMAGE_TOKEN_ESTIMATE[part.detail] || IMAGE_TOKEN_ESTIMATE.auto;
      else if (part.type === 'input_file') tokens += PDF_TOKEN_ESTIMATE;
    }
  }
  return tokens;
}

/**
 * 把历史轮次裁剪进模型上下文预算。
 * prefix 是压缩摘要等「永远保留」的输入项：它们不参与从旧到新的丢弃，
 * 但必须先占用预算，否则摘要会把最后一轮挤出上下文。
 */
export function buildContext(turns, model, outputTokens, prefix = [], reserveTokens = 0) {
  const budget = model.context_window - outputTokens - Math.max(0, Number(reserveTokens) || 0);
  if (budget <= 0) throw new Error('context');
  const prefixItems = prefix || [];
  const prefixTokens = estimateTokens(prefixItems);
  const prefixBytes = new TextEncoder().encode(JSON.stringify(prefixItems)).length;
  if (prefixBytes > MAX_REQUEST_BYTES - 4096 || prefixTokens >= budget) throw new Error('context');
  const groups = turns.map(turn => turn.input.concat(turn.status === 'success' ? turn.output || [] : []));
  const selected = [];
  let truncated = false;
  for (let i = groups.length - 1; i >= 0; i--) {
    const next = groups[i].concat(selected.flat());
    const bytes = prefixBytes + new TextEncoder().encode(JSON.stringify(next)).length;
    if (bytes > MAX_REQUEST_BYTES - 4096) {
      if (i === groups.length - 1) throw new Error('request_too_large');
      truncated = true;
      break;
    }
    if (prefixTokens + estimateTokens(next) > budget) {
      if (i === groups.length - 1) throw new Error('context');
      truncated = true;
      break;
    }
    selected.unshift(groups[i]);
  }
  return {input: [...prefixItems, ...selected.flat()], truncated};
}

// The URL is the protocol setting; no extra profile/schema field is needed.
export function chatEndpoint(value, custom = false) {
  const url = new globalThis.URL(value);
  const path = url.pathname.replace(/\/+$/, '');
  let protocol = 'responses', endpoint = path;
  if (/\/messages?$/i.test(path)) {
    protocol = 'messages'; endpoint = path.replace(/messages?$/i, 'messages');
  } else if (/\/chat\/completions$/i.test(path)) protocol = 'chat_completions';
  else if (!/\/responses$/i.test(path)) endpoint += custom && !/\/v1$/i.test(path) ? '/v1/responses' : '/responses';
  url.pathname = endpoint;
  return {url:url.href, protocol};
}

/* ---------- AI 聊天归档（仅本地与 club-drive 之间的后台传输，不进入界面） ---------- */
export const CHAT_ARCHIVE_SCHEMA = 'club-ai-chat-archive/1';
export const CHAT_ARCHIVE_PART_BYTES = 6 * 1024 * 1024;
const ARCHIVE_EXTENSIONS = new Set(['png','jpg','jpeg','webp','pdf','txt','md','csv','js','ts','jsx','tsx','py','json','html','css','c','cpp','h','java','rs','go','sql','yaml','yml','xml','sh','log']);

function archiveBytes(value) { return new TextEncoder().encode(JSON.stringify(value)).length; }
function archiveIso(value) {
  const date = new Date(Number.isFinite(value) ? value : Date.now());
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}
function archiveBeijing(value) {
  const date = new Date(Number.isFinite(value) ? value : Date.now());
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const pad = (part, width = 2) => String(part).padStart(width, '0');
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}+08:00`;
}
export function archiveTimestamp(value = Date.now()) {
  return {utc: archiveIso(value), beijing: archiveBeijing(value), epoch_ms: Number.isFinite(value) ? value : Date.now()};
}
export function archiveExtension(name, kind, hasBinary = true) {
  const ext = String(name || '').split('.').pop().toLowerCase();
  // 原始文件字节优先；只有文本转写没有原文件时才把 .pdf 改存为 .txt。
  if (kind === 'text' && !hasBinary && ext === 'pdf') return 'txt';
  if (/^[a-z0-9]{1,12}$/.test(ext) && ARCHIVE_EXTENSIONS.has(ext)) return ext;
  if (kind === 'image') return 'png';
  if (kind === 'pdf') return 'pdf';
  return 'bin';
}
export function archiveDataUrlBytes(value) {
  if (typeof value !== 'string') return null;
  const comma = value.indexOf(',');
  if (comma < 0 || !/;base64$/i.test(value.slice(0, comma))) return null;
  try {
    const binary = globalThis.atob(value.slice(comma + 1).replace(/\s+/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch { return null; }
}
export async function archiveAttachmentBytes(attachment) {
  if (!attachment || typeof attachment !== 'object') return null;
  try {
    if (attachment.blob && typeof attachment.blob.arrayBuffer === 'function') {
      const buffer = await attachment.blob.arrayBuffer();
      if (buffer.byteLength) return new Uint8Array(buffer);
    }
  } catch { /* 退回已解析的 data/text 副本 */ }
  const data = archiveDataUrlBytes(attachment.data);
  if (data?.length) return data;
  if (typeof attachment.text === 'string' && attachment.text.length) return new TextEncoder().encode(attachment.text);
  return null;
}
export async function archiveSha256(bytes) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function archiveParts(content, attachments = []) {
  if (!Array.isArray(content)) return [];
  return content.flatMap(part => {
    if (!part || typeof part !== 'object') return [];
    if (part.type === 'input_text' || part.type === 'output_text' || part.type === 'text') {
      if (typeof part.text !== 'string') return [];
      // 附件正文已按原文件另存；转写里只留引用，避免每轮重复上传数 MB 文本。
      const embedded = /^\n?--- Attachment: ([\s\S]*?) ---\n([\s\S]*)\n--- End attachment ---\n?$/.exec(part.text);
      if (embedded) {
        const file = attachments.find(item => item.name === embedded[1]);
        return [{
          type: 'attachment_text', name: embedded[1],
          sha256: file?.sha256 || '', archived: Boolean(file?.sha256 && file.archived),
          characters: embedded[2].length
        }];
      }
      return [{type: part.type, text: part.text}];
    }
    if (part.type === 'reasoning' && typeof part.encrypted_content === 'string') return [{type: 'reasoning', encrypted_content: part.encrypted_content}];
    if (part.type === 'input_image') return [{type: 'input_image', detail: part.detail || 'auto', archived: part.archived || null}];
    if (part.type === 'input_file') return [{type: 'input_file', filename: part.filename || '', archived: part.archived || null}];
    return [];
  });
}
function archiveTurn(turn, refs) {
  const attachments = Array.isArray(turn.attachments) ? turn.attachments.map(file => {
    const ref = refs?.get(file) || {};
    const sha256 = String(file.sha256 || ref.sha256 || '');
    return {
      name: String(file.name || ''), size: Number(file.size) || 0, type: String(file.type || ''), kind: String(file.kind || ''),
      sha256, extension: String(file.archiveExt || ref.extension || archiveExtension(file.name, file.kind, Boolean(file.blob))),
      archived: Boolean(sha256 && (file.archiveUploaded || ref.archived))
    };
  }) : [];
  const imageSha = attachments.find(file => file.kind === 'image')?.sha256 || null;
  const pdfSha = attachments.find(file => file.kind === 'pdf')?.sha256 || null;
  return {
    id: String(turn.id || ''),
    created_at: archiveIso(turn.createdAt),
    created_at_beijing: archiveBeijing(turn.createdAt),
    status: String(turn.status || ''),
    model_id: String(turn.modelId || ''),
    model_name: String(turn.modelName || ''),
    prompt: String(turn.prompt || ''),
    text: String(turn.text || ''),
    thinking: String(turn.thinking || ''),
    attachments,
    input: Array.isArray(turn.input) ? turn.input.map(item => ({
      ...item,
      content: archiveParts(item?.content, attachments).map(part => part.type === 'input_image'
        ? {...part, archived: part.archived || imageSha}
        : part.type === 'input_file' ? {...part, archived: part.archived || pdfSha} : part)
    })) : [],
    output: Array.isArray(turn.output) ? turn.output.map(item => ({
      ...item,
      content: item?.content === undefined ? undefined : archiveParts(item.content)
    })) : [],
    usage: turn.usage && typeof turn.usage === 'object' ? turn.usage : null,
    quota_limited: Boolean(turn.quotaLimited),
    release_id: String(turn.releaseId || ''),
    sources: Array.isArray(turn.sources) ? turn.sources : []
  };
}
export function archiveConversation(chat, refs) {
  const turns = Array.isArray(chat.turns) ? chat.turns.map(turn => archiveTurn(turn, refs)) : [];
  return {
    store: chat.store === 'assistant' ? 'assistant' : 'chat',
    id: String(chat.id || ''),
    title: String(chat.title || ''),
    created_at: archiveIso(chat.createdAt || chat.updatedAt),
    updated_at: archiveIso(chat.updatedAt),
    updated_at_beijing: archiveBeijing(chat.updatedAt),
    summary: chat.summary && typeof chat.summary === 'object'
      ? {text: String(chat.summary.text || ''), created_at: archiveIso(chat.summary.createdAt), turns: Number(chat.summary.turns) || 0}
      : null,
    turns,
    turn_count: turns.length
  };
}
function archiveUnits(conversations, target) {
  const units = [];
  for (const conversation of conversations) {
    if (archiveBytes(conversation) <= target) { units.push(conversation); continue; }
    const base = {...conversation, turns: []};
    let turns = [], size = archiveBytes(base), fragment = 1;
    const flush = () => { if (turns.length) { units.push({...base, turn_count: turns.length, fragment: fragment++, turns}); turns = []; size = archiveBytes(base); } };
    for (const turn of conversation.turns) {
      const turnBytes = archiveBytes(turn);
      if (turns.length && size + turnBytes > target) flush();
      turns.push(turn); size += turnBytes;
      if (size > target) flush();
    }
    flush();
  }
  return units;
}
/**
 * 把一次完整本地状态切成若干可独立上传的 JSON 分片。
 * 分片只按大小切分，所有分片合起来仍是该用户当时的全部会话；
 * 会话按更新时间从新到旧排列，轮次保持原始先后顺序。
 */
export function buildChatArchive({userId, source, trigger, conversations, pending = [], refs, now = Date.now(), target = CHAT_ARCHIVE_PART_BYTES}) {
  const ordered = [...conversations].sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0)).map(chat => archiveConversation(chat, refs));
  const pendingFiles = pending.map(file => {
    const ref = refs?.get(file) || {};
    const sha256 = String(file.sha256 || ref.sha256 || '');
    return {name: String(file.name || ''), size: Number(file.size) || 0, type: String(file.type || ''), kind: String(file.kind || ''), sha256, extension: String(file.archiveExt || ref.extension || archiveExtension(file.name, file.kind, Boolean(file.blob))), archived: Boolean(sha256 && (file.archiveUploaded || ref.archived))};
  });
  const base = {
    schema: CHAT_ARCHIVE_SCHEMA,
    user_id: String(userId || ''),
    source,
    trigger,
    uploaded_at: archiveIso(now),
    uploaded_at_beijing: archiveBeijing(now),
    timezone: 'Asia/Shanghai',
    conversation_count: ordered.length,
    turn_count: ordered.reduce((sum, chat) => sum + chat.turns.length, 0),
    pending_attachments: pendingFiles
  };
  const limit = Math.max(512 * 1024, Math.min(Number(target) || CHAT_ARCHIVE_PART_BYTES, CHAT_ARCHIVE_PART_BYTES));
  const units = archiveUnits(ordered, limit);
  const overhead = archiveBytes({...base, conversations: [], part: {index: 9999, total: 9999}});
  const parts = [];
  let current = [], size = 0;
  for (const unit of units) {
    const unitBytes = archiveBytes(unit);
    if (current.length && overhead + size + unitBytes > limit) { parts.push(current); current = []; size = 0; }
    current.push(unit); size += unitBytes;
  }
  if (current.length || !parts.length) parts.push(current);
  return parts.map((items, index) => ({
    ...base,
    part: {index: index + 1, total: parts.length},
    conversations: items
  }));
}

export function nativeRequest(body, protocol) {
  if (protocol === 'responses') return {...body, stream:true};
  if (!['messages','chat_completions'].includes(protocol)) throw new Error('request');
  const messages = [], system = [];
  const input = typeof body.input === 'string' ? [{role:'user',content:body.input}] : body.input;
  if (!Array.isArray(input)) throw new Error('request');
  const items = body.instructions ? [{role:'system',content:body.instructions}, ...input] : input;
  for (const item of items) {
    // Responses encrypted state cannot be replayed as Claude thinking or chat reasoning.
    if (item.type === 'reasoning' || item.encrypted_content || !['user','assistant','system','developer'].includes(item.role) || (item.type && item.type !== 'message')) throw new Error('request');
    const parts = typeof item.content === 'string' ? [{type:'input_text',text:item.content}] : item.content;
    if (!Array.isArray(parts)) throw new Error('request');
    const content = parts.map(part => {
      if (['input_text','output_text'].includes(part.type) && typeof part.text === 'string') return {type:'text',text:part.text};
      if (item.role !== 'user') throw new Error('file');
      if (part.type === 'input_image') {
        if (protocol === 'chat_completions') return {type:'image_url',image_url:{url:part.image_url,detail:part.detail || 'auto'}};
        const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(part.image_url);
        if (!match) throw new Error('file');
        return {type:'image',source:{type:'base64',media_type:match[1],data:match[2]}};
      }
      if (part.type === 'input_file') {
        const match = /^data:application\/pdf;base64,([A-Za-z0-9+/]+={0,2})$/.exec(part.file_data);
        if (!match) throw new Error('pdf');
        return protocol === 'messages' ? {type:'document',source:{type:'base64',media_type:'application/pdf',data:match[1]}} : {type:'file',file:{filename:part.filename || 'document.pdf',file_data:part.file_data}};
      }
      throw new Error('request');
    });
    if (protocol === 'messages' && ['system','developer'].includes(item.role)) system.push(...content);
    else {
      const role = protocol === 'messages' ? item.role : item.role === 'developer' ? 'system' : item.role;
      const previous = messages.at(-1);
      if (protocol === 'messages' && previous?.role === role) previous.content.push(...content);
      else messages.push({role,content});
    }
  }
  const result = {model:body.model,messages,stream:true};
  if (protocol === 'messages') {
    result.max_tokens = body.max_output_tokens;
    if (system.length) result.system = system;
    // Vendor-specific thinking knobs have no safe generic mapping from Responses effort.
    if (body.reasoning?.effort && body.reasoning.effort !== 'none') throw new Error('request');
  } else {
    result.max_completion_tokens = body.max_output_tokens;
    result.stream_options = {include_usage:true};
    if (body.reasoning?.effort) result.reasoning_effort = body.reasoning.effort;
  }
  return result;
}

// Only a leading, explicit, unambiguous block is a compatibility thinking channel.
// Keep uncertain prefixes buffered while streaming; completed unmatched markup is literal.
function leadingThinking(text, complete = true) {
  const literal = {text,thinking:'',removed:0};
  const prefix = /^(\s*)/.exec(text)[0];
  if (/(?:^|\n)(?: {4}|[^\S\n]*\t)/.test(prefix)) return literal; // Markdown indented code
  const rest = text.slice(prefix.length), open = '<think>', close = '</think>';
  if (!complete && rest && open.startsWith(rest)) return {text:'',thinking:'',removed:text.length};
  if (!rest.startsWith(open)) return literal;
  const end = rest.indexOf(close, open.length);
  const body = rest.slice(open.length, end < 0 ? undefined : end);
  // Code, quoted/escaped tag examples, nested tags and repeated delimiters are ambiguous.
  if (body.includes('<think>') || /[`\\]/.test(body) || /["'“‘]\s*$/.test(body)) return literal;
  if (end < 0) {
    if (complete) return literal;
    let pending = body;
    for (let size = Math.min(close.length - 1, pending.length); size > 0; size--) {
      if (close.startsWith(pending.slice(-size))) { pending = pending.slice(0, -size); break; }
    }
    return {text:'',thinking:pending,removed:text.length};
  }
  const answer = rest.slice(end + close.length);
  if (answer.includes('<think>') || answer.includes(close)) return literal;
  return {text:answer,thinking:body,removed:prefix.length + end + close.length};
}

function answerText(output) {
  return (output || []).filter(item => item.type === 'message' && item.role === 'assistant')
    .flatMap(item => item.content || []).filter(part => part.type === 'output_text' && typeof part.text === 'string').map(part => part.text).join('');
}
function summaryText(output) {
  return (output || []).filter(item => item.type === 'reasoning').flatMap(item => item.summary || [])
    .filter(part => part.type === 'summary_text' && typeof part.text === 'string').map(part => part.text).filter(Boolean).join('\n\n');
}
function combineThinking(provider, tagged) {
  return provider && tagged && provider !== tagged ? provider + '\n\n' + tagged : provider || tagged;
}

/** Read provider-exposed summaries from saved normalized output. Never inspect opaque state. */
export function thinkingText(output) {
  return combineThinking(summaryText(output), leadingThinking(answerText(output)).thinking);
}
export const readableThinking = thinkingText;

function nativeOutput(text, thinking = '') {
  return [
    ...(thinking ? [{type:'reasoning',summary:[{type:'summary_text',text:thinking}]}] : []),
    ...(text ? [{type:'message',role:'assistant',content:[{type:'output_text',text,annotations:[]}]}] : [])
  ];
}
function readableOutput(output, fallback = '', complete = true) {
  const raw = answerText(output) || fallback;
  const tagged = leadingThinking(raw, complete);
  let remaining = tagged.removed;
  let clean = (output || []).map(item => item.type !== 'message' || item.role !== 'assistant' ? item : {
    ...item,content:(item.content || []).map(part => {
      if (part.type !== 'output_text' || typeof part.text !== 'string') return part;
      const count = Math.min(remaining, part.text.length); remaining -= count;
      return {...part,text:part.text.slice(count)};
    })
  });
  if (!answerText(output) && tagged.text) clean = clean.concat(nativeOutput(tagged.text));
  const provider = summaryText(output), thinking = combineThinking(provider, tagged.thinking);
  if (tagged.thinking && provider !== tagged.thinking) clean = clean.concat([{type:'reasoning',summary:[{type:'summary_text',text:tagged.thinking}]}]);
  return {text:tagged.text,thinking,output:clean};
}
function nativeStatus(reason, protocol) {
  if (['length','max_tokens','model_context_window_exceeded'].includes(reason)) return 'incomplete';
  if ((protocol === 'messages' ? ['end_turn','stop_sequence'] : ['stop']).includes(reason)) return 'success';
  return 'failure';
}
function nativeUsage(usage, protocol, previous = null) {
  if (!usage) return previous;
  const input = protocol === 'messages' ? (usage.input_tokens ?? previous?.input_tokens ?? 0) + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0) : usage.prompt_tokens || 0;
  const output = usage.output_tokens ?? usage.completion_tokens ?? previous?.output_tokens ?? 0;
  return {input_tokens:input,output_tokens:output,total_tokens:protocol === 'messages' ? input + output : usage.total_tokens ?? input + output};
}
export function normalizeChatResponse(data, protocol = 'responses') {
  if (protocol === 'responses') {
    const response = data.response || data, output = response.output || [];
    return {...readableOutput(output, response.output_text || response.text || ''),usage:response.usage || null,status:data.error || ['failed','cancelled'].includes(response.status) ? 'failure' : response.status === 'incomplete' ? 'incomplete' : 'success'};
  }
  const choice = data.choices?.find(item => item.index === 0) || data.choices?.[0];
  const text = protocol === 'messages' ? (data.content || []).filter(part => part.type === 'text' && typeof part.text === 'string').map(part => part.text).join('') : typeof choice?.message?.content === 'string' ? choice.message.content : '';
  const thinking = protocol === 'messages' ? (data.content || []).filter(part => part.type === 'thinking' && typeof part.thinking === 'string').map(part => part.thinking).filter(Boolean).join('\n\n') : chatThinking(choice?.message);
  const unsupported = protocol === 'messages' ? (data.content || []).some(part => ['tool_use','server_tool_use'].includes(part.type)) : choice?.message?.tool_calls || choice?.message?.function_call;
  return {...readableOutput(nativeOutput(text,thinking)),usage:nativeUsage(data.usage,protocol),status:data.error || unsupported ? 'failure' : nativeStatus(protocol === 'messages' ? data.stop_reason : choice?.finish_reason,protocol)};
}
function chatThinking(message) {
  return typeof message?.reasoning_content === 'string' ? message.reasoning_content : typeof message?.reasoning === 'string' ? message.reasoning : '';
}

export function createSSEParser(onEvent, onDone = () => {}) {
  let buffer = '', event = '', data = [];
  function line(value) {
    if (value === '') {
      if (data.length) {
        const raw = data.join('\n');
        if (raw === '[DONE]') onDone();
        else onEvent(JSON.parse(raw), event);
      }
      event = ''; data = [];
    } else if (!value.startsWith(':')) {
      const colon = value.indexOf(':');
      const field = colon < 0 ? value : value.slice(0, colon);
      let content = colon < 0 ? '' : value.slice(colon + 1);
      if (content.startsWith(' ')) content = content.slice(1);
      if (field === 'data') data.push(content);
      if (field === 'event') event = content;
    }
  }
  return {
    push(text, eof = false) {
      buffer += text;
      if (buffer.length > 16 * 1024 * 1024) throw new Error('stream');
      let start = 0;
      for (let i = 0; i < buffer.length; i++) {
        if (buffer[i] !== '\r' && buffer[i] !== '\n') continue;
        if (buffer[i] === '\r' && i === buffer.length - 1 && !eof) break;
        line(buffer.slice(start, i));
        if (buffer[i] === '\r' && buffer[i + 1] === '\n') i++;
        start = i + 1;
      }
      buffer = buffer.slice(start);
      if (eof && buffer) { line(buffer); buffer = ''; }
      if (eof) line('');
    }
  };
}

export async function readResponses(stream, onUpdate = () => {}, protocol = 'responses') {
  const reader = stream.getReader(), decoder = new TextDecoder();
  const result = {text:'',thinking:'',output:[],status:'interrupted',usage:null};
  let terminal = false, finishReason = null, unsupported = false;
  let rawText = '', rawThinking = '';
  // Adapter streams can give both reasoning and answer the same output_index.
  // Keep their namespaces separate until final output establishes canonical order.
  const blocks = new Map(), items = new Map(), messages = new Map();
  const ordered = map => [...map.entries()].sort((a,b) => a[0] - b[0]).map(([,value]) => value);
  function itemIndex(event, map = items) {
    if (Number.isInteger(event.output_index)) return event.output_index;
    const id = event.item_id || event.item?.id;
    for (const [index,item] of map) if (id && item.id === id) return index;
    return id ? map.size : 0;
  }
  function mergeItem(index, incoming, map = items) {
    if (!incoming) return;
    const previous = map.get(index) || {}, next = {...previous,...incoming};
    for (const field of ['summary','content']) {
      if (!previous[field] && !incoming[field]) continue;
      next[field] = (previous[field] || []).slice();
      for (const [i,part] of (incoming[field] || []).entries()) {
        next[field][i] = {...next[field][i],...part};
        // Empty final placeholders must not erase readable partial summaries.
        if (!part.text && previous[field]?.[i]?.text) next[field][i].text = previous[field][i].text;
      }
    }
    map.set(index,next);
  }
  function reconcile(finalOutput) {
    for (const [map,isMessage] of [[items,false],[messages,true]]) {
      const previous = new Map(map), used = new Set();
      map.clear();
      const finals = finalOutput.map((item,index) => [index,item]).filter(([,item]) => (item.type === 'message') === isMessage);
      for (const [index,item] of finals) {
        const compatible = ([key,old]) => !used.has(key) && old.type === item.type && (!item.id || !old.id || old.id === item.id);
        const candidates = [...previous].filter(compatible);
        const match = candidates.find(([,old]) => item.id && old.id === item.id) || candidates.find(([key]) => key === index) || candidates[0];
        if (match) { used.add(match[0]); map.set(index,match[1]); }
        mergeItem(index,item,map);
      }
      // A shortened/absent final output must not discard previously exposed partials.
      let index = finalOutput.length;
      for (const [key,item] of previous) if (!used.has(key)) {
        while (map.has(index)) index++;
        map.set(index++,item);
      }
    }
  }
  function publish(complete = terminal) {
    const output = protocol === 'responses' ? [...items,...messages].sort((a,b) => a[0] - b[0]).map(([,item]) => item) : nativeOutput(rawText,rawThinking);
    Object.assign(result,readableOutput(output,protocol === 'responses' ? rawText : '',complete));
    onUpdate({...result});
  }
  function finishNative() {
    result.status = unsupported ? 'failure' : nativeStatus(finishReason, protocol);
    terminal = true; publish();
  }
  function putBlock(index, block) {
    blocks.set(index, {...block});
    if (['tool_use','server_tool_use'].includes(block.type)) unsupported = true;
  }
  const parser = createSSEParser((event, eventName) => {
    if (terminal) return;
    const type = event.type || eventName;
    if (protocol !== 'responses') {
      if (type === 'error' || event.error) { result.status = 'failure'; terminal = true; }
      else if (protocol === 'messages') {
        if (type === 'message_start') {
          result.usage = nativeUsage(event.message?.usage, protocol, result.usage);
          for (const [index,block] of (event.message?.content || []).entries()) putBlock(index,block);
        } else if (type === 'content_block_start') putBlock(event.index,event.content_block || {});
        else if (type === 'content_block_delta') {
          const delta = event.delta || {}, previous = blocks.get(event.index);
          if (delta.type === 'text_delta') putBlock(event.index,{...previous,type:'text',text:(previous?.text || '') + (delta.text || '')});
          if (delta.type === 'thinking_delta' && (!previous || previous.type === 'thinking')) putBlock(event.index,{type:'thinking',thinking:(typeof previous?.thinking === 'string' ? previous.thinking : '') + (typeof delta.thinking === 'string' ? delta.thinking : '')});
        } else if (type === 'message_delta') {
          finishReason = event.delta?.stop_reason || finishReason;
          result.usage = nativeUsage(event.usage, protocol, result.usage);
        } else if (type === 'message_stop') { finishNative(); return; }
        rawText = ordered(blocks).filter(block => block.type === 'text').map(block => block.text || '').join('');
        rawThinking = ordered(blocks).filter(block => block.type === 'thinking' && typeof block.thinking === 'string').map(block => block.thinking).filter(Boolean).join('\n\n');
      } else {
        const choice = event.choices?.find(item => item.index === 0);
        if (typeof choice?.delta?.content === 'string') rawText += choice.delta.content;
        rawThinking += chatThinking(choice?.delta);
        if (choice?.message) {
          if (typeof choice.message.content === 'string' && choice.message.content) rawText = choice.message.content;
          if (chatThinking(choice.message)) rawThinking = chatThinking(choice.message);
        }
        if (choice?.delta?.tool_calls || choice?.delta?.function_call || choice?.message?.tool_calls || choice?.message?.function_call) unsupported = true;
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        result.usage = nativeUsage(event.usage, protocol, result.usage);
      }
      publish(); return;
    }
    if (['response.output_item.added','response.output_item.done'].includes(type)) {
      const map = event.item?.type === 'message' ? messages : items;
      mergeItem(itemIndex(event,map),event.item,map);
    }
    else if (['response.reasoning_summary_text.delta','response.reasoning_summary_text.done','response.reasoning_summary_part.added','response.reasoning_summary_part.done'].includes(type)) {
      const index = itemIndex(event), previous = items.get(index) || {type:'reasoning',id:event.item_id};
      const summary = (previous.summary || []).slice(), partIndex = event.summary_index ?? 0;
      const old = summary[partIndex]?.text || '';
      if (type.endsWith('.delta')) summary[partIndex] = {type:'summary_text',text:old + (typeof event.delta === 'string' ? event.delta : '')};
      else {
        const part = event.part || {type:'summary_text',text:event.text};
        if (part.type === 'summary_text') summary[partIndex] = {type:'summary_text',text:typeof part.text === 'string' && part.text ? part.text : old};
      }
      items.set(index,{...previous,summary});
    } else if (type === 'response.output_text.delta' || type === 'response.output_text.done') {
      if (Number.isInteger(event.output_index) || event.item_id) {
        const index = itemIndex(event,messages), previous = messages.get(index) || {type:'message',role:'assistant',id:event.item_id};
        const content = (previous.content || []).slice(), partIndex = event.content_index ?? 0;
        content[partIndex] = {type:'output_text',text:type.endsWith('.delta') ? (content[partIndex]?.text || '') + (event.delta || '') : event.text || content[partIndex]?.text || ''};
        messages.set(index,{...previous,content});
      } else if (type.endsWith('.delta')) rawText += event.delta || '';
      else if (typeof event.text === 'string') rawText = event.text;
    }
    if (['response.completed','response.incomplete','response.failed','error'].includes(type)) {
      terminal = true;
      result.status = type === 'response.completed' ? 'success' : type === 'response.incomplete' ? 'incomplete' : 'failure';
      reconcile(event.response?.output || []);
      if (event.response?.output_text || event.response?.text) rawText = event.response.output_text || event.response.text;
      result.usage = event.response?.usage || result.usage;
    }
    publish();
  }, () => { if (!terminal && protocol === 'chat_completions' && finishReason) finishNative(); });
  try {
    while (true) {
      const {value, done} = await reader.read();
      parser.push(done ? decoder.decode() : decoder.decode(value, {stream:true}), done);
      if (done || terminal) break;
    }
    if (!terminal && protocol === 'chat_completions' && finishReason) finishNative();
    if (terminal) await reader.cancel().catch(() => {});
    return result;
  } finally {
    // Flush unmatched markup literally on EOF, cancellation or read error as well.
    if (!terminal) { publish(true); await reader.cancel().catch(() => {}); }
    reader.releaseLock();
  }
}

export function continuation(output, preserveReasoning) {
  return readableOutput(output || []).output.flatMap(item => {
    if (item.type === 'reasoning' && preserveReasoning && typeof item.encrypted_content === 'string') return [{type:'reasoning', encrypted_content:item.encrypted_content, summary:[]}];
    if (item.type !== 'message' || item.role !== 'assistant') return [];
    const content = (item.content || []).filter(x => x.type === 'output_text' && typeof x.text === 'string' && x.text).map(x => ({type:'output_text', text:x.text, annotations:[]}));
    return content.length ? [{type:'message', role:'assistant', content}] : [];
  });
}
