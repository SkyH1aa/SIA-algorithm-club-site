import { protocolRequest, type ChatProtocol } from '../_shared/chat-protocol.ts';
import { collectAssistantToolTurn } from '../_shared/chat-assistant-tool-protocol.ts';
import { validateAssistantReadPlan } from '../_shared/chat-assistant-tools.ts';

type apJson = Record<string, unknown>;
type apUsage = { input_tokens: number | null; output_tokens: number | null; total_tokens: number | null };
export type AssistantReadPlan = { action: 'query'; queries: { tool: string; arguments: apJson }[] } | { action: 'clarify'; question: string } | { action: 'answer' } | { action: 'error'; error: string };
const apEncoder = new TextEncoder();
export const ASSISTANT_PLAN_BYTES = 8192;
export const ASSISTANT_PLAN_EVIDENCE_BYTES = 16000;
export class AssistantPlanError extends Error {}
function apFail(code: string): never { throw new AssistantPlanError(code); }
function apRecord(value: unknown): value is apJson { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function apAbort(): DOMException { return new DOMException('Aborted', 'AbortError'); }
function apRace<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) { void pending.catch(() => undefined); return Promise.reject(apAbort()); }
  return new Promise<T>((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(apAbort()); };
    signal.addEventListener('abort', abort, { once: true });
    pending.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}
function apKeys(value: apJson, keys: string[]) { if (Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) apFail('assistant_plan_invalid'); }
function apPlanText(text: string): string {
  const trimmed = text.trim();
  // A bare JSON value stays authoritative so null/[] remain invalid plans.
  try { JSON.parse(trimmed); return trimmed; } catch { /* Recover one wrapped object. */ }
  // Models often wrap the single required object in a fenced block or a short
  // sentence. Recover exactly one balanced object; multiple objects stay invalid.
  const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i.exec(trimmed);
  const candidate = (fenced ? fenced[1] : trimmed).trim();
  const start = candidate.indexOf('{');
  if (start < 0) apFail('assistant_plan_json');
  let depth = 0, inString = false, escaped = false, end = -1;
  for (let index = start; index < candidate.length; index++) {
    const char = candidate[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) { end = index; break; }
  }
  if (end < 0) apFail('assistant_plan_json');
  const extracted = candidate.slice(start, end + 1);
  if (candidate.slice(end + 1).trim()) apFail('assistant_plan_json');
  return extracted;
}
export function parseAssistantReadPlan(text: string): AssistantReadPlan {
  if (apEncoder.encode(text).length > ASSISTANT_PLAN_BYTES) apFail('assistant_plan_size');
  let value: unknown;
  try { value = JSON.parse(apPlanText(text)); } catch (error) { if (error instanceof AssistantPlanError) throw error; apFail('assistant_plan_json'); }
  if (!apRecord(value)) apFail('assistant_plan_invalid');
  if (value.action === 'answer') { apKeys(value, ['action']); return { action: 'answer' }; }
  if (value.action === 'clarify') {
    apKeys(value, ['action', 'question']);
    if (typeof value.question !== 'string' || !value.question.trim() || value.question.length > 500 || /[\u0000-\u001f\u007f]/.test(value.question)) apFail('assistant_plan_invalid');
    return { action: 'clarify', question: value.question };
  }
  if (value.action !== 'query') apFail('assistant_plan_invalid');
  apKeys(value, ['action', 'queries']);
  if (!Array.isArray(value.queries) || value.queries.length < 1 || value.queries.length > 2) apFail('assistant_plan_invalid');
  const queries = value.queries.map(query => {
    if (!apRecord(query)) apFail('assistant_plan_invalid');
    apKeys(query, ['tool', 'arguments']);
    if (typeof query.tool !== 'string' || !apRecord(query.arguments)) apFail('assistant_plan_invalid');
    try { validateAssistantReadPlan(query.tool, query.arguments); } catch { apFail('assistant_plan_arguments'); }
    return { tool: query.tool, arguments: query.arguments };
  });
  return { action: 'query', queries };
}

export const ASSISTANT_PLAN_MAX_REQUESTS = 2;

function apVisibleText(events: apJson[]): string {
  const deltas = events.filter(event => event.type === 'response.output_text.delta')
    .map(event => typeof event.delta === 'string' ? event.delta : '').join('');
  if (deltas.trim()) return deltas;
  return events.flatMap(event => {
    if (!['response.completed', 'response.incomplete'].includes(String(event.type)) || !apRecord(event.response) || !Array.isArray(event.response.output)) return [];
    return event.response.output.flatMap(item => apRecord(item) && Array.isArray(item.content) ? item.content : []);
  }).filter(apRecord).filter(part => part.type === 'output_text')
    .map(part => typeof part.text === 'string' ? part.text : '').join('');
}
function apAnswerFallback(input: apJson[]): string {
  const firstUser = input.find(item => item.role === 'user');
  const texts = (firstUser && Array.isArray(firstUser.content) ? firstUser.content : [])
    .filter(apRecord).map(part => typeof part.text === 'string' ? part.text : '');
  const chinese = /[\u3400-\u9fff]/.test(texts.join(' '));
  return chinese ? '抱歉，我未能生成可见答复。' : 'Sorry, I could not produce a visible answer.';
}
function apEnsureVisibleAnswer(events: apJson[], input: apJson[]): apJson[] {
  if (apVisibleText(events).trim()) return events;
  const fallback = apAnswerFallback(input);
  const terminalIndex = events.findIndex(event => event.type === 'response.completed' || event.type === 'response.incomplete');
  if (terminalIndex < 0) return events;
  const result = events.filter(event => event.type !== 'response.output_text.delta');
  const finalTerminalIndex = result.findIndex(event => event.type === 'response.completed' || event.type === 'response.incomplete');
  const terminal = result[finalTerminalIndex], response = apRecord(terminal.response) ? { ...terminal.response } : {};
  const output = Array.isArray(response.output) ? response.output.map(item => {
    if (!apRecord(item) || item.type !== 'message') return item;
    return { ...item, content: Array.isArray(item.content) ? item.content.map(part =>
      apRecord(part) && part.type === 'output_text' ? { ...part, text: fallback } : part) : [{ type: 'output_text', text: fallback }] };
  }) : [];
  response.output = output;
  result[finalTerminalIndex] = { ...terminal, response };
  result.splice(finalTerminalIndex, 0, { type: 'response.output_text.delta', delta: fallback });
  return result;
}

export function assistantPlanBudget(inputTokens: number) {
  // One planning call, then the answer call carrying bounded evidence.
  const perTurnInputTokens = inputTokens + Math.ceil(ASSISTANT_PLAN_EVIDENCE_BYTES / 3) + 4096;
  return { perTurnInputTokens, reservedInputTokens: perTurnInputTokens + inputTokens + 1024 };
}

export async function runAssistantPlan(options: {
  protocol: ChatProtocol; body: apJson; claudeThinking: unknown; signal: AbortSignal;
  maxRequestBytes: number; maxInputTokens: number; outputBudget: number;
  estimate: (input: apJson[]) => number;
  dispatch: (serialized: string, signal: AbortSignal) => Promise<Response>;
  execute: (plan: AssistantReadPlan, signal: AbortSignal) => Promise<apJson[]>;
  answerInput: (plan: AssistantReadPlan, evidence: apJson[]) => apJson[];
}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal.addEventListener('abort', abort, { once: true });
  if (options.signal.aborted) controller.abort();
  const timer = setTimeout(abort, 120000);
  let used = 0, usageComplete = true;
  const usage: apUsage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  const thinking = apRecord(options.claudeThinking) ? options.claudeThinking : {};
  const minimum = options.protocol === 'messages' && thinking.mode === 'enabled' ? Number(thinking.budget_tokens) + 1 : 1;
  const turn = async (input: apJson[], stage: 'plan' | 'answer') => {
    if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const remaining = options.outputBudget - used;
    // Planning keeps the answer's thinking minimum and at most half of the
    // remaining budget, so a verbose plan cannot starve the final answer.
    const maximum = stage === 'plan' ? Math.min(remaining - minimum, 4096, Math.floor(remaining / 2)) : remaining;
    if (maximum < (stage === 'plan' ? 1 : minimum)) apFail('assistant_output_budget');
    if (options.estimate(input) + maximum > options.maxInputTokens + options.outputBudget) apFail('assistant_context');
    const stageBody: apJson = { ...options.body, input, max_output_tokens: maximum };
    if (stage === 'plan') { delete stageBody.reasoning; delete stageBody.include; }
    const serialized = JSON.stringify(protocolRequest(options.protocol, stageBody,
      stage === 'plan' && options.protocol === 'messages' ? { mode: 'disabled' } : options.claudeThinking));
    if (apEncoder.encode(serialized).length > options.maxRequestBytes) apFail('assistant_request_size');
    let response: Response;
    try {
      response = await apRace(options.dispatch(serialized, controller.signal).then(value => {
        if (controller.signal.aborted) { void value.body?.cancel().catch(() => undefined); throw apAbort(); }
        return value;
      }), controller.signal);
    }
    catch (error) { if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError'); if (error instanceof AssistantPlanError || error instanceof Error && error.message === 'database') throw error; apFail(`assistant_${stage}_network`); }
    if (!response.ok || !response.body || !/^text\/event-stream(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) {
      void response.body?.cancel().catch(() => undefined); apFail(`assistant_${stage}_http`);
    }
    const result = await collectAssistantToolTurn(options.protocol, response.body, controller.signal);
    if (result.status === 'failed' || result.calls.length || !result.events.length) apFail(`assistant_${stage}_stream`);
    // A truncated answer is still shown as incomplete; a truncated plan cannot
    // be trusted or repaired, because its remaining budget is already consumed.
    if (stage === 'plan' && result.status !== 'completed') apFail('assistant_plan_stream');
    const output = result.usage.output_tokens;
    if (output !== null && output > maximum) apFail('assistant_output_budget');
    if (output === null && stage === 'plan') apFail('assistant_plan_usage');
    used += output ?? remaining;
    for (const key of ['input_tokens', 'output_tokens', 'total_tokens'] as const) {
      const value = result.usage[key];
      if (value === null || !Number.isSafeInteger(Number(usage[key]) + value)) usageComplete = false;
      else usage[key] = Number(usage[key]) + value;
    }
    return result;
  };
  const planText = (events: apJson[]) => {
    const terminal = events.find(event => event.type === 'response.completed');
    const response = apRecord(terminal?.response) ? terminal.response : {};
    const output = Array.isArray(response.output) ? response.output : [];
    const fromOutput = output.flatMap(item => apRecord(item) && item.type === 'message' && Array.isArray(item.content) ? item.content : [])
      .filter(part => apRecord(part) && part.type === 'output_text').map(part => String(part.text || '')).join('');
    return fromOutput || events.filter(event => event.type === 'response.output_text.delta').map(event => String(event.delta || '')).join('');
  };
  try {
    const planningInput = options.body.input as apJson[];
    const planning = await turn(planningInput, 'plan');
    let plan: AssistantReadPlan;
    try { plan = parseAssistantReadPlan(planText(planning.events)); }
    catch (error) {
      // A malformed plan is a model-side formatting failure, not a network
      // outage. Answer honestly in the second request with zero business reads
      // instead of a generic failure, and never guess the intended query.
      if (!(error instanceof AssistantPlanError) || !['assistant_plan_json', 'assistant_plan_invalid', 'assistant_plan_arguments', 'assistant_plan_size'].includes(error.message)) throw error;
      plan = { action: 'error', error: error.message };
    }
    if (controller.signal.aborted) throw apAbort();
    const evidence = plan.action === 'query' ? await apRace(options.execute(plan, controller.signal), controller.signal) : [];
    if (controller.signal.aborted) throw apAbort();
    if (apEncoder.encode(JSON.stringify(evidence)).length > ASSISTANT_PLAN_EVIDENCE_BYTES) apFail('assistant_evidence_size');
    const finalInput = options.answerInput(plan, evidence);
    const result = await turn(finalInput, 'answer');
    return { events: apEnsureVisibleAnswer(result.events, finalInput), status: result.status === 'completed' ? 'completed' : 'incomplete' as const,
      usage: usageComplete ? { ...usage, total_tokens: Math.max(usage.total_tokens!, usage.input_tokens! + usage.output_tokens!) } : { input_tokens: null, output_tokens: null, total_tokens: null } };
  } finally { controller.abort(); clearTimeout(timer); options.signal.removeEventListener('abort', abort); }
}
