import { describe, expect, it } from 'vitest';
import type { AgentMessage, ThreadStatus } from './IAgent.js';
import { AgentStateError } from './IAgent.js';
import { PiThread, COMPLETE_TASK_TOOL } from './thread.js';
import {
  createFakeStreamFn,
  deferred,
  fakeModel,
  type FakeReply,
  type FakeStream,
} from './testing.js';

function setup(
  script: FakeReply[] | ((callIndex: number) => FakeReply),
  options?: { mode?: 'goal' | 'chat' },
) {
  const outbound: AgentMessage[] = [];
  const statuses: { threadId: string; status: ThreadStatus }[] = [];
  const fake: FakeStream = createFakeStreamFn(script);
  const thread = new PiThread({
    threadId: 't1',
    goal: 'do the thing',
    title: 'job',
    agentId: 'a1',
    model: fakeModel(),
    streamFn: fake.streamFn,
    mode: options?.mode,
    hooks: {
      emitOutbound: (message) => outbound.push(message),
      emitStatus: (threadId, status) => statuses.push({ threadId, status }),
    },
  });
  return { thread, outbound, statuses, fake };
}

let seq = 0;
function inbound(body: string): AgentMessage {
  seq += 1;
  return {
    id: `m-${seq}`,
    timestamp: Date.now(),
    from: 'user',
    threadId: 't1',
    content: { type: 'text', body },
  };
}

function lastUserText(context: { messages: unknown[] }): string | undefined {
  const last = context.messages.at(-1) as
    | { role: string; content: string | { type: string; text?: string }[] }
    | undefined;
  if (last?.role !== 'user') return undefined;
  if (typeof last.content === 'string') return last.content;
  return last.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('');
}

describe('PiThread lifecycle', () => {
  it('runs goal to waiting and emits the assistant reply outbound', async () => {
    const { thread, outbound, statuses, fake } = setup([{ kind: 'text', text: 'working on it' }]);
    await thread.start();

    expect(await thread.getInfo()).toMatchObject({
      threadId: 't1',
      status: 'waiting',
      goal: 'do the thing',
      title: 'job',
    });
    expect(outbound.map((m) => m.content.body)).toEqual(['working on it']);
    expect(outbound[0]).toMatchObject({ from: 'a1', threadId: 't1' });
    expect(statuses.map((s) => s.status)).toEqual(['running', 'waiting']);
    expect(fake.callCount()).toBe(1);
  });

  it('continues a waiting thread on inbound (waiting -> running -> waiting)', async () => {
    const { thread, outbound, statuses, fake } = setup([
      { kind: 'text', text: 'first' },
      { kind: 'text', text: 'second' },
    ]);
    await thread.start();
    await thread.notify(inbound('follow up'));

    expect((await thread.getInfo()).status).toBe('waiting');
    expect(outbound.map((m) => m.content.body)).toEqual(['first', 'second']);
    expect(fake.callCount()).toBe(2);
    expect(lastUserText(fake.contexts[1] ?? { messages: [] })).toBe('follow up');
    expect(statuses.map((s) => s.status)).toEqual([
      'running',
      'waiting',
      'running',
      'waiting',
    ]);
  });

  it('maps run failures to error status without outbound messages', async () => {
    const { thread, outbound, statuses } = setup([{ kind: 'error', error: 'model exploded' }]);
    await thread.start();

    expect((await thread.getInfo()).status).toBe('error');
    expect(outbound).toEqual([]);
    expect(statuses.map((s) => s.status)).toEqual(['running', 'error']);
  });

  it('rejects start from any status other than initialized', async () => {
    const { thread } = setup([{ kind: 'text', text: 'hi' }]);
    await thread.start();
    await expect(thread.start()).rejects.toMatchObject({ code: 'invalid_transition' });
  });

  it('rejects pause/resume from meaningless statuses', async () => {
    const { thread } = setup([{ kind: 'text', text: 'hi' }]);
    await expect(thread.pause()).rejects.toMatchObject({ code: 'invalid_transition' });
    await expect(thread.resume()).rejects.toMatchObject({ code: 'invalid_transition' });
    await thread.start(); // -> waiting
    await thread.terminate();
    await expect(thread.pause()).rejects.toMatchObject({ code: 'invalid_transition' });
    await expect(thread.resume()).rejects.toMatchObject({ code: 'invalid_transition' });
  });

  it('rejects inbound before start and after done/error', async () => {
    const early = setup([{ kind: 'text', text: 'hi' }]);
    await expect(early.thread.notify(inbound('early'))).rejects.toMatchObject({
      code: 'invalid_transition',
    });

    const completed = setup([{ kind: 'toolCall', name: COMPLETE_TASK_TOOL }]);
    await completed.thread.start(); // -> done
    await expect(completed.thread.notify(inbound('late'))).rejects.toMatchObject({
      code: 'invalid_transition',
    });

    const failed = setup([{ kind: 'error', error: 'boom' }]);
    await failed.thread.start();
    await expect(failed.thread.notify(inbound('late'))).rejects.toMatchObject({
      code: 'invalid_transition',
    });
  });

  it('returns transcript history via getMessages', async () => {
    const { thread } = setup([{ kind: 'text', text: 'answer' }]);
    expect(await thread.getMessages()).toEqual([]);
    await thread.start();

    const messages = await thread.getMessages();
    expect(messages.map((m) => [m.from, m.content.body])).toEqual([
      ['user', 'do the thing'],
      ['a1', 'answer'],
    ]);
  });
});

describe('PiThread notify', () => {
  it('steers into a live run; the steered text reaches the next LLM call', async () => {
    const gate = deferred<void>();
    const { thread, outbound, fake } = setup((callIndex) =>
      callIndex === 0
        ? { kind: 'blocked', gate: gate.promise, then: { kind: 'text', text: 'first' } }
        : { kind: 'text', text: 'second' },
    );
    const started = thread.start();
    await fake.waitForCall(1);

    await thread.notify(inbound('steer me'));
    gate.resolve();
    await started;

    expect(outbound.map((m) => m.content.body)).toEqual(['first', 'second']);
    expect(fake.callCount()).toBe(2);
    const second = fake.contexts[1];
    expect(lastUserText(second ?? { messages: [] })).toBe('steer me');
    expect((await thread.getInfo()).status).toBe('waiting');
  });

  it('never flaps to waiting when inbound arrives mid-run', async () => {
    const gate = deferred<void>();
    const { thread, statuses, fake } = setup((callIndex) =>
      callIndex === 0
        ? { kind: 'blocked', gate: gate.promise, then: { kind: 'text', text: 'first' } }
        : { kind: 'text', text: 'second' },
    );
    const started = thread.start();
    await fake.waitForCall(1);

    await thread.notify(inbound('mid-run'));
    gate.resolve();
    await started;

    // The steered message was pending at the turn boundary, so the run went
    // straight to the next turn instead of idling in "waiting" first.
    expect(statuses.map((s) => s.status)).toEqual(['running', 'waiting']);
    expect(fake.callCount()).toBe(2);
  });

  it('keeps one continuous run across multiple waiting cycles', async () => {
    const { thread, statuses, fake } = setup([
      { kind: 'text', text: 'r1' },
      { kind: 'text', text: 'r2' },
      { kind: 'text', text: 'r3' },
    ]);
    await thread.start();
    await thread.notify(inbound('q2'));
    await thread.notify(inbound('q3'));

    expect((await thread.getInfo()).status).toBe('waiting');
    expect(statuses.map((s) => s.status)).toEqual([
      'running',
      'waiting',
      'running',
      'waiting',
      'running',
      'waiting',
    ]);
    // Same run, one growing transcript: the third LLM call sees everything.
    const roles = (fake.contexts[2]?.messages ?? []).map(
      (message) => (message as { role: string }).role,
    );
    expect(roles).toEqual(['user', 'assistant', 'user', 'assistant', 'user']);
  });
});

describe('PiThread pause/resume', () => {
  it('halts at the turn boundary, queues inbound, delivers FIFO on resume', async () => {
    const gate = deferred<void>();
    const { thread, outbound, statuses, fake } = setup((callIndex) => {
      if (callIndex === 0)
        return { kind: 'blocked', gate: gate.promise, then: { kind: 'text', text: 'one' } };
      return { kind: 'text', text: callIndex === 1 ? 'two' : 'three' };
    });
    const started = thread.start();
    await fake.waitForCall(1);

    await thread.pause();
    expect((await thread.getInfo()).status).toBe('paused');

    gate.resolve(); // turn 1 finishes; the run then holds at the pause gate
    await thread.notify(inbound('A'));
    await thread.notify(inbound('B'));
    expect(fake.callCount()).toBe(1); // no further model call while paused

    await thread.resume();
    await started;

    expect(outbound.map((m) => m.content.body)).toEqual(['one', 'two', 'three']);
    expect(fake.callCount()).toBe(3);
    expect(lastUserText(fake.contexts[1] ?? { messages: [] })).toBe('A');
    expect(lastUserText(fake.contexts[2] ?? { messages: [] })).toBe('B');
    expect(statuses.map((s) => s.status)).toEqual(['running', 'paused', 'running', 'waiting']);
  });

  it('pauses a waiting thread immediately and resumes back to waiting', async () => {
    const { thread, outbound, statuses, fake } = setup([
      { kind: 'text', text: 'one' },
      { kind: 'text', text: 'two' },
    ]);
    await thread.start(); // -> waiting

    await thread.pause();
    expect((await thread.getInfo()).status).toBe('paused');
    await thread.notify(inbound('queued'));

    await thread.resume();
    expect((await thread.getInfo()).status).toBe('waiting');
    expect(outbound.map((m) => m.content.body)).toEqual(['one', 'two']);
    expect(lastUserText(fake.contexts[1] ?? { messages: [] })).toBe('queued');
    expect(statuses.map((s) => s.status)).toEqual([
      'running',
      'waiting',
      'paused',
      'running',
      'waiting',
    ]);
  });
});

describe('PiThread modes (issue #104)', () => {
  it('goal mode: the run gets the completion tool and a system prompt with the goal and the complete_task instruction', async () => {
    const gate = deferred<void>(); // hold the first LLM call open so we can inspect it
    const { thread, fake } = setup(
      () => ({ kind: 'blocked', gate: gate.promise, then: { kind: 'text', text: 'unreachable' } }),
      { mode: 'goal' },
    );
    const started = thread.start();
    await fake.waitForCall(1);

    const context = fake.contexts[0];
    expect(context?.systemPrompt).toContain('do the thing');
    expect(context?.systemPrompt).toContain(COMPLETE_TASK_TOOL);
    expect((context?.tools ?? []).map((tool) => tool.name)).toContain(COMPLETE_TASK_TOOL);

    await thread.terminate();
    await started;
  });

  it('goal mode: settles to done when the model calls the complete_task tool', async () => {
    const { thread, outbound, statuses, fake } = setup(
      [{ kind: 'toolCall', name: COMPLETE_TASK_TOOL, args: { summary: 'all done' } }],
      { mode: 'goal' },
    );
    await thread.start();

    expect((await thread.getInfo()).status).toBe('done');
    expect(statuses.map((s) => s.status)).toEqual(['running', 'done']);
    expect(outbound).toEqual([]);
    expect(fake.callCount()).toBe(1); // terminate: true — no follow-up LLM call
  });

  it('chat mode: no tools, a real system prompt, replies and goes waiting', async () => {
    const { thread, outbound, statuses, fake } = setup(
      [{ kind: 'text', text: 'here is your answer' }],
      { mode: 'chat' },
    );
    await thread.start();

    expect((await thread.getInfo()).status).toBe('waiting');
    expect(outbound.map((m) => m.content.body)).toEqual(['here is your answer']);
    expect(statuses.map((s) => s.status)).toEqual(['running', 'waiting']);

    const context = fake.contexts[0];
    expect(context?.tools ?? []).toEqual([]);
    expect(typeof context?.systemPrompt).toBe('string');
    expect((context?.systemPrompt ?? '').trim().length).toBeGreaterThan(0);
  });
});

describe('PiThread completion', () => {
  it('reaches done when the model calls the complete_task tool', async () => {
    const { thread, outbound, statuses, fake } = setup([
      { kind: 'toolCall', name: COMPLETE_TASK_TOOL, args: { summary: 'all done' } },
    ]);
    await thread.start();

    expect((await thread.getInfo()).status).toBe('done');
    expect(statuses.map((s) => s.status)).toEqual(['running', 'done']);
    expect(outbound).toEqual([]); // a tool-call-only reply emits no outbound text
    expect(fake.callCount()).toBe(1); // terminate: true — no follow-up LLM call

    await expect(thread.notify(inbound('more work'))).rejects.toMatchObject({
      code: 'invalid_transition',
    });
  });

  it('completes externally from waiting only', async () => {
    const { thread, statuses } = setup([{ kind: 'text', text: 'hi' }]);
    await expect(thread.complete()).rejects.toMatchObject({ code: 'invalid_transition' });

    await thread.start(); // -> waiting
    await thread.complete();
    expect((await thread.getInfo()).status).toBe('done');
    expect(statuses.map((s) => s.status)).toEqual(['running', 'waiting', 'done']);

    await expect(thread.complete()).rejects.toMatchObject({ code: 'invalid_transition' });
    await expect(thread.notify(inbound('late'))).rejects.toMatchObject({
      code: 'invalid_transition',
    });
  });
});

describe('PiThread terminate', () => {
  it('aborts a live run, is idempotent, and rejects inbound afterwards', async () => {
    const gate = deferred<void>(); // never resolved; abort must settle the run
    const { thread, outbound } = setup(() => ({
      kind: 'blocked',
      gate: gate.promise,
      then: { kind: 'text', text: 'unreachable' },
    }));
    const started = thread.start();
    await thread.terminate();
    await started;

    expect((await thread.getInfo()).status).toBe('terminated');
    expect(outbound).toEqual([]);

    await thread.terminate(); // idempotent no-op
    expect((await thread.getInfo()).status).toBe('terminated');

    await expect(thread.notify(inbound('too late'))).rejects.toMatchObject({
      code: 'terminated',
    });
    await expect(thread.notify(inbound('too late'))).rejects.toBeInstanceOf(AgentStateError);
  });

  it('settles a run held at the pause gate', async () => {
    const gate = deferred<void>();
    const { thread, fake } = setup((callIndex) =>
      callIndex === 0
        ? { kind: 'blocked', gate: gate.promise, then: { kind: 'text', text: 'one' } }
        : { kind: 'text', text: 'two' },
    );
    const started = thread.start();
    await fake.waitForCall(1);
    await thread.pause();
    gate.resolve();

    await thread.terminate();
    await started;
    expect((await thread.getInfo()).status).toBe('terminated');
  });

  it('terminates an already-finished thread', async () => {
    const { thread } = setup([{ kind: 'text', text: 'hi' }]);
    await thread.start();
    await thread.terminate();
    expect((await thread.getInfo()).status).toBe('terminated');
  });
});
