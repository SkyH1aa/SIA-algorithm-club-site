// Run: deno run tools/test-chat-protocol.ts (no permissions required).
import { strict as assert } from 'node:assert';
import { chatEndpoint, ChatProtocolError, parseProtocolSse, protocolEvents, protocolRequest, normalizeClaudeThinking, validateProtocolCapabilities } from '../supabase/functions/_shared/chat-protocol.ts';
type Row = Record<string, unknown>;
const text = (role: string, value: string) => ({ role, content: [{ type: role === 'assistant' ? 'output_text' : 'input_text', text: value }] });
const body = { model: 'model', input: [text('system', 'rule'), text('developer', 'more'), text('user', 'question'), text('assistant', 'answer'), text('user', 'next')], max_output_tokens: 9000, stream: true, store: false };
let count = 0;
function test(name: string, fn: () => void) { fn(); count++; console.log(`PASS ${name}`); }
const parse = (protocol: 'messages' | 'chat', frames: Row[], done = false, eof = false) => {
  const events: Row[] = [];
  const adapter = protocolEvents(protocol, 'request', event => events.push(event));
  const parser = parseProtocolSse(adapter.event, adapter.done);
  const source = frames.map(frame => `event: ${frame.type || 'chunk'}\r\ndata: ${JSON.stringify(frame)}\r\n\r\n`).join('') + (done ? 'data: [DONE]\r\n\r\n' : '');
  for (const character of source) parser(character);
  if (eof) parser('', true);
  return events;
};
const completed = (events: Row[]) => events.filter(event => ['response.completed', 'response.incomplete', 'response.failed'].includes(String(event.type)));
test('endpoint inference preserves explicit URLs, aliases message, defaults bare URL to Responses', () => {
  for (const base of ['https://host.example/v1', 'https://host.example/v1/']) assert.deepEqual(chatEndpoint(base), { protocol: 'responses', url: 'https://host.example/v1/responses' });
  for (const route of ['/responses', '/messages', '/message', '/chat/completions']) {
    const result = chatEndpoint('https://host.example/v1' + route + '/');
    assert.equal(result.protocol, route === '/responses' ? 'responses' : route === '/chat/completions' ? 'chat' : 'messages');
    assert.equal(result.url, 'https://host.example/v1' + route.replace(/\/message$/, '/messages'));
  }
});
test('explicit dispatch appends canonical endpoints to bare paths without inventing v1', () => {
  for (const protocol of ['responses', 'messages', 'chat'] as const) {
    const suffix = protocol === 'chat' ? 'chat/completions' : protocol;
    for (const path of ['', '/v1', '/gateway/custom']) {
      for (const trailing of ['', '/', '///']) assert.deepEqual(chatEndpoint(`https://host.example${path}${trailing}`, protocol), { protocol, url: `https://host.example${path}/${suffix}` });
    }
  }
});
test('explicit dispatch overrides each recognized suffix once while retaining its prefix', () => {
  for (const protocol of ['responses', 'messages', 'chat'] as const) {
    const suffix = protocol === 'chat' ? 'chat/completions' : protocol;
    for (const old of ['responses', 'messages', 'message', 'chat/completions', 'MESSAGES', 'Chat/Completions']) {
      assert.deepEqual(chatEndpoint(`https://host.example/gateway/v1/${old}///`, protocol), { protocol, url: `https://host.example/gateway/v1/${suffix}` });
    }
    assert.equal(chatEndpoint('https://host.example/responses/messages', protocol).url, `https://host.example/responses/${suffix}`);
    for (const path of ['response', 'messages/extra', 'chat/completion']) assert.equal(chatEndpoint(`https://host.example/${path}`, protocol).url, `https://host.example/${path}/${suffix}`);
  }
});
test('auto retains legacy case, terminal alias and unknown-path behavior exactly', () => {
  const cases = [
    ['https://host.example', 'responses', 'https://host.example/responses'],
    ['https://host.example/proxy/Responses///', 'responses', 'https://host.example/proxy/Responses'],
    ['https://host.example/proxy/MESSAGE/', 'messages', 'https://host.example/proxy/messages'],
    ['https://host.example/proxy/MESSAGES/', 'messages', 'https://host.example/proxy/MESSAGES'],
    ['https://host.example/proxy/Chat/Completions/', 'chat', 'https://host.example/proxy/Chat/Completions'],
    ['https://host.example/messages/extra', 'responses', 'https://host.example/messages/extra/responses']
  ];
  for (const [base, protocol, url] of cases) {
    assert.deepEqual(chatEndpoint(base), { protocol, url });
    assert.deepEqual(chatEndpoint(base, 'auto'), { protocol, url });
  }
});
test('invalid protocol settings fail clearly instead of dispatching', () => {
  for (const setting of ['', 'AUTO', 'message', 'chat/completions', null, 1, {}]) assert.throws(() => chatEndpoint('https://host.example/v1', setting as Parameters<typeof chatEndpoint>[1]), /api_protocol/);
});
test('native Responses payload including encrypted reasoning stays unchanged', () => {
  const native = { ...body, include: ['reasoning.encrypted_content'], reasoning: { effort: 'custom-effort' } };
  assert.equal(protocolRequest('responses', native), native);
  validateProtocolCapabilities('responses', { preserve_reasoning: true, reasoning_efforts: ['custom-effort'] });
});
test('Anthropic moves only prefix instructions and merges adjacent matching roles', () => {
  const result = protocolRequest('messages', { ...body, input: [...body.input, text('user', 'again')] });
  assert.deepEqual(result.system, [{ type: 'text', text: 'rule' }, { type: 'text', text: 'more' }]);
  assert.deepEqual((result.messages as Row[]).at(-1), { role: 'user', content: [{ type: 'text', text: 'next' }, { type: 'text', text: 'again' }] });
  assert.equal(result.max_tokens, 9000); assert.equal(result.input, undefined); assert.equal(result.store, undefined);
  assert.throws(() => protocolRequest('messages', { ...body, input: [text('user', 'first'), text('system', 'late')] }), ChatProtocolError);
  assert.throws(() => protocolRequest('messages', { ...body, input: [text('assistant', 'first')] }), ChatProtocolError);
  assert.throws(() => protocolRequest('messages', { ...body, input: [text('system', 'only')] }), ChatProtocolError);
});
test('attachment mappings use native Anthropic sources and Chat Completions file/image parts', () => {
  const attached = { ...body, input: [{ role: 'user', content: [{ type: 'input_image', image_url: 'data:image/png;base64,aGVsbG8=', detail: 'low' }, { type: 'input_file', filename: 'test.pdf', file_data: 'data:application/pdf;base64,JVBERg==' }] }] };
  const anthropic = (protocolRequest('messages', attached).messages as Row[])[0].content;
  assert.deepEqual(anthropic, [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' } }, { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERg==' }, title: 'test.pdf' }]);
  const chat = (protocolRequest('chat', attached).messages as Row[])[0].content;
  assert.deepEqual(chat, [{ type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=', detail: 'low' } }, { type: 'file', file: { filename: 'test.pdf', file_data: 'data:application/pdf;base64,JVBERg==' } }]);
});
test('Chat Completions preserves instruction roles, output budget and explicit reasoning effort', () => {
  const result = protocolRequest('chat', { ...body, reasoning: { effort: 'high' } });
  assert.deepEqual((result.messages as Row[]).map(x => x.role), ['system', 'developer', 'user', 'assistant', 'user']);
  assert.equal(result.max_completion_tokens, 9000); assert.equal(result.reasoning_effort, 'high'); assert.equal(result.store, false);
  assert.deepEqual(result.stream_options, { include_usage: true });
});
test('reasoning capability checks retain history guards and ignore legacy Messages efforts', () => {
  for (const protocol of ['messages', 'chat'] as const) {
    assert.throws(() => validateProtocolCapabilities(protocol, { preserve_reasoning: true, reasoning_efforts: [] }), /reasoning_history_unsupported/);
    assert.throws(() => protocolRequest(protocol, { ...body, input: [{ type: 'reasoning', encrypted_content: 'opaque', summary: [] }] }), ChatProtocolError);
    assert.throws(() => protocolRequest(protocol, { ...body, include: ['reasoning.encrypted_content'] }), ChatProtocolError);
  }
  // Chat Completions 不再限制思考等级：上游自定义值必须原样接受。
  for (const efforts of [['invented'], ['none', 'low', 'medium', 'high', 'xhigh', 'max'], ['ultra'], ['a-b_c']]) {
    validateProtocolCapabilities('chat', { preserve_reasoning: false, reasoning_efforts: efforts });
  }
  // 只拒绝无法安全序列化的非字符串/空值。
  assert.throws(() => validateProtocolCapabilities('chat', { preserve_reasoning: false, reasoning_efforts: [1] }), /reasoning_effort_unsupported/);
  assert.throws(() => validateProtocolCapabilities('chat', { preserve_reasoning: false, reasoning_efforts: [''] }), /reasoning_effort_unsupported/);
  validateProtocolCapabilities('messages', { preserve_reasoning: false, reasoning_efforts: ['invented', 'high'], default_max_output_tokens: 100 });
});
test('Claude normalization supplies fail-safe defaults and strictly rejects malformed configs', () => {
  assert.deepEqual(normalizeClaudeThinking(), { mode: 'omit' });
  assert.deepEqual(normalizeClaudeThinking({ mode: 'adaptive' }), { mode: 'adaptive', efforts: [], default_effort: null });
  for (const mode of ['omit', 'disabled']) {
    assert.deepEqual(normalizeClaudeThinking({ mode }), { mode });
    for (const key of ['budget_tokens', 'efforts', 'default_effort', 'extra']) assert.throws(() => normalizeClaudeThinking({ mode, [key]: null }), /^ChatProtocolError: claude_thinking$/);
  }
  for (const config of [null, [], '', true, 1, {}, { mode: 'ENABLED' }, { mode: 'enabled', efforts: [] }, { mode: 'adaptive', budget_tokens: 1024 }, { mode: 'adaptive', efforts: null }, { mode: 'adaptive', efforts: ['high', 'high'] }, { mode: 'adaptive', efforts: ['none'] }, { mode: 'adaptive', efforts: ['HIGH'] }, { mode: 'adaptive', efforts: [1] }, { mode: 'adaptive', default_effort: 'high' }, { mode: 'adaptive', default_effort: false }, { mode: 'adaptive', unknown: true }]) assert.throws(() => normalizeClaudeThinking(config), /^ChatProtocolError: claude_thinking$/);
  for (const budget_tokens of [undefined, null, '1024', true, 1023, -1, 1024.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => normalizeClaudeThinking({ mode: 'enabled', budget_tokens }), /claude_thinking_budget/);
  for (const max of [1024, 1000]) {
    assert.throws(() => normalizeClaudeThinking({ mode: 'enabled', budget_tokens: 1024 }, max), /claude_thinking_budget/);
    assert.throws(() => normalizeClaudeThinking({ mode: 'enabled', budget_tokens: 1024 }, 9000, max), /claude_thinking_budget/);
  }
  assert.deepEqual(normalizeClaudeThinking({ mode: 'enabled', budget_tokens: 1024 }, 1025, 1025), { mode: 'enabled', budget_tokens: 1024 });
});
test('Claude modes use exact dedicated wire settings without generic budget inference or clipping', () => {
  for (const config of [undefined, { mode: 'omit' }]) {
    const result = protocolRequest('messages', body, config);
    assert.equal('thinking' in result, false); assert.equal('output_config' in result, false);
  }
  assert.deepEqual(protocolRequest('messages', body, { mode: 'disabled' }).thinking, { type: 'disabled' });
  assert.deepEqual(protocolRequest('messages', body, { mode: 'enabled', budget_tokens: 8192 }).thinking, { type: 'enabled', budget_tokens: 8192 });
  assert.throws(() => protocolRequest('messages', { ...body, max_output_tokens: 8192 }, { mode: 'enabled', budget_tokens: 8192 }), /claude_thinking_budget/);
  for (const mode of ['omit', 'disabled', 'enabled']) for (const effort of ['none', 'low', 'medium', 'high', 'xhigh', 'max']) assert.throws(() => protocolRequest('messages', { ...body, reasoning: { effort } }, mode === 'enabled' ? { mode, budget_tokens: 1024 } : { mode }), /claude_effort/);
});
test('Claude adaptive efforts include all five SDK values and emit only configured selections', () => {
  const config = { mode: 'adaptive', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], default_effort: 'xhigh' };
  const result = protocolRequest('messages', body, config);
  assert.deepEqual(result.thinking, { type: 'adaptive' }); assert.deepEqual(result.output_config, { effort: 'xhigh' });
  assert.equal('budget_tokens' in (result.thinking as Row), false);
  for (const effort of config.efforts) assert.deepEqual(protocolRequest('messages', { ...body, reasoning: { effort } }, config).output_config, { effort });
  for (const effort of ['none', 'minimal', 'custom', '', 1]) assert.throws(() => protocolRequest('messages', { ...body, reasoning: { effort } }, config), /claude_effort/);
  const noEffort = protocolRequest('messages', body, { mode: 'adaptive' });
  assert.deepEqual(noEffort.thinking, { type: 'adaptive' }); assert.equal('output_config' in noEffort, false);
  assert.equal('output_config' in protocolRequest('messages', body, { mode: 'adaptive', efforts: ['high'], default_effort: null }), false);
});
test('active Claude config cannot silently survive a non-Messages protocol switch', () => {
  for (const protocol of ['responses', 'chat'] as const) {
    for (const config of [{ mode: 'disabled' }, { mode: 'adaptive' }, { mode: 'enabled', budget_tokens: 1024 }]) {
      assert.throws(() => validateProtocolCapabilities(protocol, { preserve_reasoning: false, reasoning_efforts: [], default_max_output_tokens: 9000 }, config), /^ChatProtocolError: claude_thinking$/);
      assert.throws(() => protocolRequest(protocol, body, config), /^ChatProtocolError: claude_thinking$/);
    }
  }
});
test('Chat terminal waits for DONE, retains late usage and complete text, maps reasoning/refusal', () => {
  const frames = [{ choices: [{ index: 0, delta: { content: 'hello', reasoning_content: 'thought', refusal: 'declined' }, finish_reason: null }] }, { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }, { choices: [], usage: { prompt_tokens: 11, completion_tokens: 4, total_tokens: 15 } }];
  assert.equal(completed(parse('chat', frames, false, true)).length, 0);
  const result = parse('chat', frames, true);
  const terminal = completed(result)[0].response as Row;
  assert.deepEqual(terminal.usage, { input_tokens: 11, output_tokens: 4, total_tokens: 15 });
  assert.match(JSON.stringify(terminal.output), /hello/); assert.match(JSON.stringify(terminal.output), /thought/); assert.match(JSON.stringify(terminal.output), /declined/);
  assert.equal(completed(result).length, 1);
});
test('Anthropic cached input is charged, thinking/signature is visible but never encrypted history', () => {
  const result = parse('messages', [
    { type: 'message_start', message: { usage: { input_tokens: 4, cache_read_input_tokens: 20, cache_creation_input_tokens: 3, output_tokens: 1 } } },
    { type: 'content_block_start', content_block: { type: 'thinking', thinking: '' } },
    { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'reason' } },
    { type: 'content_block_delta', delta: { type: 'signature_delta', signature: 'secret-signature' } },
    { type: 'content_block_start', content_block: { type: 'text', text: 'answer' } },
    { type: 'message_delta', delta: { stop_reason: 'max_tokens' }, usage: { output_tokens: 9 } },
    { type: 'message_stop' }, { type: 'error', error: { message: 'ignored after terminal' } }
  ]);
  const final = completed(result); assert.equal(final.length, 1); assert.equal(final[0].type, 'response.incomplete');
  assert.deepEqual((final[0].response as Row).usage, { input_tokens: 27, output_tokens: 9, total_tokens: 36 });
  assert.doesNotMatch(JSON.stringify(result), /secret-signature|encrypted_content/);
});
test('unsupported tool calls and finish reasons cannot invent a completed answer', () => {
  assert.throws(() => parse('chat', [{ choices: [{ index: 0, delta: { tool_calls: [{}] } }] }]), /stream/);
  assert.throws(() => parse('chat', [{ choices: [{ index: 1, delta: {} }] }]), /stream/);
  assert.throws(() => parse('chat', [{ choices: [{ index: 0, delta: {} }, { index: 1, delta: {} }] }]), /stream/);
  const result = parse('chat', [{ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }], true);
  assert.equal(completed(result)[0].type, 'response.failed');
  assert.throws(() => parse('messages', [{ type: 'message_start', message: {} }, { type: 'content_block_start', content_block: { type: 'tool_use' } }]), /stream/);
  assert.throws(() => parse('messages', [{ type: 'message_start', message: {} }, { type: 'message_stop' }]), /stream/);
});
test('upstream error redaction and absent/invalid usage leave conservative accounting', () => {
  const failed = parse('messages', [{ type: 'error', error: { message: 'private diagnostic', api_key: 'secret' } }]);
  assert.equal(completed(failed)[0].type, 'response.failed'); assert.doesNotMatch(JSON.stringify(failed), /private diagnostic|secret/);
  const partial = parse('messages', [{ type: 'message_start', message: { usage: { input_tokens: 4, output_tokens: 1 } } }, { type: 'error', error: { message: 'partial provider failure' } }]);
  assert.deepEqual((completed(partial)[0].response as Row).usage, { input_tokens: null, output_tokens: null, total_tokens: null });
  const missing = parse('chat', [{ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: -1, completion_tokens: '4', total_tokens: 1.5 } }], true);
  assert.deepEqual((completed(missing)[0].response as Row).usage, { input_tokens: null, output_tokens: null, total_tokens: null });
});
test('SSE framing handles CRLF, comments, multiline JSON and rejects malformed payloads', () => {
  const events: Row[] = []; const parser = parseProtocolSse(event => events.push(event));
  for (const character of ': heartbeat\r\nevent: native\r\ndata: {"value":\r\ndata: "你好"}\r\n\r\ndata: {"type":"unfinished"}') parser(character);
  parser('', true); assert.deepEqual(events, [{ type: 'native', value: '你好' }]);
  for (const bad of ['data: nope\n\n', 'data: []\n\n', 'data: null\n\n']) assert.throws(() => parseProtocolSse(() => {})(bad));
});
console.log(`Chat protocol: ${count} mocked adapter cases passed; no permissions required.`);
