/**
 * Test-only scripted fake for the pi-ai StreamFn.
 *
 * Emits a valid AssistantMessageEvent stream (start → text deltas → done, or
 * a terminal error event) driven by a per-call script, so tests can script
 * canned replies, inject failures, and hold a run open with a deferred gate
 * to exercise pause/terminate-during-run — no network, no timers.
 */

import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type StopReason,
  type ToolCall,
} from '@earendil-works/pi-ai';
import type { StreamFn } from '@earendil-works/pi-agent-core';

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

export function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** One scripted LLM response. */
export type FakeReply =
  | { kind: 'text'; text: string }
  | { kind: 'toolCall'; name: string; args?: Record<string, unknown>; text?: string }
  | { kind: 'error'; error: string }
  /** Holds the stream open until `gate` resolves (or the run is aborted), then produces `then`. */
  | { kind: 'blocked'; gate: Promise<void>; then: FakeReply };

export function fakeModel(): Model<Api> {
  return {
    id: 'fake-model',
    name: 'fake',
    api: 'fake-api',
    provider: 'fake',
    baseUrl: '',
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 100_000,
    maxTokens: 4096,
  };
}

const EMPTY_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

export function fakeAssistantMessage(
  text: string,
  stopReason: StopReason = 'stop',
  errorMessage?: string,
): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'fake-api',
    provider: 'fake',
    model: 'fake-model',
    usage: EMPTY_USAGE,
    stopReason,
    ...(errorMessage != null ? { errorMessage } : {}),
    timestamp: Date.now(),
  };
}

export interface FakeStream {
  streamFn: StreamFn;
  /** LLM context of every call, in order. */
  contexts: Context[];
  callCount: () => number;
  /** Resolves once the streamFn has been invoked `n` times (1-based). */
  waitForCall: (n: number) => Promise<void>;
}

let toolCallSeq = 0;

function emitReply(stream: AssistantMessageEventStream, reply: FakeReply): void {
  if (reply.kind === 'blocked') {
    emitReply(stream, reply.then);
    return;
  }
  if (reply.kind === 'error') {
    const message = fakeAssistantMessage('', 'error', reply.error);
    stream.push({ type: 'start', partial: message });
    stream.push({ type: 'error', reason: 'error', error: message });
    return;
  }
  if (reply.kind === 'toolCall') {
    const toolCall: ToolCall = {
      type: 'toolCall',
      id: `fake-call-${++toolCallSeq}`,
      name: reply.name,
      arguments: reply.args ?? {},
    };
    const content: AssistantMessage['content'] = reply.text
      ? [{ type: 'text', text: reply.text }, toolCall]
      : [toolCall];
    const partial = fakeAssistantMessage('');
    const message: AssistantMessage = { ...fakeAssistantMessage(''), content };
    const contentIndex = content.length - 1;
    stream.push({ type: 'start', partial });
    stream.push({ type: 'toolcall_start', contentIndex, partial });
    stream.push({ type: 'toolcall_end', contentIndex, toolCall, partial: message });
    stream.push({ type: 'done', reason: 'toolUse', message });
    return;
  }
  const partial = fakeAssistantMessage('');
  const message = fakeAssistantMessage(reply.text);
  stream.push({ type: 'start', partial });
  stream.push({ type: 'text_start', contentIndex: 0, partial });
  stream.push({ type: 'text_delta', contentIndex: 0, delta: reply.text, partial: message });
  stream.push({ type: 'text_end', contentIndex: 0, content: reply.text, partial: message });
  stream.push({ type: 'done', reason: 'stop', message });
}

/**
 * Builds a StreamFn whose replies come from `script`: an array indexed by
 * call number (last entry repeats) or a function of (callIndex, context).
 */
export function createFakeStreamFn(
  script: FakeReply[] | ((callIndex: number, context: Context) => FakeReply),
): FakeStream {
  const contexts: Context[] = [];
  const callWaiters: Deferred<void>[] = [];
  let calls = 0;

  const streamFn: StreamFn = (model, context, options) => {
    const callIndex = calls++;
    contexts.push(context);
    callWaiters[callIndex]?.resolve();
    const reply =
      typeof script === 'function'
        ? script(callIndex, context)
        : script[Math.min(callIndex, script.length - 1)];

    const stream = createAssistantMessageEventStream();
    void (async () => {
      let current = reply;
      if (current.kind === 'blocked') {
        const signal = options?.signal;
        const winner = await Promise.race([
          current.gate.then(() => 'gate' as const),
          new Promise<'aborted'>((resolve) => {
            if (!signal) return;
            if (signal.aborted) resolve('aborted');
            else signal.addEventListener('abort', () => resolve('aborted'), { once: true });
          }),
        ]);
        if (winner === 'aborted') {
          const message = fakeAssistantMessage('', 'aborted', 'run aborted');
          stream.push({ type: 'start', partial: message });
          stream.push({ type: 'error', reason: 'aborted', error: message });
          return;
        }
        current = current.then;
      }
      emitReply(stream, current);
    })();
    return stream;
  };

  return {
    streamFn,
    contexts,
    callCount: () => calls,
    waitForCall: (n) => {
      if (calls >= n) return Promise.resolve();
      let waiter = callWaiters[n - 1];
      if (!waiter) {
        waiter = deferred<void>();
        callWaiters[n - 1] = waiter;
      }
      return waiter.promise;
    },
  };
}
