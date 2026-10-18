// Internal chat adapter. The browser contract remains the Responses API.
type ProtocolJson = Record<string, unknown>;
export type ChatProtocol = 'responses' | 'messages' | 'chat';
export type ChatProtocolSetting = 'auto' | ChatProtocol;
export class ChatProtocolError extends Error {
  status = 400;
  constructor(code = 'input') { super(code); this.name = 'ChatProtocolError'; }
}
export function chatEndpoint(base: string, setting: ChatProtocolSetting = 'auto'): { protocol: ChatProtocol; url: string } {
  const url = base.replace(/\/+$/, '');
  if (setting !== 'auto') {
    if (!['responses', 'messages', 'chat'].includes(setting)) throw new ChatProtocolError('api_protocol');
    // Replace only one recognized terminal endpoint; retain the provider's path.
    const root = url.replace(/\/(?:responses|messages?|chat\/completions)$/i, '');
    return { protocol: setting, url: `${root}/${setting === 'chat' ? 'chat/completions' : setting}` };
  }
  if (/\/chat\/completions$/i.test(url)) return { protocol: 'chat', url };
  if (/\/messages?$/i.test(url)) return { protocol: 'messages', url: url.replace(/\/message$/i, '/messages') };
  return { protocol: 'responses', url: /\/responses$/i.test(url) ? url : `${url}/responses` };
}
export type ClaudeThinkingConfig =
  | { mode: 'omit' | 'disabled' }
  | { mode: 'enabled'; budget_tokens: number }
  | { mode: 'adaptive'; efforts: string[]; default_effort: string | null };

// Missing legacy rows fail safe: never enable thinking from generic effort fields.
export function normalizeClaudeThinking(value: unknown = undefined, defaultMaxOutputTokens?: number, effectiveMaxTokens?: number): ClaudeThinkingConfig {
  if (value === undefined) return { mode: 'omit' };
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ChatProtocolError('claude_thinking');
  const config = value as ProtocolJson;
  const mode = config.mode;
  const keys = mode === 'enabled' ? ['mode', 'budget_tokens'] : mode === 'adaptive' ? ['mode', 'efforts', 'default_effort'] : ['mode'];
  if (typeof mode !== 'string' || !['omit', 'disabled', 'enabled', 'adaptive'].includes(mode) || Object.keys(config).some(key => !keys.includes(key))) throw new ChatProtocolError('claude_thinking');
  if (mode === 'omit' || mode === 'disabled') return { mode };
  if (mode === 'enabled') {
    const budget = config.budget_tokens;
    if (!Number.isSafeInteger(budget) || (budget as number) < 1024 ||
      [defaultMaxOutputTokens, effectiveMaxTokens].some(max => max !== undefined && (!Number.isSafeInteger(max) || (budget as number) >= max))) throw new ChatProtocolError('claude_thinking_budget');
    return { mode, budget_tokens: budget as number };
  }
  const efforts = config.efforts === undefined ? [] : config.efforts;
  const defaultEffort = config.default_effort === undefined ? null : config.default_effort;
  if (!Array.isArray(efforts) || efforts.some(effort => typeof effort !== 'string' || !['low', 'medium', 'high', 'xhigh', 'max'].includes(effort)) ||
    new Set(efforts).size !== efforts.length || (defaultEffort !== null && (typeof defaultEffort !== 'string' || !efforts.includes(defaultEffort)))) throw new ChatProtocolError('claude_thinking');
  return { mode: 'adaptive', efforts: [...efforts], default_effort: defaultEffort as string | null };
}

export function validateProtocolCapabilities(protocol: ChatProtocol, model: { preserve_reasoning: boolean; reasoning_efforts: unknown; default_max_output_tokens?: number }, claudeThinking?: unknown): void {
  const config = normalizeClaudeThinking(claudeThinking, model.default_max_output_tokens);
  if (protocol !== 'messages' && config.mode !== 'omit') throw new ChatProtocolError('claude_thinking');
  if (protocol === 'responses') return;
  if (model.preserve_reasoning) throw new ChatProtocolError('reasoning_history_unsupported');
  if (protocol === 'messages') return;
  const supported = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'];
  if (!Array.isArray(model.reasoning_efforts) || model.reasoning_efforts.some(x => !supported.includes(String(x)))) throw new ChatProtocolError('reasoning_effort_unsupported');
}
export function protocolRequest(protocol: ChatProtocol, body: ProtocolJson, claudeThinking?: unknown): ProtocolJson {
  if (protocol !== 'messages' && normalizeClaudeThinking(claudeThinking).mode !== 'omit') throw new ChatProtocolError('claude_thinking');
  if (protocol === 'responses') return body;
  const input = body.input as ProtocolJson[];
  if (input.some(x => x.type === 'reasoning') || body.include) throw new ChatProtocolError('input');
  const effort = (body.reasoning as ProtocolJson | undefined)?.effort as string | undefined;
  const max = body.max_output_tokens as number;
  if (protocol === 'chat') {
    return { model: body.model, messages: input.map(item => ({ role: item.role, content: (item.content as ProtocolJson[]).map(part => {
      if (part.type === 'input_text' || part.type === 'output_text') return { type: 'text', text: part.text };
      if (part.type === 'input_image') return { type: 'image_url', image_url: { url: part.image_url, detail: part.detail || 'auto' } };
      if (part.type === 'input_file') return { type: 'file', file: { filename: part.filename, file_data: part.file_data } };
      throw new ChatProtocolError();
    }) })), max_completion_tokens: max, reasoning_effort: effort, stream: true, stream_options: { include_usage: true }, store: false };
  }
  const messages: ProtocolJson[] = [], system: ProtocolJson[] = [];
  for (const item of input) {
    const content = (item.content as ProtocolJson[]).map(part => {
      if (part.type === 'input_text' || part.type === 'output_text') return { type: 'text', text: part.text };
      const data = String(part.image_url || part.file_data || '').match(/^data:([^;]+);base64,(.+)$/);
      if (!data) throw new ChatProtocolError('file');
      const source = { type: 'base64', media_type: data[1], data: data[2] };
      if (part.type === 'input_image') return { type: 'image', source };
      if (part.type === 'input_file') return { type: 'document', source, title: part.filename };
      throw new ChatProtocolError();
    });
    if (item.role === 'system' || item.role === 'developer') {
      // Moving an instruction across a conversation turn changes its meaning.
      if (messages.length) throw new ChatProtocolError();
      system.push(...content);
    } else {
      const previous = messages.at(-1);
      if (previous && previous.role === item.role) (previous.content as ProtocolJson[]).push(...content);
      else messages.push({ role: item.role, content });
    }
  }
  if (!messages.length || messages[0].role !== 'user') throw new ChatProtocolError();
  const config = normalizeClaudeThinking(claudeThinking, undefined, max);
  if (effort !== undefined && (config.mode !== 'adaptive' || !config.efforts.includes(effort))) throw new ChatProtocolError('claude_effort');
  const selectedEffort = config.mode === 'adaptive' ? effort ?? config.default_effort : null;
  const thinking = config.mode === 'omit' ? {} : { thinking: config.mode === 'enabled' ? { type: 'enabled', budget_tokens: config.budget_tokens } : { type: config.mode } };
  return { model: body.model, messages, ...(system.length ? { system } : {}), max_tokens: max, ...thinking,
    ...(selectedEffort ? { output_config: { effort: selectedEffort } } : {}), stream: true };
}

// Bounded SSE framing, including byte-fragmented CRLF and multiline data. An
// unterminated event at EOF is intentionally discarded, never treated as success.
export function parseProtocolSse(onEvent: (event: ProtocolJson) => void, onDone = () => {}) {
  let buffer = '', data: string[] = [], eventName = '', eventBytes = 0;
  const dispatch = () => {
    if (data.length) {
      const raw = data.join('\n');
      if (raw === '[DONE]') onDone();
      else {
        const event = JSON.parse(raw);
        if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('stream');
        if (event.type === undefined && eventName) event.type = eventName;
        onEvent(event);
      }
    }
    data = []; eventName = ''; eventBytes = 0;
  };
  const line = (value: string) => {
    if (!value) return dispatch();
    if (value.startsWith(':')) return;
    const index = value.indexOf(':');
    const field = index < 0 ? value : value.slice(0, index);
    let content = index < 0 ? '' : value.slice(index + 1);
    if (content.startsWith(' ')) content = content.slice(1);
    if (field === 'event') eventName = content;
    if (field === 'data') { data.push(content); eventBytes += content.length + 1; }
    if (eventBytes > 16 * 1024 * 1024) throw new Error('stream_limit');
  };
  return (chunk: string, eof = false) => {
    buffer += chunk;
    if (buffer.length + eventBytes > 16 * 1024 * 1024) throw new Error('stream_limit');
    let start = 0;
    for (let index = 0; index < buffer.length; index++) {
      if (buffer[index] !== '\r' && buffer[index] !== '\n') continue;
      if (buffer[index] === '\r' && index === buffer.length - 1 && !eof) break;
      line(buffer.slice(start, index));
      if (buffer[index] === '\r' && buffer[index + 1] === '\n') index++;
      start = index + 1;
    }
    buffer = buffer.slice(start);
    if (eof) { buffer = ''; data = []; eventName = ''; eventBytes = 0; }
  };
}
const record = (x: unknown): ProtocolJson => x && typeof x === 'object' && !Array.isArray(x) ? x as ProtocolJson : {};
const token = (x: unknown): number | null => Number.isSafeInteger(x) && (x as number) >= 0 ? x as number : null;
export function protocolEvents(protocol: ChatProtocol, responseId: string, emit: (event: ProtocolJson) => void) {
  let started = false, ended = false, finishReason: string | null = null;
  let answer = '', refusal = '', summary = '', size = 0;
  let inputTokens: number | null = null, outputTokens: number | null = null, totalTokens: number | null = null;
  const messageId = `msg_${responseId}`;
  const send = (type: string, extra: ProtocolJson = {}) => emit({ type, ...extra });
  const start = () => {
    if (started) return;
    started = true;
    send('response.created', { response: { id: responseId, object: 'response', status: 'in_progress', output: [] } });
    send('response.output_item.added', { output_index: 0, item: { id: messageId, type: 'message', role: 'assistant', status: 'in_progress', content: [] } });
    send('response.content_part.added', { output_index: 0, item_id: messageId, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
  };
  const append = (kind: 'text' | 'refusal' | 'reasoning', value: unknown) => {
    if (value === undefined || value === null || value === '') return;
    if (typeof value !== 'string') throw new Error('stream');
    size += value.length;
    if (size > 16 * 1024 * 1024) throw new Error('stream_limit');
    start();
    if (kind === 'text') answer += value;
    else if (kind === 'refusal') refusal += value;
    else summary += value;
    send(kind === 'text' ? 'response.output_text.delta' : kind === 'refusal' ? 'response.refusal.delta' : 'response.reasoning_summary_text.delta', { output_index: 0, item_id: messageId, content_index: 0, delta: value });
  };
  const finish = (failed = false) => {
    if (ended) return;
    start(); ended = true;
    const incomplete = ['length', 'max_tokens', 'content_filter', 'refusal'].includes(finishReason || '');
    const status = failed ? 'failed' : incomplete ? 'incomplete' : 'completed';
    const content: ProtocolJson[] = [{ type: 'output_text', text: answer, annotations: [] }];
    if (refusal) content.push({ type: 'refusal', refusal });
    const message = { id: messageId, type: 'message', role: 'assistant', status: failed || incomplete ? 'incomplete' : 'completed', content };
    send('response.output_text.done', { output_index: 0, item_id: messageId, content_index: 0, text: answer });
    send('response.content_part.done', { output_index: 0, item_id: messageId, content_index: 0, part: content[0] });
    send('response.output_item.done', { output_index: 0, item: message });
    const output: ProtocolJson[] = [message];
    if (summary) output.unshift({ type: 'reasoning', summary: [{ type: 'summary_text', text: summary }] });
    send(`response.${status}`, { response: { id: responseId, object: 'response', status, output,
      usage: { input_tokens: failed ? null : inputTokens, output_tokens: failed ? null : outputTokens, total_tokens: failed ? null : totalTokens ?? (inputTokens !== null && outputTokens !== null && Number.isSafeInteger(inputTokens + outputTokens) ? inputTokens + outputTokens : null) },
      ...(incomplete ? { incomplete_details: { reason: ['length', 'max_tokens'].includes(finishReason!) ? 'max_output_tokens' : 'content_filter' } } : {}),
      ...(failed ? { error: { code: 'upstream', message: 'Upstream protocol error' } } : {}) } });
  };
  const event = (value: ProtocolJson) => {
    if (ended) return;
    if (protocol === 'responses') { emit(value); return; }
    if (value.type === 'error' || value.error) { finish(true); return; }
    if (protocol === 'chat') {
      if (!Array.isArray(value.choices)) throw new Error('stream');
      const usage = record(value.usage);
      if (value.usage) { inputTokens = token(usage.prompt_tokens); outputTokens = token(usage.completion_tokens); totalTokens = token(usage.total_tokens); }
      if (value.choices.length > 1) throw new Error('stream');
      for (const raw of value.choices) {
        const choice = record(raw), delta = record(choice.delta);
        if (choice.index !== 0 || delta.tool_calls || delta.function_call || (delta.role && delta.role !== 'assistant')) throw new Error('stream');
        append('text', delta.content); append('refusal', delta.refusal);
        append('reasoning', delta.reasoning_content ?? delta.reasoning);
        if (choice.finish_reason != null) {
          if (!['stop', 'length', 'content_filter'].includes(String(choice.finish_reason))) { finish(true); return; }
          finishReason = String(choice.finish_reason);
        }
      }
      return;
    }
    const type = value.type;
    if (type === 'ping') return;
    if (type === 'message_start') {
      if (started) throw new Error('stream');
      const message = record(value.message), usage = record(message.usage);
      const base = token(usage.input_tokens);
      // Anthropic input_tokens excludes both cache-read and cache-write tokens.
      const read = usage.cache_read_input_tokens === undefined ? 0 : token(usage.cache_read_input_tokens);
      const write = usage.cache_creation_input_tokens === undefined ? 0 : token(usage.cache_creation_input_tokens);
      inputTokens = base !== null && read !== null && write !== null && Number.isSafeInteger(base + read + write) ? base + read + write : null;
      outputTokens = token(usage.output_tokens); start();
    } else if (type === 'content_block_start') {
      if (!started) throw new Error('stream');
      const block = record(value.content_block);
      if (block.type === 'text') append('text', block.text);
      else if (block.type === 'thinking') append('reasoning', block.thinking);
      else if (block.type !== 'redacted_thinking') throw new Error('stream');
    } else if (type === 'content_block_delta') {
      if (!started) throw new Error('stream');
      const delta = record(value.delta);
      if (delta.type === 'text_delta') append('text', delta.text);
      else if (delta.type === 'thinking_delta') append('reasoning', delta.thinking);
      else if (delta.type !== 'signature_delta') throw new Error('stream');
    } else if (type === 'message_delta') {
      if (!started) throw new Error('stream');
      const usage = record(value.usage), delta = record(value.delta);
      if (value.usage) outputTokens = token(usage.output_tokens);
      if (delta.stop_reason != null) {
        finishReason = String(delta.stop_reason);
        if (!['end_turn', 'stop_sequence', 'max_tokens', 'refusal'].includes(finishReason)) finish(true);
      }
    } else if (type === 'message_stop') {
      if (!finishReason) throw new Error('stream');
      finish();
    } else if (type !== 'content_block_stop') throw new Error('stream');
  };
  return { event, done: () => { if (protocol === 'chat' && finishReason) finish(); } };
}
