// Run offline: deno test --no-config --no-lock tools/test-chat-assistant-plan.ts
// No network, environment, database, or deployment permissions are required.
import { strict as assert } from 'node:assert';
import {
  ASSISTANT_PLAN_BYTES,
  ASSISTANT_PLAN_EVIDENCE_BYTES,
  AssistantPlanError,
  assistantPlanBudget,
  parseAssistantReadPlan,
  runAssistantPlan,
  type AssistantReadPlan,
} from '../supabase/functions/_shared/chat-assistant-plan.ts';
import type { ChatProtocol } from '../supabase/functions/_shared/chat-protocol.ts';
import { assistantPlanPrompt, assistantPlanAnswerPrompt, type AssistantRelease } from '../supabase/functions/_shared/chat-assistant.ts';
import { ASSISTANT_READ_TOOLS } from '../supabase/functions/_shared/chat-assistant-tools.ts';

type Row = Record<string, unknown>;
type Options = Parameters<typeof runAssistantPlan>[0];
type Reply = (request: Row, signal: AbortSignal) => Response | Promise<Response>;
const encoder = new TextEncoder();
const protocols: ChatProtocol[] = ['responses', 'chat', 'messages'];
const common = { direction: 'desc', page: 1, page_size: 10 };
const member = { tool: 'read_member_points', arguments: { ...common, order_by: 'points', member_name: '小明', min_points: 0, max_points: 100 } };
const leaderboard = { tool: 'read_game_leaderboard', arguments: { ...common, board: 'gomoku', order_by: 'total_score', name: 'Player', min_score: '0', max_score: '9223372036854775807' } };
const published = { tool: 'read_published_content', arguments: { ...common, kind: 'events', order_by: 'starts_at', title_contains: '比赛', category: '比赛信息', status: '报名中', date_field: 'starts_at', after: '2026-10-01T00:00:00Z', before: '2026-11-01T00:00:00+08:00', id: '12345678-1234-1234-1234-123456789abc' } };
const queryPlan: AssistantReadPlan = { action: 'query', queries: [member, leaderboard] };
const answerPlan: AssistantReadPlan = { action: 'answer' };
const evidence: Row[] = [{ dataset: 'member_points', status: 'success', data: [{ member_name: '小明', points: 42 }] }];
const initialInput: Row[] = [{ role: 'user', content: [{ type: 'input_text', text: '查询公开积分' }] }];

function errorCode(code: string) {
  return (error: unknown) => error instanceof AssistantPlanError && error.message === code;
}
function sse(events: Row[], done = true): Response {
  const bytes = encoder.encode(events.map(event => `data: ${JSON.stringify(event)}\r\n\r\n`).join('') + (done ? 'data: [DONE]\r\n\r\n' : ''));
  // Fragment CRLF, JSON, and multibyte Chinese text as a real transport may do.
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += 7) controller.enqueue(bytes.slice(offset, offset + 7));
      controller.close();
    },
  }), { headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
}
function textTurn(protocol: ChatProtocol, text: string, inputTokens = 10, outputTokens: number | null = 7, withUsage = true): Response {
  if (protocol === 'responses') return sse([
    { type: 'response.output_text.delta', delta: text },
    { type: 'response.completed', response: { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }], ...(withUsage ? { usage: { input_tokens: inputTokens, output_tokens: outputTokens, total_tokens: outputTokens === null ? null : inputTokens + outputTokens } } : {}) } },
  ]);
  if (protocol === 'chat') return sse([
    { choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: 'stop' }] },
    ...(withUsage ? [{ choices: [], usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens, total_tokens: outputTokens === null ? null : inputTokens + outputTokens } }] : []),
  ]);
  return sse([
    { type: 'message_start', message: { usage: { input_tokens: inputTokens, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: outputTokens } },
    { type: 'message_stop' },
  ]);
}
function nativeTurn(protocol: ChatProtocol): Response {
  if (protocol === 'responses') return sse([{ type: 'response.completed', response: { output: [{ type: 'function_call', call_id: 'native', name: member.tool, arguments: JSON.stringify(member.arguments) }], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } }]);
  if (protocol === 'chat') return sse([
    { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'native', type: 'function', function: { name: member.tool, arguments: JSON.stringify(member.arguments) } }] }, finish_reason: 'tool_calls' }] },
    { choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
  ]);
  return sse([
    { type: 'message_start', message: { usage: { input_tokens: 1, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'native', name: member.tool, input: member.arguments } },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 1 } },
    { type: 'message_stop' },
  ]);
}
function fixture(replies: Reply[], overrides: Partial<Options> = {}) {
  const requests: Row[] = [], dispatchSignals: AbortSignal[] = [];
  const executions: Array<{ plan: AssistantReadPlan; signal: AbortSignal }> = [];
  const answerInputs: Array<{ plan: AssistantReadPlan; evidence: Row[] }> = [];
  const options: Options = {
    protocol: 'responses', body: { model: 'mock-only', input: structuredClone(initialInput), stream: true, store: false },
    claudeThinking: undefined, signal: new AbortController().signal,
    maxRequestBytes: 100_000, maxInputTokens: 100_000, outputBudget: 100,
    estimate: () => 10,
    ...overrides,
    dispatch: async (serialized, signal) => {
      const request = JSON.parse(serialized) as Row;
      requests.push(request); dispatchSignals.push(signal);
      const reply = replies[requests.length - 1];
      assert.ok(reply, 'unexpected upstream dispatch');
      return await reply(request, signal);
    },
    execute: async (plan, signal) => {
      executions.push({ plan: structuredClone(plan), signal });
      return overrides.execute ? await overrides.execute(plan, signal) : structuredClone(evidence);
    },
    answerInput: (plan, rows) => {
      answerInputs.push({ plan: structuredClone(plan), evidence: structuredClone(rows) });
      return overrides.answerInput ? overrides.answerInput(plan, rows) : [
        ...structuredClone(initialInput),
        { role: 'user', content: [{ type: 'input_text', text: JSON.stringify({ plan, evidence: rows }) }] },
      ];
    },
  };
  return { requests, dispatchSignals, executions, answerInputs, run: () => runAssistantPlan(options) };
}
function assertNoNativeTools(requests: Row[]) {
  for (const request of requests) {
    for (const key of ['tools', 'tool_choice', 'functions', 'function_call', 'parallel_tool_calls']) assert.equal(Object.hasOwn(request, key), false, key);
    const input = (request.input ?? request.messages) as Row[];
    assert.ok(Array.isArray(input));
    for (const item of input) {
      assert.notEqual(item.role, 'tool');
      assert.equal(Object.hasOwn(item, 'tool_calls'), false);
      assert.equal(Object.hasOwn(item, 'tool_call_id'), false);
      for (const part of item.content as Row[]) assert.ok(['input_text', 'output_text', 'text'].includes(String(part.type)));
    }
  }
}
function assertStopped(f: ReturnType<typeof fixture>, dispatches: number, executions = 0, answerInputs = 0) {
  assert.equal(f.requests.length, dispatches);
  assert.equal(f.executions.length, executions);
  assert.equal(f.answerInputs.length, answerInputs);
}

for (const read of [member, leaderboard, published]) {
  Deno.test(`parse accepts ${read.tool} with its existing arguments`, () => {
    const plan = { action: 'query', queries: [read] };
    assert.deepEqual(parseAssistantReadPlan(JSON.stringify(plan)), plan);
  });
}
Deno.test('parse accepts answer, clarify, and a two-query plan', () => {
  for (const plan of [answerPlan, { action: 'clarify', question: '请问是哪一个排行榜？' }, queryPlan]) {
    assert.deepEqual(parseAssistantReadPlan(` \n${JSON.stringify(plan)}\t`), plan);
  }
  const announcements = { ...published, arguments: { ...common, kind: 'announcements', order_by: 'default' } };
  const versus = { ...leaderboard, arguments: { ...common, board: 'snake_versus', order_by: 'high_score', min_score: '-5', max_score: '0' } };
  const plan = { action: 'query', queries: [announcements, versus] };
  assert.deepEqual(parseAssistantReadPlan(JSON.stringify(plan)), plan);
});

const invalidPlans: Array<[string, unknown, string]> = [
  ['null', null, 'assistant_plan_invalid'],
  ['array', [], 'assistant_plan_invalid'],
  ['primitive', 'answer', 'assistant_plan_invalid'],
  ['missing action', {}, 'assistant_plan_invalid'],
  ['unknown action', { action: 'execute' }, 'assistant_plan_invalid'],
  ['answer extra key', { action: 'answer', question: 'extra' }, 'assistant_plan_invalid'],
  ['clarify extra key', { action: 'clarify', question: 'Which?', queries: [] }, 'assistant_plan_invalid'],
  ['clarify missing question', { action: 'clarify' }, 'assistant_plan_invalid'],
  ['clarify non-string question', { action: 'clarify', question: 3 }, 'assistant_plan_invalid'],
  ['clarify blank question', { action: 'clarify', question: ' \t' }, 'assistant_plan_invalid'],
  ['clarify long question', { action: 'clarify', question: 'x'.repeat(501) }, 'assistant_plan_invalid'],
  ['clarify control character', { action: 'clarify', question: 'Which?\n' }, 'assistant_plan_invalid'],
  ['query extra key', { ...queryPlan, execute: true }, 'assistant_plan_invalid'],
  ['queries missing', { action: 'query' }, 'assistant_plan_invalid'],
  ['queries object', { action: 'query', queries: member }, 'assistant_plan_invalid'],
  ['queries empty', { action: 'query', queries: [] }, 'assistant_plan_invalid'],
  ['queries more than two', { action: 'query', queries: [member, leaderboard, published] }, 'assistant_plan_invalid'],
  ['null query', { action: 'query', queries: [null] }, 'assistant_plan_invalid'],
  ['query extra field', { action: 'query', queries: [{ ...member, id: 'extra' }] }, 'assistant_plan_invalid'],
  ['query missing arguments', { action: 'query', queries: [{ tool: member.tool }] }, 'assistant_plan_invalid'],
  ['non-string tool', { action: 'query', queries: [{ ...member, tool: 1 }] }, 'assistant_plan_invalid'],
  ['array arguments', { action: 'query', queries: [{ ...member, arguments: [] }] }, 'assistant_plan_invalid'],
  ['null arguments', { action: 'query', queries: [{ ...member, arguments: null }] }, 'assistant_plan_invalid'],
  ['unknown tool', { action: 'query', queries: [{ ...member, tool: 'read_private_users' }] }, 'assistant_plan_arguments'],
];
for (const [name, value, code] of invalidPlans) {
  Deno.test(`parse rejects ${name}`, () => assert.throws(() => parseAssistantReadPlan(JSON.stringify(value)), errorCode(code)));
}
for (const text of ['', '{broken', '{"action":"answer",}', '{"action":"answer"} {"action":"answer"}', 'no object here']) {
  Deno.test(`parse rejects non-JSON plan ${JSON.stringify(text)}`, () => assert.throws(() => parseAssistantReadPlan(text), errorCode('assistant_plan_json')));
}
for (const text of ['null', '[]']) {
  Deno.test(`parse rejects valid non-object JSON plan ${text}`, () => assert.throws(() => parseAssistantReadPlan(text), errorCode('assistant_plan_invalid')));
}
for (const text of ['```json\n{"action":"answer"}\n```', 'Here is the plan: {"action":"answer"}', ' {"action":"answer"} ']) {
  Deno.test(`parse recovers one wrapped plan ${JSON.stringify(text)}`, () => assert.deepEqual(parseAssistantReadPlan(text), answerPlan));
}
const invalidArgs: Array<[string, { tool: string; arguments: Row }, Row]> = [
  ['missing required fields', member, {}],
  ['extra argument', member, { ...member.arguments, sql: 'select * from users' }],
  ['page below bound', member, { ...member.arguments, page: 0 }],
  ['page above bound', member, { ...member.arguments, page: 101 }],
  ['fractional page', member, { ...member.arguments, page: 1.5 }],
  ['string page', member, { ...member.arguments, page: '1' }],
  ['oversized page', member, { ...member.arguments, page_size: 51 }],
  ['invalid direction', member, { ...member.arguments, direction: 'sideways' }],
  ['invalid member order', member, { ...member.arguments, order_by: 'id' }],
  ['reversed points', member, { ...member.arguments, min_points: 101 }],
  ['unknown board', leaderboard, { ...leaderboard.arguments, board: 'users' }],
  ['cross-board order', leaderboard, { ...leaderboard.arguments, order_by: 'high_score' }],
  ['numeric score', leaderboard, { ...leaderboard.arguments, min_score: 0 }],
  ['noncanonical score', leaderboard, { ...leaderboard.arguments, min_score: '01' }],
  ['overflow score', leaderboard, { ...leaderboard.arguments, max_score: '9223372036854775808' }],
  ['unknown content kind', published, { ...published.arguments, kind: 'drafts' }],
  ['announcement status', published, { ...published.arguments, kind: 'announcements' }],
  ['invalid UUID', published, { ...published.arguments, id: 'not-a-uuid' }],
  ['date without timezone', published, { ...published.arguments, after: '2026-10-01T00:00:00' }],
  ['reversed dates', published, { ...published.arguments, after: '2026-12-01T00:00:00Z' }],
];
for (const [name, read, args] of invalidArgs) {
  Deno.test(`parse validates read arguments: ${name}`, () => {
    assert.throws(() => parseAssistantReadPlan(JSON.stringify({ action: 'query', queries: [{ tool: read.tool, arguments: args }] })), errorCode('assistant_plan_arguments'));
  });
}
Deno.test('parse enforces UTF-8 byte limit and budget reserves evidence for the answer', () => {
  const text = JSON.stringify(answerPlan);
  assert.deepEqual(parseAssistantReadPlan(text + ' '.repeat(ASSISTANT_PLAN_BYTES - encoder.encode(text).length)), answerPlan);
  assert.throws(() => parseAssistantReadPlan(text + ' '.repeat(ASSISTANT_PLAN_BYTES)), errorCode('assistant_plan_size'));
  const multibyte = JSON.stringify({ action: 'clarify', question: '棋'.repeat(3000) });
  assert.ok(multibyte.length < ASSISTANT_PLAN_BYTES);
  assert.throws(() => parseAssistantReadPlan(multibyte), errorCode('assistant_plan_size'));
  assert.deepEqual(assistantPlanBudget(100), { perTurnInputTokens: 9530, reservedInputTokens: 10654 });
});

for (const protocol of protocols) {
  Deno.test(`${protocol}: two text-only calls share usage/output budget and pass query evidence`, async () => {
    const order: string[] = [];
    const f = fixture([
      () => { order.push('plan'); return textTurn(protocol, JSON.stringify(queryPlan)); },
      () => { order.push('answer'); return textTurn(protocol, '小明有 42 分。', 20, 11); },
    ], { protocol, execute: async (plan, signal) => {
      order.push('execute'); assert.deepEqual(plan, queryPlan); assert.equal(signal.aborted, false);
      return structuredClone(evidence);
    }, answerInput: (plan, rows) => {
      order.push('answerInput'); assert.deepEqual(plan, queryPlan); assert.deepEqual(rows, evidence);
      return [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify(rows) }] }];
    } });
    const result = await f.run();
    assert.deepEqual(order, ['plan', 'execute', 'answerInput', 'answer']);
    assertStopped(f, 2, 1, 1);
    assert.equal(result.status, 'completed');
    assert.deepEqual(result.usage, { input_tokens: 30, output_tokens: 18, total_tokens: 48 });
    const budgetKey = protocol === 'responses' ? 'max_output_tokens' : protocol === 'chat' ? 'max_completion_tokens' : 'max_tokens';
    assert.deepEqual(f.requests.map(request => request[budgetKey]), [50, 93]);
    assertNoNativeTools(f.requests);
    assert.match(JSON.stringify(f.requests[1]), /小明/);
    assert.deepEqual(f.answerInputs, [{ plan: queryPlan, evidence }]);
    assert.equal(f.dispatchSignals[0], f.dispatchSignals[1]);
    assert.equal(f.executions[0].signal, f.dispatchSignals[0]);
    const visible = JSON.stringify(result.events);
    assert.match(visible, /小明有 42 分/);
    assert.doesNotMatch(visible, /read_member_points|read_game_leaderboard/);
    assert.equal(result.events.filter(event => event.type === 'response.completed').length, 1);
  });
  for (const plan of [answerPlan, { action: 'clarify', question: '哪个排行榜？' } as const]) {
    Deno.test(`${protocol}: ${plan.action} uses two calls and never executes reads`, async () => {
      const f = fixture([() => textTurn(protocol, JSON.stringify(plan)), () => textTurn(protocol, '回答或澄清', 20, 11)], { protocol });
      const result = await f.run();
      assertStopped(f, 2, 0, 1);
      assert.deepEqual(f.answerInputs, [{ plan, evidence: [] }]);
      assert.equal(result.status, 'completed');
      assertNoNativeTools(f.requests);
    });
  }
  for (const stage of ['plan', 'answer'] as const) {
    Deno.test(`${protocol}: refuses native tool calls in ${stage} without executing them`, async () => {
      const f = fixture(stage === 'plan' ? [() => nativeTurn(protocol)] : [() => textTurn(protocol, JSON.stringify(answerPlan)), () => nativeTurn(protocol)], { protocol });
      await assert.rejects(f.run(), errorCode(`assistant_${stage}_stream`));
      assertStopped(f, stage === 'plan' ? 1 : 2, 0, stage === 'plan' ? 0 : 1);
      assertNoNativeTools(f.requests);
    });
  }
  Deno.test(`${protocol}: missing planning output usage prevents execution and final dispatch`, async () => {
    const f = fixture([() => textTurn(protocol, JSON.stringify(queryPlan), 10, null)], { protocol });
    await assert.rejects(f.run(), errorCode('assistant_plan_usage'));
    assertStopped(f, 1);
  });
  Deno.test(`${protocol}: missing final output usage returns conservative null accounting`, async () => {
    const f = fixture([() => textTurn(protocol, JSON.stringify(answerPlan)), () => textTurn(protocol, 'answer', 20, null)], { protocol });
    const result = await f.run();
    assert.deepEqual(result.usage, { input_tokens: null, output_tokens: null, total_tokens: null });
    assertStopped(f, 2, 0, 1);
  });
}

for (const [name, text, code] of [
  ['malformed JSON', '{broken', 'assistant_plan_json'],
  ['multiple JSON objects', '{"action":"answer"} {"action":"answer"}', 'assistant_plan_json'],
  ['invalid later query', JSON.stringify({ action: 'query', queries: [member, { ...leaderboard, arguments: { ...leaderboard.arguments, page: 0 } }] }), 'assistant_plan_arguments'],
  ['unknown later tool', JSON.stringify({ action: 'query', queries: [member, { ...leaderboard, tool: 'delete_users' }] }), 'assistant_plan_arguments'],
] as const) {
  Deno.test(`run converts ${name} into an honest answer with no reads`, async () => {
    const f = fixture([() => textTurn('responses', text), () => textTurn('responses', 'could not complete this lookup')]);
    const result = await f.run();
    assert.equal(result.status, 'completed');
    assertStopped(f, 2, 0, 1);
    assert.deepEqual(f.answerInputs[0].plan, { action: 'error', error: code });
    assert.equal(f.answerInputs[0].evidence.length, 0);
  });
}
Deno.test('run accepts a fenced plan and still executes no more than the validated reads', async () => {
  const f = fixture([() => textTurn('responses', '```json\n' + JSON.stringify(answerPlan) + '\n```'), () => textTurn('responses', 'answer')]);
  assert.equal((await f.run()).status, 'completed');
  assertStopped(f, 2, 0, 1);
});
Deno.test('Responses planning falls back to text deltas when terminal output is absent', async () => {
  const f = fixture([
    () => sse([{ type: 'response.output_text.delta', delta: '{"action":' }, { type: 'response.output_text.delta', delta: '"answer"}' }, { type: 'response.completed', response: { usage: { input_tokens: 10, output_tokens: 7, total_tokens: 17 } } }]),
    () => textTurn('responses', 'answer'),
  ]);
  assert.equal((await f.run()).status, 'completed');
  assertStopped(f, 2, 0, 1);
});

const upstreamFailures: Array<[string, Reply, string]> = [
  ['network rejection', () => { throw new Error('mock transport failure'); }, 'network'],
  ['HTTP failure', () => new Response('unavailable', { status: 503 }), 'http'],
  ['missing body', () => new Response(null, { headers: { 'content-type': 'text/event-stream' } }), 'http'],
  ['wrong content type', () => new Response('{}', { headers: { 'content-type': 'application/json' } }), 'http'],
  ['missing terminal', () => sse([{ type: 'response.output_text.delta', delta: '{"action":"answer"}' }]), 'stream'],
  ['upstream error event', () => sse([{ type: 'error', error: { message: 'mock failure' } }]), 'stream'],
  ['failed terminal', () => sse([{ type: 'response.failed', response: { status: 'failed' } }]), 'stream'],
  ['incomplete terminal', () => sse([{ type: 'response.incomplete', response: { status: 'incomplete', output: [], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } }]), 'stream'],
];
for (const [name, reply, suffix] of upstreamFailures) {
  for (const stage of ['plan', 'answer'] as const) {
    if (name === 'incomplete terminal' && stage === 'answer') continue;
    Deno.test(`${stage}: ${name} fails closed`, async () => {
      const f = fixture(stage === 'plan' ? [reply] : [() => textTurn('responses', JSON.stringify(answerPlan)), reply]);
      await assert.rejects(f.run(), errorCode(`assistant_${stage}_${suffix}`));
      assertStopped(f, stage === 'plan' ? 1 : 2, 0, stage === 'plan' ? 0 : 1);
    });
  }
}
Deno.test('answer: an incomplete terminal is preserved as a visible partial answer', async () => {
  const f = fixture([() => textTurn('responses', JSON.stringify(answerPlan)), () => sse([{ type: 'response.incomplete', response: { status: 'incomplete', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'partial answer' }] }], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } }])]);
  const result = await f.run();
  assert.equal(result.status, 'incomplete');
  assert.match(JSON.stringify(result.events), /partial answer/);
  assertStopped(f, 2, 0, 1);
});
Deno.test('wholly missing planning usage fails before executing queries', async () => {
  const f = fixture([() => textTurn('responses', JSON.stringify(queryPlan), 10, 7, false)]);
  await assert.rejects(f.run(), errorCode('assistant_plan_usage'));
  assertStopped(f, 1);
});
for (const [stage, outputTokens] of [['plan', 51], ['answer', 94]] as const) {
  Deno.test(`${stage}: output above the shared allowance rejects the run`, async () => {
    const f = fixture(stage === 'plan'
      ? [() => textTurn('responses', JSON.stringify(queryPlan), 10, outputTokens)]
      : [() => textTurn('responses', JSON.stringify(answerPlan)), () => textTurn('responses', 'too much', 20, outputTokens)]);
    await assert.rejects(f.run(), errorCode('assistant_output_budget'));
    assertStopped(f, stage === 'plan' ? 1 : 2, 0, stage === 'plan' ? 0 : 1);
  });
}
Deno.test('insufficient shared output budget prevents the planning dispatch', async () => {
  const f = fixture([], { outputBudget: 1 });
  await assert.rejects(f.run(), errorCode('assistant_output_budget'));
  assertStopped(f, 0);
});
Deno.test('planning disables Claude thinking and reserves configured thinking for the answer', async () => {
  const f = fixture([
    () => textTurn('messages', JSON.stringify(answerPlan), 10, 7),
    () => textTurn('messages', 'answer', 20, 1025),
  ], { protocol: 'messages', claudeThinking: { mode: 'enabled', budget_tokens: 1024 }, outputBudget: 1100 });
  assert.equal((await f.run()).status, 'completed');
  assert.deepEqual(f.requests.map(request => request.max_tokens), [75, 1093]);
  assert.deepEqual(f.requests[0].thinking, { type: 'disabled' });
  assert.deepEqual(f.requests[1].thinking, { type: 'enabled', budget_tokens: 1024 });
  const insufficient = fixture([], { protocol: 'messages', claudeThinking: { mode: 'enabled', budget_tokens: 1024 }, outputBudget: 1025 });
  await assert.rejects(insufficient.run(), errorCode('assistant_output_budget'));
  assertStopped(insufficient, 0);
});
for (const [name, overrides, code] of [
  ['context', { maxInputTokens: 0, estimate: () => 101 }, 'assistant_context'],
  ['request bytes', { maxRequestBytes: 1 }, 'assistant_request_size'],
] as Array<[string, Partial<Options>, string]>) {
  Deno.test(`${name} limit prevents initial dispatch`, async () => {
    const f = fixture([], overrides);
    await assert.rejects(f.run(), errorCode(code));
    assertStopped(f, 0);
  });
}
Deno.test('final context limit is checked again with evidence-bearing input', async () => {
  const f = fixture([() => textTurn('responses', JSON.stringify(queryPlan))], { maxInputTokens: 100, estimate: input => input.length === 1 ? 10 : 1000 });
  await assert.rejects(f.run(), errorCode('assistant_context'));
  assertStopped(f, 1, 1, 1);
});
Deno.test('oversized UTF-8 evidence prevents answer input and final dispatch', async () => {
  const rows = [{ text: '棋'.repeat(Math.ceil(ASSISTANT_PLAN_EVIDENCE_BYTES / 3)) }];
  assert.ok(JSON.stringify(rows).length < ASSISTANT_PLAN_EVIDENCE_BYTES);
  const f = fixture([() => textTurn('responses', JSON.stringify(queryPlan))], { execute: async () => rows });
  await assert.rejects(f.run(), errorCode('assistant_evidence_size'));
  assertStopped(f, 1, 1);
});
Deno.test('execution failure propagates without a final dispatch', async () => {
  const failure = new Error('mock database failure');
  const f = fixture([() => textTurn('responses', JSON.stringify(queryPlan))], { execute: async () => { throw failure; } });
  await assert.rejects(f.run(), error => error === failure);
  assertStopped(f, 1, 1);
});

Deno.test('already cancelled run never dispatches or executes', async () => {
  const controller = new AbortController(); controller.abort();
  const f = fixture([], { signal: controller.signal });
  await assert.rejects(f.run(), { name: 'AbortError' });
  assertStopped(f, 0);
});
Deno.test('cancellation during dispatch propagates the linked signal', async () => {
  const controller = new AbortController();
  const f = fixture([(_request, signal) => new Promise<Response>((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('mock cancelled transport')), { once: true });
    controller.abort();
  })], { signal: controller.signal });
  await assert.rejects(f.run(), { name: 'AbortError' });
  assertStopped(f, 1);
  assert.equal(f.dispatchSignals[0].aborted, true);
});
for (const stage of ['plan', 'answer'] as const) {
  Deno.test(`cancellation while reading ${stage} SSE cancels the reader and prevents continuation`, async () => {
    const controller = new AbortController(); let cancelled = false;
    const stalled: Reply = () => new Response(new ReadableStream<Uint8Array>({
      pull() { controller.abort(); },
      cancel() { cancelled = true; },
    }), { headers: { 'content-type': 'text/event-stream' } });
    const f = fixture(stage === 'plan' ? [stalled] : [() => textTurn('responses', JSON.stringify(answerPlan)), stalled], { signal: controller.signal });
    await assert.rejects(f.run(), { name: 'AbortError' });
    assertStopped(f, stage === 'plan' ? 1 : 2, 0, stage === 'plan' ? 0 : 1);
    assert.equal(cancelled, true);
    assert.ok(f.dispatchSignals.every(signal => signal.aborted));
  });
}
Deno.test('cancellation during query execution prevents final dispatch', async () => {
  const controller = new AbortController(); let executionSignal: AbortSignal | undefined;
  const f = fixture([() => textTurn('responses', JSON.stringify(queryPlan))], {
    signal: controller.signal,
    execute: (_plan, signal) => new Promise((_resolve, reject) => {
      executionSignal = signal;
      signal.addEventListener('abort', () => reject(new DOMException('mock cancelled read', 'AbortError')), { once: true });
      controller.abort();
    }),
  });
  await assert.rejects(f.run(), { name: 'AbortError' });
  assertStopped(f, 1, 1);
  assert.equal(executionSignal?.aborted, true);
});

Deno.test('static facts beyond citation excerpts reach the answer with stable source IDs', () => {
  const fact = 'Membership fee is 42 tokens.';
  const release: AssistantRelease = { id: 'release', config: { enabled: true, model_id: null, system_prompt: '', welcome: '', suggestions: [], version: 1, current_release_id: null }, documents: [
    { slug: 'membership', title: 'Membership', category: 'club', language: 'en', source_path: '/public/join.html', keywords: ['membership'], content: 'Membership '.repeat(25) + fact }
  ] };
  const conversation = [{ role: 'user', content: [{ type: 'input_text', text: 'Membership fee?' }] }];
  const prepared = assistantPlanPrompt(release, conversation, ASSISTANT_READ_TOOLS);
  assert.doesNotMatch(prepared.sources[0].excerpt, /42 tokens/);
  const input = assistantPlanAnswerPrompt(release, conversation, { action: 'answer', evidence: [], static_references: JSON.parse(prepared.knowledge) }).input;
  assert.match(JSON.stringify(input), /Membership fee is 42 tokens/);
  assert.match(JSON.stringify(input), /S1/);
});
Deno.test('cancellation releases a stalled dispatch and closes a response that arrives late', async () => {
  const controller = new AbortController();
  let resolve!: (value: Response) => void;
  let cancelled = false;
  const f = fixture([() => new Promise<Response>(done => { resolve = done; queueMicrotask(() => controller.abort()); })], { signal: controller.signal });
  await assert.rejects(f.run(), { name: 'AbortError' });
  resolve(new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'content-type': 'text/event-stream' } }));
  await Promise.resolve(); await Promise.resolve();
  assert.equal(cancelled, true);
  assertStopped(f, 1);
});
Deno.test('valid high Claude thinking budget needs only one thinking allocation', async () => {
  const f = fixture([
    () => textTurn('messages', JSON.stringify(answerPlan), 10, 7),
    () => textTurn('messages', 'answer', 20, 3073),
  ], { protocol: 'messages', claudeThinking: { mode: 'enabled', budget_tokens: 3072 }, outputBudget: 4096 });
  assert.equal((await f.run()).status, 'completed');
  assert.deepEqual(f.requests.map(request => request.max_tokens), [1023, 4089]);
});
