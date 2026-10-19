import { strict as assert } from 'node:assert';
import {
  assistantToolRequest,
  collectAssistantToolTurn,
  type AssistantToolDefinition,
  type AssistantToolRound,
} from '../supabase/functions/_shared/chat-assistant-tool-protocol.ts';

type Row = Record<string, unknown>;
const tool: AssistantToolDefinition = { name: 'lookup', description: 'Look up a value.', parameters: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'], additionalProperties: false } };
const body: Row = { model: 'm', input: [{ role: 'user', content: [{ type: 'input_text', text: 'hello' }] }], max_output_tokens: 1000, stream: true, store: false, include: ['reasoning.encrypted_content'] };
let count = 0;
function test(name: string, fn: () => void | Promise<void>) { return Promise.resolve(fn()).then(() => { count++; console.log(`PASS ${name}`); }); }
function sse(events: Row[], done = true): Uint8Array {
  const text = events.map(event => `event: ${String(event.type || 'chunk')}\r\ndata: ${JSON.stringify(event)}\r\n\r\n`).join('') + (done ? 'data: [DONE]\r\n\r\n' : '');
  return new TextEncoder().encode(text);
}
function streamBytes(value: Uint8Array, splits = [1, 2, 3, 5]): ReadableStream<Uint8Array> {
  return new ReadableStream({ start(controller) { let offset = 0, index = 0; while (offset < value.length) { const size = splits[index++ % splits.length]; controller.enqueue(value.slice(offset, offset + size)); offset += size; } controller.close(); } });
}
function abortableStream(value: Uint8Array, signal: AbortSignal): ReadableStream<Uint8Array> {
  return new ReadableStream({ start(controller) { const timer = setTimeout(() => { if (!signal.aborted) controller.enqueue(value); controller.close(); }, 50); signal.addEventListener('abort', () => { clearTimeout(timer); controller.error(new DOMException('aborted', 'AbortError')); }, { once: true }); } });
}
function completedResponse(events: Row[]) { return events.find(event => ['response.completed', 'response.incomplete', 'response.failed'].includes(String(event.type))); }

const responsesCallEvents = [
  { type: 'response.created', response: { id: 'r1' } },
  { type: 'response.output_item.added', output_index: 0, item: { id: 'fc1', type: 'function_call', call_id: 'call1', name: 'lookup', arguments: '' } },
  { type: 'response.function_call_arguments.delta', item_id: 'fc1', delta: '{"q":' },
  { type: 'response.function_call_arguments.delta', item_id: 'fc1', delta: '"你好"}' },
  { type: 'response.function_call_arguments.done', item_id: 'fc1', arguments: '{"q":"你好"}' },
  { type: 'response.output_item.done', output_index: 0, item: { id: 'fc1', type: 'function_call', call_id: 'call1', name: 'lookup', arguments: '{"q":"你好"}' } },
  { type: 'response.completed', response: { id: 'r1', status: 'completed', output: [{ type: 'function_call', id: 'fc1', call_id: 'call1', name: 'lookup', arguments: '{"q":"你好"}' }, { type: 'reasoning', encrypted_content: 'secret' }], usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 } } },
];
const messagesCallEvents = [
  { type: 'message_start', message: { id: 'm1', usage: { input_tokens: 2, cache_read_input_tokens: 4, cache_creation_input_tokens: 1, output_tokens: 1 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: 'think', signature: 'sig' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: '-more' } },
  { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tu1', name: 'lookup', input: {} } },
  { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"q":"x"}' } },
  { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 7 } },
  { type: 'message_stop' },
];
const chatCallEvents = [
  { choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'tc1', type: 'function', function: { name: 'lookup', arguments: '{"q":' } }] } }] },
  { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"x"}' } }] }, finish_reason: 'tool_calls' }] },
  { choices: [], usage: { prompt_tokens: 4, completion_tokens: 6, total_tokens: 10 } },
];

await test('request maps native schemas and preserves Responses reasoning include', () => {
  const result = assistantToolRequest('responses', body, undefined, [tool], [], true);
  assert.deepEqual(result.tools, [{ type: 'function', name: 'lookup', description: tool.description, parameters: tool.parameters, strict: false }]);
  assert.deepEqual(result.include, body.include);
  const round: AssistantToolRound = { turn: { calls: [{ id: 'call1', name: 'lookup', arguments: '{"q":"x"}' }], events: [], continuation: [], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 }, status: 'completed' }, results: [{ id: 'call1', output: 'value' }] };
  const history = assistantToolRequest('responses', body, undefined, [tool], [round]);
  assert.deepEqual((history.input as Row[]).slice(-2), [{ type: 'function_call', call_id: 'call1', name: 'lookup', arguments: '{"q":"x"}' }, { type: 'function_call_output', call_id: 'call1', output: 'value' }]);
  const noTools = assistantToolRequest('responses', body, undefined, [tool], [], false);
  assert.equal('tools' in noTools, false);
});

await test('request maps Anthropic thinking/tool result and Chat history', () => {
  const round: AssistantToolRound = { turn: { calls: [{ id: 'id', name: 'lookup', arguments: '{"q":"x"}' }], events: [], continuation: [{ role: 'assistant', content: [{ type: 'thinking', thinking: 't', signature: 'sig' }, { type: 'tool_use', id: 'id', name: 'lookup', input: { q: 'x' } }] }], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 }, status: 'completed' }, results: [{ id: 'id', output: 'ok' }] };
  const messages = assistantToolRequest('messages', { ...body, include: undefined }, undefined, [tool], [round]);
  assert.deepEqual((messages.messages as Row[]).slice(-2), [round.turn.continuation[0], { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'id', content: 'ok' }] }]);
  const chat = assistantToolRequest('chat', { ...body, include: undefined }, undefined, [tool], [round]);
  assert.deepEqual((chat.messages as Row[]).slice(-2), [round.turn.continuation[0], { role: 'tool', tool_call_id: 'id', content: 'ok' }]);
});

await test('Responses collector handles split UTF-8 and native function call', async () => {
  const turn = await collectAssistantToolTurn('responses', streamBytes(sse(responsesCallEvents)), new AbortController().signal);
  assert.equal(turn.status, 'completed'); assert.deepEqual(turn.calls, [{ id: 'call1', name: 'lookup', arguments: '{"q":"你好"}' }]);
  assert.deepEqual(turn.usage, { input_tokens: 2, output_tokens: 3, total_tokens: 5 }); assert.equal(turn.continuation.length, 2); assert.equal(turn.events.length, 0);
});

await test('Anthropic collector preserves full thinking and signature in continuation', async () => {
  const turn = await collectAssistantToolTurn('messages', streamBytes(sse(messagesCallEvents)), new AbortController().signal);
  assert.equal(turn.status, 'completed'); assert.deepEqual(turn.calls, [{ id: 'tu1', name: 'lookup', arguments: '{"q":"x"}' }]);
  assert.deepEqual(turn.usage, { input_tokens: 7, output_tokens: 7, total_tokens: 14 });
  assert.deepEqual((turn.continuation[0] as Row).content, [{ type: 'thinking', thinking: 'think', signature: 'sig-more' }, { type: 'tool_use', id: 'tu1', name: 'lookup', input: { q: 'x' } }]);
});

await test('Chat collector supports tool deltas and late usage', async () => {
  const turn = await collectAssistantToolTurn('chat', streamBytes(sse(chatCallEvents)), new AbortController().signal);
  assert.equal(turn.status, 'completed'); assert.deepEqual(turn.calls, [{ id: 'tc1', name: 'lookup', arguments: '{"q":"x"}' }]); assert.deepEqual(turn.usage, { input_tokens: 4, output_tokens: 6, total_tokens: 10 });
});

await test('final no-tool turns replay canonical Responses events without encrypted reasoning', async () => {
  const events = [{ type: 'response.created', response: { id: 'r2' } }, { type: 'response.output_item.added', item: { id: 'msg', type: 'message', role: 'assistant', content: [] } }, { type: 'response.output_text.delta', delta: 'answer' }, { type: 'response.completed', response: { id: 'r2', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'answer' }] }, { type: 'reasoning', encrypted_content: 'secret' }], usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 } } }];
  const turn = await collectAssistantToolTurn('responses', streamBytes(sse(events)), new AbortController().signal);
  assert.equal(turn.status, 'completed'); assert.equal(turn.calls.length, 0); assert.match(JSON.stringify(turn.events), /answer/); assert.doesNotMatch(JSON.stringify(turn.events), /secret|encrypted_content/);
});

await test('missing terminal, old Chat function_call and oversized streams fail closed; malformed args remain repairable data', async () => {
  const missing = await collectAssistantToolTurn('responses', streamBytes(sse(responsesCallEvents.slice(0, -1), false)), new AbortController().signal); assert.equal(missing.status, 'failed'); assert.equal(missing.calls.length, 0);
  const malformed = await collectAssistantToolTurn('chat', streamBytes(sse([{ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'bad', function: { name: 'lookup', arguments: '[]' } }] }, finish_reason: 'tool_calls' }] }])), new AbortController().signal); assert.equal(malformed.status, 'completed'); assert.equal(malformed.calls[0].arguments, '[]');
  const old = await collectAssistantToolTurn('chat', streamBytes(sse([{ choices: [{ index: 0, delta: { function_call: { name: 'lookup' } }, finish_reason: 'stop' }] }])), new AbortController().signal); assert.equal(old.status, 'failed');
  const huge = await collectAssistantToolTurn('responses', new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1)); controller.close(); } }), new AbortController().signal); assert.equal(huge.status, 'failed');
});

await test('abort propagates and unknown provider events are ignored', async () => {
  const controller = new AbortController(); const pending = collectAssistantToolTurn('responses', abortableStream(sse([{ type: 'response.unknown', value: 1 }]), controller.signal), controller.signal); controller.abort(); await assert.rejects(pending, /aborted|AbortError/);
});

await test('all three protocols preserve final visible thinking and answer with canonical completion', async () => {
  const traces: Array<['responses' | 'chat' | 'messages', Row[]]> = [
    ['responses', [{type:'response.reasoning_summary_text.delta',delta:'visible thought'}, {type:'response.output_text.delta',delta:'final answer'}, {type:'response.completed',response:{output:[{type:'reasoning',summary:[{type:'summary_text',text:'visible thought'}],encrypted_content:'not-for-client'},{type:'message',role:'assistant',content:[{type:'output_text',text:'final answer'}]}],usage:{input_tokens:1,output_tokens:2,total_tokens:3}}}]],
    ['chat', [{choices:[{index:0,delta:{reasoning_content:'visible thought',content:'final answer'},finish_reason:'stop'}]},{choices:[],usage:{prompt_tokens:1,completion_tokens:2,total_tokens:3}}]],
    ['messages', [{type:'message_start',message:{usage:{input_tokens:1,output_tokens:0}}},{type:'content_block_start',index:0,content_block:{type:'thinking',thinking:'visible thought',signature:'not-for-client'}},{type:'content_block_start',index:1,content_block:{type:'text',text:'final answer'}},{type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:2}},{type:'message_stop'}]]
  ];
  for (const [protocol, events] of traces) {
    const turn = await collectAssistantToolTurn(protocol, streamBytes(sse(events)), new AbortController().signal);
    assert.equal(turn.status,'completed');assert.equal(turn.calls.length,0);
    const output=JSON.stringify(turn.events);assert.match(output,/visible thought/);assert.match(output,/final answer/);assert.doesNotMatch(output,/not-for-client|encrypted_content|signature/);
    assert.equal(turn.events.filter(event=>event.type==='response.completed').length,1);
  }
});
await test('malformed bounded calls retain ids for error repair in every native protocol', async () => {
  const traces: Array<['responses' | 'chat' | 'messages', Row[]]> = [
    ['responses',[{type:'response.completed',response:{output:[{type:'function_call',call_id:'bad',name:'lookup',arguments:'{broken'}],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}}]],
    ['chat',[{choices:[{index:0,delta:{tool_calls:[{index:0,id:'bad',function:{name:'lookup',arguments:'{broken'}}]},finish_reason:'tool_calls'}]},{choices:[],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}]],
    ['messages',[{type:'message_start',message:{usage:{input_tokens:1,output_tokens:0}}},{type:'content_block_start',index:0,content_block:{type:'tool_use',id:'bad',name:'lookup',input:{}}},{type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:'{broken'}},{type:'message_delta',delta:{stop_reason:'tool_use'},usage:{output_tokens:1}},{type:'message_stop'}]]
  ];
  for(const [protocol,events] of traces) {
    const turn=await collectAssistantToolTurn(protocol,streamBytes(sse(events)),new AbortController().signal);
    assert.equal(turn.status,'completed');assert.equal(turn.calls[0].arguments,'{broken');assert.equal(turn.calls[0].id,'bad');assert.equal(turn.events.length,0);
    const next=assistantToolRequest(protocol,{...body,include:undefined},undefined,[tool],[{turn,results:[{id:'bad',output:'{"error":{"code":"invalid_arguments"}}'}]}]);
    assert.match(JSON.stringify(next),/invalid_arguments/);
  }
});
await test('duplicate native call identifiers fail and final tools are omitted', async () => {
  const turn=await collectAssistantToolTurn('responses',streamBytes(sse([{type:'response.completed',response:{output:[{id:'a',type:'function_call',call_id:'same',name:'lookup',arguments:'{}'},{id:'b',type:'function_call',call_id:'same',name:'lookup',arguments:'{}'}]}}])),new AbortController().signal);
  assert.equal(turn.status,'failed');assert.equal(turn.calls.length,0);
  for(const protocol of ['responses','chat','messages'] as const)assert.equal('tools' in assistantToolRequest(protocol,{...body,include:undefined},undefined,[tool],[],false),false);
});
await test('concurrent UTF-8 collectors keep decoder state independent and terminal does not require EOF', async () => {
  const events=[{type:'response.output_text.delta',delta:'你好'},{type:'response.completed',response:{output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'你好'}]}],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}}];
  const [a,b]=await Promise.all([collectAssistantToolTurn('responses',streamBytes(sse(events)),new AbortController().signal),collectAssistantToolTurn('responses',streamBytes(sse(events)),new AbortController().signal)]);
  assert.equal(a.status,'completed');assert.equal(b.status,'completed');assert.match(JSON.stringify(a.events),/你好/);
  const stalled=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(sse(events,false));},cancel(){return new Promise(()=>{});}});
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),1000);
  try{assert.equal((await collectAssistantToolTurn('responses',stalled,controller.signal)).status,'completed');}finally{clearTimeout(timer);}
});

console.log(`Chat assistant tool protocol: ${count} mocked adapter cases passed; no network or paid calls.`);
