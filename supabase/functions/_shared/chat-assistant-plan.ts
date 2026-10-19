import { protocolRequest, type ChatProtocol } from '../_shared/chat-protocol.ts';
import { collectAssistantToolTurn } from '../_shared/chat-assistant-tool-protocol.ts';
import { validateAssistantReadPlan } from '../_shared/chat-assistant-tools.ts';

type apJson = Record<string, unknown>;
type apUsage = { input_tokens: number | null; output_tokens: number | null; total_tokens: number | null };
export type AssistantReadPlan = { action: 'query'; queries: { tool: string; arguments: apJson }[] } | { action: 'clarify'; question: string } | { action: 'answer' };
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
export function parseAssistantReadPlan(text: string): AssistantReadPlan {
  if (apEncoder.encode(text).length > ASSISTANT_PLAN_BYTES) apFail('assistant_plan_size');
  let value: unknown;
  try { value = JSON.parse(text); } catch { apFail('assistant_plan_json'); }
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

export function assistantPlanBudget(inputTokens: number) {
  const perTurnInputTokens = inputTokens + Math.ceil(ASSISTANT_PLAN_EVIDENCE_BYTES / 3) + 1024;
  return { perTurnInputTokens, reservedInputTokens: inputTokens + perTurnInputTokens };
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
    if (result.status !== 'completed' || result.calls.length || !result.events.length) apFail(`assistant_${stage}_stream`);
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
  try {
    const planning = await turn(options.body.input as apJson[], 'plan');
    const terminal = planning.events.find(event => event.type === 'response.completed');
    const response = apRecord(terminal?.response) ? terminal.response : {};
    const output = Array.isArray(response.output) ? response.output : [];
    let text = output.flatMap(item => apRecord(item) && item.type === 'message' && Array.isArray(item.content) ? item.content : []).filter(part => apRecord(part) && part.type === 'output_text').map(part => String(part.text || '')).join('');
    if (!text) text = planning.events.filter(event => event.type === 'response.output_text.delta').map(event => String(event.delta || '')).join('');
    const plan = parseAssistantReadPlan(text);
    if (controller.signal.aborted) throw apAbort();
    const evidence = plan.action === 'query' ? await apRace(options.execute(plan, controller.signal), controller.signal) : [];
    if (controller.signal.aborted) throw apAbort();
    if (apEncoder.encode(JSON.stringify(evidence)).length > ASSISTANT_PLAN_EVIDENCE_BYTES) apFail('assistant_evidence_size');
    const result = await turn(options.answerInput(plan, evidence), 'answer');
    return { events: result.events, status: result.status, usage: usageComplete ? { ...usage, total_tokens: Math.max(usage.total_tokens!, usage.input_tokens! + usage.output_tokens!) } : { input_tokens: null, output_tokens: null, total_tokens: null } };
  } finally { controller.abort(); clearTimeout(timer); options.signal.removeEventListener('abort', abort); }
}
