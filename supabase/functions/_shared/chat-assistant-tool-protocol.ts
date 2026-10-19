import { parseProtocolSse, protocolEvents, protocolRequest, type ChatProtocol } from '../_shared/chat-protocol.ts';

export type AssistantToolDefinition = { name: string; description: string; parameters: Record<string, unknown> };
export type AssistantToolCall = { id: string; name: string; arguments: string };
export type AssistantToolTurn = {
  calls: AssistantToolCall[];
  events: Record<string, unknown>[];
  continuation: Record<string, unknown>[];
  usage: { input_tokens: number | null; output_tokens: number | null; total_tokens: number | null };
  status: 'completed' | 'incomplete' | 'failed';
};
export type AssistantToolRound = { turn: AssistantToolTurn; results: { id: string; output: string }[] };
type atpJson = Record<string, unknown>;
type atpUsage = AssistantToolTurn['usage'];
const atpMAX_STREAM_BYTES = 2 * 1024 * 1024;
const atpMAX_CALLS = 8;
const atpMAX_ARGUMENT_BYTES = 8192;
const atpMAX_ID = 200;
const atpMAX_NAME = 128;
const atpEncoder = new TextEncoder();
function atpRecord(value: unknown): atpJson | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as atpJson : null;
}
function atpToken(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}
function atpBytes(value: string): number { return atpEncoder.encode(value).byteLength; }
function atpAbortError(): DOMException { return new DOMException('The operation was aborted', 'AbortError'); }
function atpThrow(code = 'stream'): never { throw new Error(code); }
function atpString(value: unknown, max: number, required = true): string {
  if (typeof value !== 'string' || atpBytes(value) > max || required && !value.trim()) atpThrow();
  return value;
}
function atpInput(value: string): atpJson {
  try { const parsed = atpRecord(JSON.parse(value)); if (parsed) return parsed; } catch { /* Replay invalid arguments only as an explicit error placeholder. */ }
  return { invalid_arguments: true };
}
function atpUsageValue(input: number | null, output: number | null, total: number | null): atpUsage {
  const sum = input !== null && output !== null && Number.isSafeInteger(input + output) ? input + output : null;
  return { input_tokens: input, output_tokens: output, total_tokens: total === null ? sum : sum === null ? total : Math.max(total, sum) };
}
function atpClone(value: atpJson): atpJson { return JSON.parse(JSON.stringify(value)); }
function atpDeclarations(protocol: ChatProtocol, tools: AssistantToolDefinition[]): atpJson[] {
  const names = new Set<string>();
  return tools.map(tool => {
    if (!atpRecord(tool) || !/^[A-Za-z0-9_-]{1,128}$/.test(tool.name) || names.has(tool.name) || typeof tool.description !== 'string' || tool.description.length > 4000 || !atpRecord(tool.parameters)) atpThrow('tools');
    names.add(tool.name);
    if (protocol === 'responses') return { type: 'function', name: tool.name, description: tool.description, parameters: tool.parameters, strict: false };
    if (protocol === 'messages') return { name: tool.name, description: tool.description, input_schema: tool.parameters };
    return { type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters, strict: false } };
  });
}
function atpContinuation(protocol: ChatProtocol, turn: AssistantToolTurn): atpJson[] {
  if (turn.continuation.length) return turn.continuation.map(atpClone);
  if (protocol === 'responses') return turn.calls.map(call => ({ type: 'function_call', call_id: call.id, name: call.name, arguments: call.arguments }));
  if (protocol === 'messages') return [{ role: 'assistant', content: turn.calls.map(call => ({ type: 'tool_use', id: call.id, name: call.name, input: atpInput(call.arguments) })) }];
  return [{ role: 'assistant', content: null, tool_calls: turn.calls.map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } })) }];
}
export function assistantToolRequest(protocol: ChatProtocol, body: atpJson, claudeThinking: unknown, tools: AssistantToolDefinition[], rounds: AssistantToolRound[], allowTools = true): atpJson {
  if (!Array.isArray(body.input) || !Array.isArray(rounds)) atpThrow('input');
  const base = protocolRequest(protocol, body, claudeThinking), history: atpJson[] = [];
  for (const round of rounds) {
    const calls = round.turn.calls, ids = new Set<string>(), returned = new Set<string>();
    if (!Array.isArray(calls) || calls.length > atpMAX_CALLS || round.results.length !== calls.length) atpThrow('history');
    for (const call of calls) {
      atpString(call.id, atpMAX_ID); atpString(call.name, atpMAX_NAME); atpString(call.arguments, atpMAX_ARGUMENT_BYTES, false);
      if (ids.has(call.id)) atpThrow('history'); ids.add(call.id);
    }
    history.push(...atpContinuation(protocol, round.turn));
    const messageResults: atpJson[] = [];
    for (const result of round.results) {
      if (!ids.has(result.id) || returned.has(result.id)) atpThrow('tool_result');
      returned.add(result.id); atpString(result.output, 64 * 1024, false);
      if (protocol === 'responses') history.push({ type: 'function_call_output', call_id: result.id, output: result.output });
      else if (protocol === 'messages') messageResults.push({ type: 'tool_result', tool_use_id: result.id, content: result.output });
      else history.push({ role: 'tool', tool_call_id: result.id, content: result.output });
    }
    if (messageResults.length) history.push({ role: 'user', content: messageResults });
  }
  const key = protocol === 'responses' ? 'input' : 'messages';
  const result: atpJson = { ...base, [key]: [...base[key] as atpJson[], ...history] };
  if (allowTools) result.tools = atpDeclarations(protocol, tools);
  else delete result.tools;
  return result;
}
function atpBrowserItem(value: unknown): atpJson | null {
  const item = atpRecord(value);
  if (!item) return null;
  if (item.type === 'reasoning') return { type: 'reasoning', ...(typeof item.id === 'string' ? { id: item.id } : {}), summary: Array.isArray(item.summary) ? item.summary.filter(part => atpRecord(part)?.type === 'summary_text') : [] };
  if (item.type !== 'message') return null;
  return { ...item, content: Array.isArray(item.content) ? item.content.filter(part => ['output_text', 'refusal'].includes(String(atpRecord(part)?.type))) : [] };
}
function atpSafeEvent(event: atpJson): atpJson | null {
  const type = String(event.type || '');
  if (['response.completed', 'response.incomplete'].includes(type)) {
    const response = atpRecord(event.response);
    if (!response) atpThrow();
    const output = Array.isArray(response.output) ? response.output.flatMap(item => { const safe = atpBrowserItem(item); return safe ? [safe] : []; }) : [];
    return { ...event, response: { ...response, output } };
  }
  if (type === 'response.output_item.added' || type === 'response.output_item.done') {
    const item = atpBrowserItem(event.item); return item ? { ...event, item } : null;
  }
  if (['response.created', 'response.in_progress'].includes(type)) {
    const response = atpRecord(event.response); return response ? { ...event, response: { id: response.id, object: 'response', status: 'in_progress', output: [] } } : null;
  }
  if (['response.output_text.delta', 'response.output_text.done', 'response.refusal.delta', 'response.refusal.done', 'response.reasoning_summary_text.delta', 'response.reasoning_summary_text.done', 'response.reasoning_summary_part.added', 'response.reasoning_summary_part.done', 'response.content_part.added', 'response.content_part.done'].includes(type)) return event;
  return null;
}
function atpReplay(protocol: ChatProtocol, raw: atpJson[], id: string): atpJson[] {
  const events: atpJson[] = [], adapter = protocolEvents(protocol, id, event => { const safe = atpSafeEvent(event); if (safe) events.push(safe); });
  for (const event of raw) adapter.event(event);
  if (protocol === 'chat') adapter.done();
  if (!events.some(event => ['response.completed', 'response.incomplete'].includes(String(event.type)))) atpThrow();
  return events;
}
function atpCall(id: unknown, name: unknown, args: unknown): AssistantToolCall {
  return { id: atpString(id, atpMAX_ID), name: atpString(name, atpMAX_NAME), arguments: atpString(args, atpMAX_ARGUMENT_BYTES, false) };
}
function atpAddCall(calls: AssistantToolCall[], call: AssistantToolCall): void {
  if (calls.length >= atpMAX_CALLS || calls.some(item => item.id === call.id)) atpThrow('tool_call');
  calls.push(call);
}
async function atpRead(reader: ReadableStreamDefaultReader<Uint8Array>, signal: AbortSignal): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal.aborted) throw atpAbortError();
  const pending = reader.read();
  if (signal.aborted) { void pending.catch(() => undefined); throw atpAbortError(); }
  return await new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); void reader.cancel().catch(() => undefined); reject(atpAbortError()); };
    signal.addEventListener('abort', abort, { once: true });
    pending.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}
export async function collectAssistantToolTurn(protocol: ChatProtocol, body: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<AssistantToolTurn> {
  const decoder = new TextDecoder('utf-8', { fatal: true }), calls: AssistantToolCall[] = [], raw: atpJson[] = [];
  let usage: atpUsage = { input_tokens: null, output_tokens: null, total_tokens: null }, bytes = 0, terminal = false, done = false;
  let status: AssistantToolTurn['status'] = 'failed', id = `assistant_${crypto.randomUUID()}`, finish: string | null = null;
  const items = new Map<string, atpJson>(), blocks = new Map<number, atpJson>(), chatCalls = new Map<number, { id: string; name: string; args: string }>();
  let chatText = '', chatThinking = '', messageStarted = false;
  const event = (value: atpJson) => {
    if (terminal) return;
    raw.push(value);
    const type = String(value.type || '');
    if (type === 'error' || value.error) atpThrow();
    if (protocol === 'responses') {
      if (type === 'response.created') { const response = atpRecord(value.response); if (typeof response?.id === 'string') id = response.id; }
      if (type === 'response.output_item.added' || type === 'response.output_item.done') {
        const item = atpRecord(value.item); if (!item) atpThrow();
        const key = String(item.id || item.call_id || `item_${items.size}`); items.set(key, item);
      } else if (type === 'response.function_call_arguments.delta' || type === 'response.function_call_arguments.done') {
        const item = items.get(String(value.item_id)); if (!item || item.type !== 'function_call') atpThrow();
        item.arguments = type.endsWith('.delta') ? String(item.arguments || '') + atpString(value.delta, atpMAX_ARGUMENT_BYTES, false) : atpString(value.arguments, atpMAX_ARGUMENT_BYTES, false);
        atpString(item.arguments, atpMAX_ARGUMENT_BYTES, false);
      } else if (['response.completed', 'response.incomplete', 'response.failed'].includes(type)) {
        const response = atpRecord(value.response); if (!response) atpThrow();
        const u = atpRecord(response.usage); if (u) usage = atpUsageValue(atpToken(u.input_tokens), atpToken(u.output_tokens), atpToken(u.total_tokens));
        if (Array.isArray(response.output)) for (const rawItem of response.output) {
          const item = atpRecord(rawItem); if (!item) atpThrow();
          const key = String(item.id || item.call_id || `item_${items.size}`); items.set(key, item);
        }
        terminal = true; status = type === 'response.completed' ? 'completed' : type === 'response.incomplete' ? 'incomplete' : 'failed';
      }
    } else if (protocol === 'messages') {
      if (type === 'ping') return;
      if (type === 'message_start') {
        if (messageStarted) atpThrow(); messageStarted = true;
        const message = atpRecord(value.message), u = atpRecord(message?.usage); if (!message || !u) atpThrow();
        const base = atpToken(u.input_tokens), read = atpToken(u.cache_read_input_tokens ?? 0), write = atpToken(u.cache_creation_input_tokens ?? 0);
        usage.input_tokens = base !== null && read !== null && write !== null && Number.isSafeInteger(base + read + write) ? base + read + write : null;
        usage.output_tokens = atpToken(u.output_tokens);
      } else if (type === 'content_block_start') {
        const index = atpToken(value.index), block = atpRecord(value.content_block);
        if (!messageStarted || index === null || index > 1024 || blocks.has(index) || !block) atpThrow();
        if (!['tool_use', 'thinking', 'redacted_thinking', 'text'].includes(String(block.type))) atpThrow();
        blocks.set(index, block.type === 'tool_use' ? { ...block, atpArgs: '' } : atpClone(block));
      } else if (type === 'content_block_delta') {
        const delta = atpRecord(value.delta), current = blocks.get(Number(value.index)); if (!delta || !current) atpThrow();
        if (delta.type === 'input_json_delta') { if (current.type !== 'tool_use') atpThrow(); current.atpArgs = String(current.atpArgs || '') + atpString(delta.partial_json, atpMAX_ARGUMENT_BYTES, false); atpString(current.atpArgs, atpMAX_ARGUMENT_BYTES, false); }
        else if (delta.type === 'thinking_delta') { if (current.type !== 'thinking') atpThrow(); current.thinking = String(current.thinking || '') + atpString(delta.thinking, atpMAX_STREAM_BYTES, false); }
        else if (delta.type === 'text_delta') { if (current.type !== 'text') atpThrow(); current.text = String(current.text || '') + atpString(delta.text, atpMAX_STREAM_BYTES, false); }
        else if (delta.type === 'signature_delta') { if (current.type !== 'thinking') atpThrow(); current.signature = String(current.signature || '') + atpString(delta.signature, atpMAX_STREAM_BYTES, false); }
        else atpThrow();
      } else if (type === 'message_delta') {
        const delta = atpRecord(value.delta), u = atpRecord(value.usage); if (u) usage.output_tokens = atpToken(u.output_tokens);
        if (delta?.stop_reason != null) { finish = String(delta.stop_reason); if (!['end_turn', 'stop_sequence', 'tool_use', 'max_tokens', 'refusal'].includes(finish)) atpThrow(); }
      } else if (type === 'message_stop') {
        if (!messageStarted || !finish) atpThrow(); terminal = true; status = ['max_tokens', 'refusal'].includes(finish) ? 'incomplete' : 'completed';
      } else if (type !== 'content_block_stop') atpThrow();
    } else {
      if (!Array.isArray(value.choices) || value.choices.length > 1) atpThrow();
      for (const rawChoice of value.choices) {
        const choice = atpRecord(rawChoice), delta = atpRecord(choice?.delta); if (!choice || !delta || choice.index !== 0 || delta.function_call || delta.role && delta.role !== 'assistant') atpThrow();
        if (delta.content != null) chatText += atpString(delta.content, atpMAX_STREAM_BYTES, false);
        if (delta.reasoning_content != null || delta.reasoning != null) chatThinking += atpString(delta.reasoning_content ?? delta.reasoning, atpMAX_STREAM_BYTES, false);
        if (delta.tool_calls !== undefined) {
          if (!Array.isArray(delta.tool_calls)) atpThrow();
          for (const rawPart of delta.tool_calls) {
            const part = atpRecord(rawPart), fn = atpRecord(part?.function), index = atpToken(part?.index);
            if (!part || !fn || index === null || index >= atpMAX_CALLS || part.type !== undefined && part.type !== 'function') atpThrow();
            let current = chatCalls.get(index);
            if (!current) { current = { id: atpString(part.id, atpMAX_ID), name: atpString(fn.name, atpMAX_NAME), args: '' }; chatCalls.set(index, current); }
            else if (part.id !== undefined && part.id !== current.id || fn.name !== undefined && fn.name !== current.name) atpThrow();
            if (fn.arguments !== undefined) { current.args += atpString(fn.arguments, atpMAX_ARGUMENT_BYTES, false); atpString(current.args, atpMAX_ARGUMENT_BYTES, false); }
          }
        }
        if (choice.finish_reason != null) { finish = String(choice.finish_reason); if (!['stop', 'length', 'content_filter', 'tool_calls'].includes(finish)) atpThrow(); }
      }
      const u = atpRecord(value.usage); if (u) usage = atpUsageValue(atpToken(u.prompt_tokens), atpToken(u.completion_tokens), atpToken(u.total_tokens));
    }
  };
  const reader = body.getReader();
  try {
    const parser = parseProtocolSse(event, () => { done = true; });
    while (true) {
      const next = await atpRead(reader, signal);
      if (next.done) { parser(decoder.decode(), true); break; }
      bytes += next.value.byteLength; if (bytes > atpMAX_STREAM_BYTES) atpThrow('stream_limit');
      parser(decoder.decode(next.value, { stream: true }));
      if (protocol === 'chat' ? done : terminal) break;
    }
    if (signal.aborted) throw atpAbortError();
    let continuation: atpJson[] = [];
    if (protocol === 'responses') {
      if (!terminal || status === 'failed') atpThrow();
      for (const item of items.values()) if (item.type === 'function_call') atpAddCall(calls, atpCall(item.call_id ?? item.id, item.name, item.arguments));
      if (calls.length) continuation = [...items.values()].filter(item => ['reasoning', 'function_call', 'message'].includes(String(item.type))).map(atpClone);
    } else if (protocol === 'messages') {
      if (!terminal || !finish) atpThrow();
      const content = [...blocks.entries()].sort(([a], [b]) => a - b).map(([, block]) => {
        if (block.type !== 'tool_use') return block;
        const args = typeof block.atpArgs === 'string' && block.atpArgs ? block.atpArgs : JSON.stringify(block.input ?? {});
        atpAddCall(calls, atpCall(block.id, block.name, args));
        return { type: 'tool_use', id: block.id, name: block.name, input: atpInput(args) };
      });
      if ((finish === 'tool_use') !== Boolean(calls.length)) atpThrow();
      if (calls.length) continuation = [{ role: 'assistant', content }];
    } else {
      if (!done || !finish) atpThrow();
      status = ['length', 'content_filter'].includes(finish) ? 'incomplete' : 'completed';
      for (const [, call] of [...chatCalls.entries()].sort(([a], [b]) => a - b)) atpAddCall(calls, atpCall(call.id, call.name, call.args));
      if ((finish === 'tool_calls') !== Boolean(calls.length)) atpThrow();
      if (calls.length) continuation = [{ role: 'assistant', content: chatText || null, ...(chatThinking ? { reasoning_content: chatThinking } : {}), tool_calls: calls.map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } })) }];
    }
    return { calls, continuation, events: calls.length ? [] : atpReplay(protocol, raw, id), usage: atpUsageValue(usage.input_tokens, usage.output_tokens, usage.total_tokens), status };
  } catch (error) {
    if (signal.aborted || error instanceof DOMException && error.name === 'AbortError') throw atpAbortError();
    return { calls: [], continuation: [], events: [], usage, status: 'failed' };
  } finally { void reader.cancel().catch(() => undefined); }
}
