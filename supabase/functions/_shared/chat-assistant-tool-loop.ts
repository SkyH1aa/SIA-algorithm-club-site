import {
  assistantToolRequest,
  collectAssistantToolTurn,
  type AssistantToolRound,
  type AssistantToolDefinition,
} from '../_shared/chat-assistant-tool-protocol.ts';
import type { ChatProtocol } from '../_shared/chat-protocol.ts';

export const ASSISTANT_TOOL_MAX_TURNS = 3;
export const ASSISTANT_TOOL_MAX_CALLS = 8;
export const ASSISTANT_TOOL_HISTORY_BYTES = 48_000;
const ASSISTANT_TOOL_MAX_RESULT_BYTES = 24_000;
const ASSISTANT_TOOL_MAX_CALL_RESULT_BYTES = 6_000;
const ASSISTANT_TOOL_MAX_ARGUMENT_BYTES = 8_192;
const ASSISTANT_TOOL_DEADLINE_MS = 120_000;
const atlEncoder = new TextEncoder();

type atlJson = Record<string, unknown>;
type atlAssistantUsage = { input_tokens: number | null; output_tokens: number | null; total_tokens: number | null };
type atlAssistantToolTurn = AssistantToolRound['turn'];
type atlAssistantToolCall = atlAssistantToolTurn['calls'][number];

type atlLoopOptions = {
  protocol: ChatProtocol;
  body: Record<string, unknown>;
  claudeThinking: unknown;
  tools: AssistantToolDefinition[];
  signal: AbortSignal;
  maxRequestBytes: number;
  maxInputTokens: number;
  outputBudget: number;
  dispatch: (serialized: string, signal: AbortSignal) => Promise<Response>;
  execute: (name: string, args: unknown, signal: AbortSignal) => Promise<unknown>;
  estimate: (request: Record<string, unknown>, atlHistoryBytes: number) => number;
};

export type AssistantToolLoopOptions = atlLoopOptions;
export type AssistantToolLoopResult = {
  events: atlJson[];
  usage: atlAssistantUsage;
  status: 'completed' | 'incomplete' | 'failed';
  inputBytes: number;
  turns: number;
  toolCalls: number;
};

export function assistantToolBudget(inputTokens: number, toolSchemaBytes: number): { perTurnInputTokens: number; reservedInputTokens: number } {
  const perTurnInputTokens = inputTokens + Math.ceil((toolSchemaBytes + ASSISTANT_TOOL_HISTORY_BYTES) / 3) + 256;
  return { perTurnInputTokens, reservedInputTokens: perTurnInputTokens * ASSISTANT_TOOL_MAX_TURNS };
}

function atlAbortError(): DOMException {
  return new DOMException('The operation was aborted', 'AbortError');
}
function atlIsAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError' || error instanceof Error && error.name === 'AbortError';
}
function atlRaceSignal<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void pending.catch(() => undefined);
    return Promise.reject(atlAbortError());
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      void pending.catch(() => undefined);
      reject(atlAbortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    pending.then(value => {
      signal.removeEventListener('abort', onAbort);
      resolve(value);
    }, error => {
      signal.removeEventListener('abort', onAbort);
      reject(error);
    });
  });
}
function atlRecord(value: unknown): value is atlJson {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function atlFiniteNonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function atlJsonBytes(value: unknown): number {
  return atlEncoder.encode(JSON.stringify(value)).byteLength;
}
function atlSafeJson(value: unknown, fallback: atlJson): string {
  try {
    const candidate = atlRecord(value) || Array.isArray(value) ? value : { result: value };
    const serialized = JSON.stringify(candidate);
    return serialized === undefined ? JSON.stringify(fallback) : serialized;
  } catch {
    return JSON.stringify(fallback);
  }
}
function atlBoundedError(code: string): string {
  return JSON.stringify({ error: { code } });
}
function atlCallId(call: atlAssistantToolCall, index: number): string {
  return typeof call.id === 'string' && call.id.length > 0 && call.id.length <= 256 ? call.id : `tool_call_${index + 1}`;
}
function atlHistoryBytes(rounds: AssistantToolRound[]): number {
  // Keep only the native continuation and tool result payload. Turn events, calls,
  // usage, and status are deliberately excluded from the context accounting.
  return rounds.reduce((total, round) => total + atlJsonBytes(round.turn.continuation) + atlJsonBytes(round.results), 0);
}
function atlValidateArguments(raw: unknown): { ok: true; value: atlJson } | { ok: false } {
  if (typeof raw !== 'string' || atlEncoder.encode(raw).byteLength > ASSISTANT_TOOL_MAX_ARGUMENT_BYTES) return { ok: false };
  try {
    const value = JSON.parse(raw);
    return atlRecord(value) ? { ok: true, value } : { ok: false };
  } catch {
    return { ok: false };
  }
}
function atlToolKnown(tools: AssistantToolDefinition[], name: unknown): name is string {
  return typeof name === 'string' && tools.some(tool => tool.name === name);
}
function atlUsageNumber(value: unknown): number | null {
  return atlFiniteNonnegative(value) ? value : null;
}
function atlAggregateUsage(current: atlAssistantUsage | null, turn: atlAssistantToolTurn): atlAssistantUsage | null {
  const usage = turn.usage;
  const values = [usage.input_tokens, usage.output_tokens, usage.total_tokens].map(atlUsageNumber);
  if (values.some(value => value === null)) return null;
  if (!current) return { input_tokens: values[0]!, output_tokens: values[1]!, total_tokens: Math.max(values[0]! + values[1]!, values[2]!) };
  const input = current.input_tokens! + values[0]!;
  const output = current.output_tokens! + values[1]!;
  const reported = current.total_tokens! + values[2]!;
  if (![input, output, reported].every(Number.isSafeInteger)) return null;
  return { input_tokens: input, output_tokens: output, total_tokens: Math.max(input + output, reported) };
}
function atlNoUsage(): atlAssistantUsage { return { input_tokens: null, output_tokens: null, total_tokens: null }; }
function atlValidateOptions(options: atlLoopOptions): void {
  for (const value of [options.maxRequestBytes, options.maxInputTokens, options.outputBudget]) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('assistant_budget');
  }
}

function atlCloseBody(response: Response | undefined): void {
  try { void response?.body?.cancel().catch(() => undefined); } catch { /* Preserve the original upstream error. */ }
}

export async function runAssistantToolLoop(options: atlLoopOptions): Promise<AssistantToolLoopResult> {
  atlValidateOptions(options);
  const deadline = new AbortController();
  const abort = () => deadline.abort();
  options.signal.addEventListener('abort', abort, { once: true });
  if (options.signal.aborted) deadline.abort();
  const timer = setTimeout(abort, ASSISTANT_TOOL_DEADLINE_MS);
  const rounds: AssistantToolRound[] = [];
  let turns = 0;
  let toolCalls = 0;
  let inputBytes = 0;
  let resultBytes = 0;
  let outputUsed = 0;
  let aggregate: atlAssistantUsage | null = null;
  let usageComplete = true;
  let finalEvents: atlJson[] = [];
  let finalStatus: 'completed' | 'incomplete' | 'failed' = 'failed';

  try {
    while (turns < ASSISTANT_TOOL_MAX_TURNS) {
      if (deadline.signal.aborted) throw atlAbortError();
      const remainingOutput = Math.max(0, options.outputBudget - outputUsed);
      if (remainingOutput <= 0) throw new Error('tool_output_budget');
      const thinking = options.claudeThinking && typeof options.claudeThinking === 'object' && !Array.isArray(options.claudeThinking)
        ? options.claudeThinking as Record<string, unknown> : null;
      const thinkingReserve = options.protocol === 'messages' && thinking?.mode === 'enabled' && Number.isSafeInteger(thinking.budget_tokens)
        ? Number(thinking.budget_tokens) + 1 : 0;
      const toolTurnsAvailable = turns < ASSISTANT_TOOL_MAX_TURNS - 1 && toolCalls < ASSISTANT_TOOL_MAX_CALLS;
      const allowTools = toolTurnsAvailable && remainingOutput > thinkingReserve * 2;
      const turnOutput = allowTools && thinkingReserve > 0 ? remainingOutput - thinkingReserve : remainingOutput;
      const requestBody = { ...options.body, max_output_tokens: turnOutput };
      const request = assistantToolRequest(options.protocol, requestBody, options.claudeThinking, options.tools, rounds, allowTools);
      if (!atlRecord(request)) throw new Error('upstream');
      const serialized = JSON.stringify(request);
      if (typeof serialized !== 'string') throw new Error('request');
      const requestBytes = atlEncoder.encode(serialized).byteLength;
      inputBytes += requestBytes;
      if (requestBytes > options.maxRequestBytes) throw new Error('request_too_large');
      const history = atlHistoryBytes(rounds);
      if (history > ASSISTANT_TOOL_HISTORY_BYTES) throw new Error('history_limit');
      const estimated = options.estimate(request, history);
      if (!Number.isFinite(estimated) || estimated > options.maxInputTokens) throw new Error('context');

      let response: Response | undefined;
      try {
        response = await atlRaceSignal(options.dispatch(serialized, deadline.signal).then(value => {
          if (deadline.signal.aborted) { atlCloseBody(value); throw atlAbortError(); }
          return value;
        }), deadline.signal);
        if (!response || !response.ok || !response.body) {
          atlCloseBody(response);
          throw new Error('upstream');
        }
        const contentType = response.headers.get('content-type');
        if (!contentType || !/text\/event-stream/i.test(contentType)) {
          atlCloseBody(response);
          throw new Error('upstream');
        }
        const turn = await atlRaceSignal(collectAssistantToolTurn(options.protocol, response.body, deadline.signal), deadline.signal);
        turns++;
        aggregate = atlAggregateUsage(aggregate, turn);
        if (aggregate === null) usageComplete = false;
        const output = atlUsageNumber(turn.usage.output_tokens);
        if (output === null) outputUsed = options.outputBudget;
        else {
          if (output > remainingOutput) throw new Error('tool_output_budget');
          outputUsed += output;
        }
        if (turn.status !== 'completed') throw new Error('tool_turn_incomplete');

        if (!allowTools) {
          if (turn.calls.length) throw new Error('tool_calls_disallowed');
          finalEvents = turn.events.filter(atlRecord);
          finalStatus = 'completed';
          break;
        }
        if (!turn.calls.length) {
          finalEvents = turn.events.filter(atlRecord);
          finalStatus = 'completed';
          break;
        }
        if (outputUsed >= options.outputBudget) throw new Error('tool_output_budget');
        if (toolCalls + turn.calls.length > ASSISTANT_TOOL_MAX_CALLS) throw new Error('tool_call_limit');

        const results: Array<{ id: string; output: string }> = [];
        for (let index = 0; index < turn.calls.length; index++) {
          const call = turn.calls[index];
          const id = atlCallId(call, index);
          toolCalls++;
          let outputText = atlBoundedError('tool_call_limit');
          if (toolCalls <= ASSISTANT_TOOL_MAX_CALLS) {
            const args = atlValidateArguments(call.arguments);
            if (!atlToolKnown(options.tools, call.name)) outputText = atlBoundedError('unknown_tool');
            else if (!args.ok) outputText = atlBoundedError('invalid_arguments');
            else {
              try {
                const value = await atlRaceSignal(options.execute(call.name, args.value, deadline.signal), deadline.signal);
                const candidate = atlSafeJson(value, { error: { code: 'tool_result_invalid' } });
                const bytes = atlEncoder.encode(candidate).byteLength;
                if (bytes > ASSISTANT_TOOL_MAX_CALL_RESULT_BYTES || resultBytes + bytes > ASSISTANT_TOOL_MAX_RESULT_BYTES) {
                  outputText = atlBoundedError(bytes > ASSISTANT_TOOL_MAX_CALL_RESULT_BYTES ? 'tool_result_too_large' : 'tool_results_too_large');
                } else {
                  outputText = candidate;
                }
              } catch (error) {
                if (atlIsAbort(error) || deadline.signal.aborted) throw atlAbortError();
                outputText = atlBoundedError('tool_unavailable');
              }
            }
          }
          // Even rejected calls receive a result, preserving every native call id.
          let outputBytes = atlEncoder.encode(outputText).byteLength;
          if (resultBytes + outputBytes > ASSISTANT_TOOL_MAX_RESULT_BYTES) {
            outputText = atlBoundedError('tool_results_too_large');
            outputBytes = atlEncoder.encode(outputText).byteLength;
          }
          resultBytes += outputBytes;
          results.push({ id, output: outputText });
        }
        const nextRound: AssistantToolRound = { turn, results };
        rounds.push(nextRound);
        if (atlHistoryBytes(rounds) > ASSISTANT_TOOL_HISTORY_BYTES) throw new Error('history_limit');
      } catch (error) {
        atlCloseBody(response);
        if (atlIsAbort(error) || deadline.signal.aborted) throw atlAbortError();
        throw error;
      }
    }
    if (!turns || finalStatus !== 'completed') throw new Error('tool_turn_incomplete');
    return {
      events: finalEvents,
      usage: usageComplete && aggregate ? aggregate : atlNoUsage(),
      status: finalStatus,
      inputBytes,
      turns,
      toolCalls,
    };
  } finally {
    clearTimeout(timer);
    options.signal.removeEventListener('abort', abort);
  }
}
