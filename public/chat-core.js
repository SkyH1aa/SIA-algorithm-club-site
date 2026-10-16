export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_REQUEST_BYTES = 12 * 1024 * 1024;
export const MAX_ATTACHMENTS = 4;

export function estimateTokens(value) {
  return Math.ceil(new TextEncoder().encode(JSON.stringify(value)).length / 3);
}

export function buildContext(turns, model, outputTokens) {
  const budget = model.context_window - outputTokens;
  if (budget <= 0) throw new Error('context');
  const groups = turns.map(turn => turn.input.concat(turn.status === 'success' ? turn.output || [] : []));
  const selected = [];
  let truncated = false;
  for (let i = groups.length - 1; i >= 0; i--) {
    const next = groups[i].concat(selected.flat());
    if (estimateTokens(next) > budget || new TextEncoder().encode(JSON.stringify(next)).length > MAX_REQUEST_BYTES - 4096) {
      if (i === groups.length - 1) throw new Error('context');
      truncated = true;
      break;
    }
    selected.unshift(groups[i]);
  }
  return {input:selected.flat(), truncated};
}

export function createSSEParser(onEvent) {
  let buffer = '', event = '', data = [];
  function line(value) {
    if (value === '') {
      if (data.length) {
        const raw = data.join('\n');
        if (raw !== '[DONE]') onEvent(JSON.parse(raw), event);
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
    }
  };
}

export async function readResponses(stream, onUpdate) {
  const reader = stream.getReader(), decoder = new TextDecoder();
  const result = {text:'', output:[], status:'interrupted', usage:null};
  let terminal = false;
  const parser = createSSEParser(event => {
    if (terminal) return;
    const type = event.type;
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
  });
  try {
    while (true) {
      const {value, done} = await reader.read();
      parser.push(done ? decoder.decode() : decoder.decode(value, {stream:true}), done);
      if (done || terminal) break;
    }
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
