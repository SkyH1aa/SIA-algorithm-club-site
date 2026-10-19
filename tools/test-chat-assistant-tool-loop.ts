// Run: npm exec --yes --package=deno -- deno run tools/test-chat-assistant-tool-loop.ts
// No network permission: dispatch returns mocked native SSE streams.
import { strict as assert } from 'node:assert';
import {
  assistantToolBudget,
  runAssistantToolLoop,
  ASSISTANT_TOOL_HISTORY_BYTES,
  ASSISTANT_TOOL_MAX_CALLS,
  ASSISTANT_TOOL_MAX_TURNS,
} from '../supabase/functions/_shared/chat-assistant-tool-loop.ts';
import type { AssistantToolDefinition } from '../supabase/functions/_shared/chat-assistant-tool-protocol.ts';

type Row = Record<string, unknown>;
const tool: AssistantToolDefinition = { name: 'lookup', description: 'Lookup public data', parameters: { type: 'object', additionalProperties: false, properties: { key: { type: 'string' } }, required: ['key'] } };
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const body = { model: 'mock', input: [{ role: 'user', content: [{ type: 'input_text', text: 'lookup' }] }] };
const signal = new AbortController().signal;
function sse(events: unknown[], done = true): Response {
  const text = events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + (done ? 'data: [DONE]\n\n' : '');
  return new Response(new ReadableStream({ start(controller) { controller.enqueue(encoder.encode(text)); controller.close(); } }), { headers: { 'content-type': 'text/event-stream' } });
}
function responsesCall(id = 'call_1', args = '{"key":"x"}', outputTokens = 3): Response {
  return sse([
    { type: 'response.created', response: { id: 'r1' } },
    { type: 'response.output_item.added', item: { id, type: 'function_call', call_id: id, name: 'lookup', arguments: args } },
    { type: 'response.completed', response: { id: 'r1', status: 'completed', output: [{ id, type: 'function_call', call_id: id, name: 'lookup', arguments: args }], usage: { input_tokens: 10, output_tokens: outputTokens, total_tokens: 13 } } },
  ]);
}
function responsesFinal(text = 'done', outputTokens = 4): Response {
  return sse([
    { type: 'response.created', response: { id: 'r2' } },
    { type: 'response.output_item.added', item: { id: 'msg', type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] } },
    { type: 'response.completed', response: { id: 'r2', status: 'completed', output: [{ id: 'msg', type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }], usage: { input_tokens: 20, output_tokens: outputTokens, total_tokens: 24 } } },
  ]);
}
function messagesTurn(call: boolean, outputTokens: number): Response {
  const events = [
    { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', content: [], usage: { input_tokens: 1, output_tokens: 0 } } },
    ...(call ? [{ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'lookup_1', name: 'lookup', input: { key: 'x' } } }, { type: 'content_block_stop', index: 0 }] : [{ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'done' } }, { type: 'content_block_stop', index: 0 }]),
    { type: 'message_delta', delta: { stop_reason: call ? 'tool_use' : 'end_turn' }, usage: { output_tokens: outputTokens } },
    { type: 'message_stop' },
  ];
  return sse(events);
}
function options(dispatch: (serialized: string, signal: AbortSignal) => Promise<Response>, overrides: Partial<Parameters<typeof runAssistantToolLoop>[0]> = {}) {
  return { protocol: 'responses' as const, body, claudeThinking: undefined, tools: [tool], signal, maxRequestBytes: 100_000, maxInputTokens: 100_000, outputBudget: 100, dispatch, execute: async () => ({ rows: [{ key: 'x' }] }), estimate: (_request: Row, historyBytes: number) => historyBytes + 10, ...overrides };
}
async function run(name: string, fn: () => Promise<void> | void) { await fn(); console.log(`PASS ${name}`); }

await run('budget reserves three turns and includes schema plus history allowance', () => {
  assert.deepEqual(assistantToolBudget(100, 10), { perTurnInputTokens: 16_360, reservedInputTokens: 49_080 });
});

await run('executes a native tool round then final turn and aggregates usage', async () => {
  const requests: Row[] = []; let index = 0; let executed = 0;
  const result = await runAssistantToolLoop(options(async serialized => { requests.push(JSON.parse(serialized)); return index++ === 0 ? responsesCall() : responsesFinal(); }, { execute: async (name, args) => { executed++; assert.equal(name, 'lookup'); assert.deepEqual(args, { key: 'x' }); return { rows: [{ key: 'x' }] }; } }));
  assert.equal(executed, 1); assert.equal(result.turns, 2); assert.equal(result.toolCalls, 1); assert.equal(result.status, 'completed');
  assert.deepEqual(result.usage, { input_tokens: 30, output_tokens: 7, total_tokens: 37 });
  const secondInput = requests[1].input as Row[];
  assert.equal((secondInput.at(-1) as Row).type, 'function_call_output');
  assert.equal((requests[1].tools as unknown[]).length, 1);
  assert.equal(requests[0].max_output_tokens, 100); assert.equal(requests[1].max_output_tokens, 97);
});

await run('Anthropic enabled thinking keeps each tool turn and the final turn above its configured budget', async () => {
  const requests: Row[] = []; let index = 0;
  const result = await runAssistantToolLoop(options(async serialized => {
    const request = JSON.parse(serialized) as Row; requests.push(request);
    if (index++ < 2) return messagesTurn(true, 5);
    return messagesTurn(false, 2);
  }, { protocol: 'messages', claudeThinking: { mode: 'enabled', budget_tokens: 1024 }, outputBudget: 3000 }));
  assert.equal(result.status, 'completed'); assert.equal(result.turns, 3);
  assert.deepEqual(requests.map(request => request.max_tokens), [1975, 1970, 2990]);
  assert.deepEqual(requests.map(request => request.thinking), [{ type: 'enabled', budget_tokens: 1024 }, { type: 'enabled', budget_tokens: 1024 }, { type: 'enabled', budget_tokens: 1024 }]);
  assert.equal(requests[0].tools instanceof Array, true); assert.equal(requests[1].tools instanceof Array, true); assert.equal('tools' in requests[2], false);
});

await run('when only one thinking budget remains, switch to final-only instead of failing continuation', async () => {
  const requests: Row[] = []; let index = 0;
  const result = await runAssistantToolLoop(options(async serialized => {
    const request = JSON.parse(serialized) as Row; requests.push(request);
    if (index++ === 0) return messagesTurn(true, 1025);
    return messagesTurn(false, 2);
  }, { protocol: 'messages', claudeThinking: { mode: 'enabled', budget_tokens: 1024 }, outputBudget: 3000 }));
  assert.equal(result.status, 'completed'); assert.equal(result.turns, 2);
  assert.equal('tools' in requests[1], false); assert.equal(requests[1].max_tokens, 1975);
});

await run('unknown calls receive bounded repair results while known calls execute', async () => {
  let executed = 0; let index = 0;
  const result = await runAssistantToolLoop(options(async () => index++ === 0 ? sse([
    { type: 'response.created', response: { id: 'r' } },
    { type: 'response.output_item.added', item: { id: 'bad', type: 'function_call', name: 'unknown', arguments: '{}' } },
    { type: 'response.output_item.added', item: { id: 'known', type: 'function_call', name: 'lookup', arguments: '{}' } },
    { type: 'response.completed', response: { status: 'completed', output: [{ id: 'bad', type: 'function_call', name: 'unknown', arguments: '{}' }, { id: 'known', type: 'function_call', name: 'lookup', arguments: '{}' }], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
  ]) : responsesFinal(), { execute: async () => { executed++; return {}; } }));
  assert.equal(executed, 1); assert.equal(result.turns, 2); assert.equal(result.toolCalls, 2);
});

await run('tool failures become safe results while cancellation propagates', async () => {
  let index = 0;
  const result = await runAssistantToolLoop(options(async () => index++ === 0 ? responsesCall() : responsesFinal(), { execute: async () => { throw new Error('provider secret must not leak'); } }));
  assert.equal(result.status, 'completed');
  const controller = new AbortController(); controller.abort();
  await assert.rejects(runAssistantToolLoop(options(async () => responsesFinal(), { signal: controller.signal })), { name: 'AbortError' });
});

await run('missing usage returns all-null accounting and never funds an additional turn', async () => {
  let dispatches = 0;
  const noUsage = sse([{ type: 'response.created', response: { id: 'r' } }, { type: 'response.output_item.added', item: { id: 'msg', type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'done' }] } }, { type: 'response.completed', response: { status: 'completed', output: [{ id: 'msg', type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'done' }] }] } }]);
  const result = await runAssistantToolLoop(options(async () => { dispatches++; return noUsage; }));
  assert.deepEqual(result.usage, { input_tokens: null, output_tokens: null, total_tokens: null });
  assert.equal(dispatches, 1);
});

await run('context and request limits fail before dispatch', async () => {
  let dispatches = 0;
  await assert.rejects(runAssistantToolLoop(options(async () => { dispatches++; return responsesFinal(); }, { maxInputTokens: 1 })), /context/);
  await assert.rejects(runAssistantToolLoop(options(async () => { dispatches++; return responsesFinal(); }, { maxRequestBytes: 1 })), /request_too_large/);
  assert.equal(dispatches, 0);
  assert.equal(ASSISTANT_TOOL_HISTORY_BYTES, 48_000); assert.equal(ASSISTANT_TOOL_MAX_TURNS, 3); assert.equal(ASSISTANT_TOOL_MAX_CALLS, 8);
});

await run('result and call limits preserve bounded ids', async () => {
  let index = 0; let calls = 0;
  const huge = 'x'.repeat(7000);
  const result = await runAssistantToolLoop(options(async () => index++ === 0 ? responsesCall('call_huge', '{"key":"x"}') : responsesFinal(), { execute: async () => { calls++; return { huge }; } }));
  assert.equal(calls, 1); assert.equal(result.status, 'completed');
});

console.log('Chat assistant tool loop: mocked SSE rounds, repair results, cancellation, conservative usage, shared output budget, context/request/result bounds passed.');
