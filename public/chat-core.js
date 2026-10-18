export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_REQUEST_BYTES = 12 * 1024 * 1024;
export const MAX_ATTACHMENTS = 4;
const IMAGE_TOKEN_ESTIMATE = {low:1024,auto:4096,high:8192};
const PDF_TOKEN_ESTIMATE = 8192;

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
export function buildContext(turns, model, outputTokens, prefix = []) {
  const budget = model.context_window - outputTokens;
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

function nativeOutput(text) {
  return text ? [{type:'message',role:'assistant',content:[{type:'output_text',text,annotations:[]}]}] : [];
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
    return {text:response.output_text || response.text || output.flatMap(item => item.content || []).map(part => part.text || '').join(''),output,usage:response.usage || null,status:data.error || ['failed','cancelled'].includes(response.status) ? 'failure' : response.status === 'incomplete' ? 'incomplete' : 'success'};
  }
  const choice = data.choices?.find(item => item.index === 0) || data.choices?.[0];
  const text = protocol === 'messages' ? (data.content || []).filter(part => part.type === 'text').map(part => part.text).join('') : typeof choice?.message?.content === 'string' ? choice.message.content : '';
  const unsupported = protocol === 'messages' ? (data.content || []).some(part => ['tool_use','server_tool_use'].includes(part.type)) : choice?.message?.tool_calls || choice?.message?.function_call;
  return {text,output:nativeOutput(text),usage:nativeUsage(data.usage,protocol),status:data.error || unsupported ? 'failure' : nativeStatus(protocol === 'messages' ? data.stop_reason : choice?.finish_reason,protocol)};
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
  const result = {text:'', output:[], status:'interrupted', usage:null};
  let terminal = false, finishReason = null, unsupported = false;
  const blocks = new Map();
  function updateNative() { result.output = nativeOutput(result.text); }
  function finishNative() {
    result.status = unsupported ? 'failure' : nativeStatus(finishReason, protocol);
    terminal = true; updateNative(); onUpdate({...result});
  }
  const parser = createSSEParser((event, eventName) => {
    if (terminal) return;
    const type = event.type || eventName;
    if (protocol !== 'responses') {
      if (type === 'error' || event.error) { result.status = 'failure'; terminal = true; }
      else if (protocol === 'messages') {
        if (type === 'message_start') {
          result.usage = nativeUsage(event.message?.usage, protocol, result.usage);
          for (const [index, block] of (event.message?.content || []).entries()) {
            blocks.set(index, block.type === 'text' ? block.text || '' : '');
            if (['tool_use','server_tool_use'].includes(block.type)) unsupported = true;
          }
        } else if (type === 'content_block_start') {
          blocks.set(event.index, event.content_block?.type === 'text' ? event.content_block.text || '' : '');
          if (['tool_use','server_tool_use'].includes(event.content_block?.type)) unsupported = true;
        } else if (type === 'content_block_delta' && event.delta?.type === 'text_delta') blocks.set(event.index, (blocks.get(event.index) || '') + (event.delta.text || ''));
        else if (type === 'message_delta') {
          finishReason = event.delta?.stop_reason || finishReason;
          result.usage = nativeUsage(event.usage, protocol, result.usage);
        } else if (type === 'message_stop') { finishNative(); return; }
        result.text = [...blocks.entries()].sort((a,b) => a[0] - b[0]).map(([,text]) => text).join('');
      } else {
        const choice = event.choices?.find(item => item.index === 0);
        if (typeof choice?.delta?.content === 'string') result.text += choice.delta.content;
        if (choice?.delta?.tool_calls || choice?.delta?.function_call) unsupported = true;
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        result.usage = nativeUsage(event.usage, protocol, result.usage);
      }
      updateNative(); onUpdate({...result}); return;
    }
    if (type === 'response.output_text.delta') result.text += event.delta || '';
    if (['response.completed','response.incomplete','response.failed','error'].includes(type)) {
      terminal = true;
      result.status = type === 'response.completed' ? 'success' : type === 'response.incomplete' ? 'incomplete' : 'failure';
      result.output = event.response?.output || [];
      result.usage = event.response?.usage || null;
      const full = result.output.filter(x => x.type === 'message').flatMap(x => x.content || []).filter(x => x.type === 'output_text').map(x => x.text).join('');
      if (full) result.text = full;
    }
    onUpdate({...result});
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
    if (!terminal) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function continuation(output, preserveReasoning) {
  return (output || []).flatMap(item => {
    if (item.type === 'reasoning' && preserveReasoning && typeof item.encrypted_content === 'string') return [{type:'reasoning', encrypted_content:item.encrypted_content, summary:[]}];
    if (item.type !== 'message' || item.role !== 'assistant') return [];
    const content = (item.content || []).filter(x => x.type === 'output_text').map(x => ({type:'output_text', text:x.text, annotations:[]}));
    return content.length ? [{type:'message', role:'assistant', content}] : [];
  });
}
