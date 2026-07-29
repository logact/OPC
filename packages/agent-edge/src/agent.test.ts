import { describe, expect, it } from 'vitest';
import { deriveAgentActivity, type AgentMessage, type StatusChangeEvent } from './IAgent.js';
import { AgentRuntime } from './agent.js';
import {
  createFakeStreamFn,
  deferred,
  fakeModel,
  type FakeReply,
  type FakeStream,
} from './testing.js';

function setup(
  script: FakeReply[] | ((callIndex: number) => FakeReply),
  deps: { maxThreads?: number } = {},
) {
  const fake: FakeStream = createFakeStreamFn(script);
  const messages: AgentMessage[] = [];
  const events: StatusChangeEvent[] = [];
  const agent = new AgentRuntime({
    agentId: 'a1',
    model: fakeModel(),
    streamFn: fake.streamFn,
    ...deps,
  });
  return { agent, fake, messages, events };
}

let seq = 0;
function inbound(threadId: string, body: string): AgentMessage {
  seq += 1;
  return {
    id: `m-${seq}`,
    timestamp: Date.now(),
    from: 'user',
    threadId,
    content: { type: 'text', body },
  };
}

describe('AgentRuntime lifecycle', () => {
  it('starts from initialized only and reports info', async () => {
    const { agent } = setup([{ kind: 'text', text: 'x' }]);
    expect((await agent.getInfo()).status).toBe('initialized');

    await agent.initialize({ role: 'ops', department: 'edge' });
    await expect(agent.initialize({})).rejects.toMatchObject({ code: 'invalid_transition' });

    await agent.start();
    await expect(agent.start()).rejects.toMatchObject({ code: 'invalid_transition' });
    await expect(agent.initialize({})).rejects.toMatchObject({ code: 'invalid_transition' });

    const info = await agent.getInfo();
    expect(info).toMatchObject({ agentId: 'a1', status: 'running', role: 'ops', threadIds: [] });
  });

  it('pauses and resumes, emitting agent-level status events', async () => {
    const { agent, events } = setup([{ kind: 'text', text: 'x' }]);
    agent.onStatusChange((event) => events.push(event));
    await agent.start();
    await agent.pause();
    expect((await agent.getInfo()).status).toBe('paused');
    await expect(agent.pause()).rejects.toMatchObject({ code: 'invalid_transition' });
    await agent.resume();
    expect((await agent.getInfo()).status).toBe('running');
    expect(events).toEqual([
      { status: 'running' },
      { status: 'paused' },
      { status: 'running' },
    ]);
  });

  it('terminates and destroys idempotently; destroyed rejects everything', async () => {
    const { agent } = setup([{ kind: 'text', text: 'x' }]);
    await agent.start();
    const threadId = await agent.createThread({ goal: 'g' });

    await agent.terminate();
    expect((await agent.getInfo()).status).toBe('terminated');
    expect((await agent.getThread(threadId)).status).toBe('terminated');
    await agent.terminate(); // idempotent
    await expect(agent.createThread({ goal: 'g' })).rejects.toMatchObject({
      code: 'invalid_transition',
    });
    await expect(agent.receiveMessage(inbound(threadId, 'hi'))).rejects.toMatchObject({
      code: 'terminated',
    });

    await agent.destroy();
    await agent.destroy(); // idempotent
    await agent.terminate(); // no-op after destroy
    await expect(agent.getInfo()).rejects.toMatchObject({ code: 'destroyed' });
    await expect(agent.start()).rejects.toMatchObject({ code: 'destroyed' });
    await expect(agent.pause()).rejects.toMatchObject({ code: 'destroyed' });
    await expect(agent.resume()).rejects.toMatchObject({ code: 'destroyed' });
    await expect(agent.createThread({ goal: 'g' })).rejects.toMatchObject({ code: 'destroyed' });
    await expect(agent.getThread(threadId)).rejects.toMatchObject({ code: 'destroyed' });
    await expect(agent.getThreads()).rejects.toMatchObject({ code: 'destroyed' });
    await expect(agent.getMessages(threadId)).rejects.toMatchObject({ code: 'destroyed' });
    await expect(agent.completeThread(threadId)).rejects.toMatchObject({ code: 'destroyed' });
    await expect(agent.receiveMessage(inbound(threadId, 'hi'))).rejects.toMatchObject({
      code: 'destroyed',
    });
    expect(() => agent.onMessage(() => undefined)).toThrowError(
      expect.objectContaining({ code: 'destroyed' }) as Error,
    );
    expect(() => agent.onStatusChange(() => undefined)).toThrowError(
      expect.objectContaining({ code: 'destroyed' }) as Error,
    );
  });
});

describe('AgentRuntime thread management', () => {
  it('rejects createThread before start and enforces maxThreads', async () => {
    const { agent } = setup([{ kind: 'text', text: 'x' }], { maxThreads: 1 });
    await expect(agent.createThread({ goal: 'g' })).rejects.toMatchObject({
      code: 'invalid_transition',
    });
    await agent.start();
    await agent.createThread({ goal: 'one' });
    await expect(agent.createThread({ goal: 'two' })).rejects.toMatchObject({
      code: 'thread_limit',
    });
  });

  it('rejects unknown thread ids with unknown_thread', async () => {
    const { agent } = setup([{ kind: 'text', text: 'x' }]);
    await agent.start();
    await expect(agent.getThread('nope')).rejects.toMatchObject({ code: 'unknown_thread' });
    await expect(agent.startThread('nope')).rejects.toMatchObject({ code: 'unknown_thread' });
    await expect(agent.pauseThread('nope')).rejects.toMatchObject({ code: 'unknown_thread' });
    await expect(agent.resumeThread('nope')).rejects.toMatchObject({ code: 'unknown_thread' });
    await expect(agent.completeThread('nope')).rejects.toMatchObject({ code: 'unknown_thread' });
    await expect(agent.terminateThread('nope')).rejects.toMatchObject({ code: 'unknown_thread' });
    await expect(agent.getMessages('nope')).rejects.toMatchObject({ code: 'unknown_thread' });
    await expect(agent.receiveMessage(inbound('nope', 'hi'))).rejects.toMatchObject({
      code: 'unknown_thread',
    });
  });

  it('runs a thread to waiting, fans out messages and status events', async () => {
    const { agent, messages, events } = setup([{ kind: 'text', text: 'reply' }]);
    agent.onMessage((message) => messages.push(message));
    agent.onStatusChange((event) => events.push(event));

    await agent.start();
    const threadId = await agent.createThread({ goal: 'the goal', title: 't' });
    expect(await agent.getThreads()).toEqual([
      { threadId, status: 'initialized', goal: 'the goal', title: 't' },
    ]);
    expect((await agent.getInfo()).threadIds).toEqual([threadId]);

    await agent.startThread(threadId);
    expect((await agent.getThread(threadId)).status).toBe('waiting');
    expect(messages.map((m) => m.content.body)).toEqual(['reply']);
    expect(messages[0]).toMatchObject({ from: 'a1', threadId });
    expect(events).toEqual([
      { status: 'running' },
      { threadId, status: 'running' },
      { threadId, status: 'waiting' },
    ]);

    const history = await agent.getMessages(threadId);
    expect(history.map((m) => [m.from, m.content.body])).toEqual([
      ['user', 'the goal'],
      ['a1', 'reply'],
    ]);

    // Threads are started exactly once, whatever their later status.
    await expect(agent.startThread(threadId)).rejects.toMatchObject({
      code: 'invalid_transition',
    });
  });

  it('completes a waiting thread via completeThread', async () => {
    const { agent } = setup([{ kind: 'text', text: 'reply' }]);
    await agent.start();
    const threadId = await agent.createThread({ goal: 'g' });
    await expect(agent.completeThread(threadId)).rejects.toMatchObject({
      code: 'invalid_transition',
    });

    await agent.startThread(threadId); // -> waiting
    await agent.completeThread(threadId);
    expect((await agent.getThread(threadId)).status).toBe('done');

    await expect(agent.receiveMessage(inbound(threadId, 'late'))).rejects.toMatchObject({
      code: 'invalid_transition',
    });
  });

  it('unsubscribes handlers', async () => {
    const { agent, messages } = setup([{ kind: 'text', text: 'reply' }]);
    const off = agent.onMessage((message) => messages.push(message));
    off();
    await agent.start();
    const threadId = await agent.createThread({ goal: 'g' });
    await agent.startThread(threadId);
    expect(messages).toEqual([]);
  });

  it('terminates and destroys individual threads', async () => {
    const { agent } = setup([{ kind: 'text', text: 'x' }]);
    await agent.start();
    const t1 = await agent.createThread({ goal: 'one' });
    const t2 = await agent.createThread({ goal: 'two' });

    await agent.terminateThread(t1);
    await agent.terminateThread(t1); // idempotent
    expect((await agent.getThread(t1)).status).toBe('terminated');
    expect((await agent.getThread(t2)).status).toBe('initialized');

    await agent.destroyThread(t1);
    await agent.destroyThread(t1); // already gone: idempotent no-op
    await expect(agent.getThread(t1)).rejects.toMatchObject({ code: 'unknown_thread' });
    expect((await agent.getInfo()).threadIds).toEqual([t2]);
  });
});

describe('AgentRuntime message flow', () => {
  it('rejects receiveMessage before start', async () => {
    const { agent } = setup([{ kind: 'text', text: 'x' }]);
    await expect(agent.receiveMessage(inbound('t', 'hi'))).rejects.toMatchObject({
      code: 'invalid_transition',
    });
  });

  it('queues inbound while paused and delivers it in order on resume', async () => {
    const gate = deferred<void>();
    const { agent, fake, messages } = setup((callIndex) => {
      if (callIndex === 0)
        return { kind: 'blocked', gate: gate.promise, then: { kind: 'text', text: 'one' } };
      return { kind: 'text', text: callIndex === 1 ? 'two' : 'three' };
    });
    agent.onMessage((message) => messages.push(message));

    await agent.start();
    const threadId = await agent.createThread({ goal: 'g' });
    const started = agent.startThread(threadId);
    await fake.waitForCall(1);

    await agent.pause();
    expect((await agent.getThread(threadId)).status).toBe('paused');

    await agent.receiveMessage(inbound(threadId, 'A'));
    await agent.receiveMessage(inbound(threadId, 'B'));
    gate.resolve();
    await agent.resume();
    await started;

    expect(messages.map((m) => m.content.body)).toEqual(['one', 'two', 'three']);
    // A and B reached the model in FIFO order on turns 2 and 3.
    const lastUserText = (callIndex: number): string | undefined => {
      const ctx = fake.contexts[callIndex];
      const last = ctx?.messages.at(-1) as
        | { role: string; content: { type: string; text?: string }[] | string }
        | undefined;
      if (last?.role !== 'user') return undefined;
      return typeof last.content === 'string'
        ? last.content
        : last.content
            .filter((b) => b.type === 'text')
            .map((b) => b.text ?? '')
            .join('');
    };
    expect(lastUserText(1)).toBe('A');
    expect(lastUserText(2)).toBe('B');
  });

  it('routes inbound to a running thread and pauses single threads', async () => {
    const gate = deferred<void>();
    const { agent, fake, messages } = setup((callIndex) =>
      callIndex === 0
        ? { kind: 'blocked', gate: gate.promise, then: { kind: 'text', text: 'one' } }
        : { kind: 'text', text: 'two' },
    );
    agent.onMessage((message) => messages.push(message));

    await agent.start();
    const threadId = await agent.createThread({ goal: 'g' });
    const started = agent.startThread(threadId);
    await fake.waitForCall(1);

    await agent.pauseThread(threadId);
    expect((await agent.getThread(threadId)).status).toBe('paused');
    await agent.receiveMessage(inbound(threadId, 'ping')); // queued on the thread
    gate.resolve();
    await agent.resumeThread(threadId);
    await started;

    expect(messages.map((m) => m.content.body)).toEqual(['one', 'two']);
    expect((await agent.getThread(threadId)).status).toBe('waiting');
  });

  it('agent pause also holds waiting threads', async () => {
    const { agent } = setup([{ kind: 'text', text: 'one' }, { kind: 'text', text: 'two' }]);
    await agent.start();
    const threadId = await agent.createThread({ goal: 'g' });
    await agent.startThread(threadId); // -> waiting

    await agent.pause();
    expect((await agent.getThread(threadId)).status).toBe('paused');
    await agent.receiveMessage(inbound(threadId, 'queued'));

    await agent.resume();
    expect((await agent.getInfo()).status).toBe('running');
    expect((await agent.getThread(threadId)).status).toBe('waiting');
  });

  it('cascades terminate to live threads mid-run', async () => {
    const never = deferred<void>();
    const { agent, fake } = setup(() => ({
      kind: 'blocked',
      gate: never.promise,
      then: { kind: 'text', text: 'unreachable' },
    }));
    await agent.start();
    const t1 = await agent.createThread({ goal: 'one' });
    const t2 = await agent.createThread({ goal: 'two' });
    const s1 = agent.startThread(t1);
    const s2 = agent.startThread(t2);
    await fake.waitForCall(2);

    await agent.terminate();
    await Promise.all([s1, s2]);

    expect((await agent.getInfo()).status).toBe('terminated');
    expect((await agent.getThread(t1)).status).toBe('terminated');
    expect((await agent.getThread(t2)).status).toBe('terminated');
  });
});

describe('deriveAgentActivity', () => {
  it('maps thread statuses with working > blocking > error > idle precedence', () => {
    expect(deriveAgentActivity([])).toBe('idle');
    expect(deriveAgentActivity(['initialized'])).toBe('idle');
    expect(deriveAgentActivity(['done', 'terminated'])).toBe('idle');
    expect(deriveAgentActivity(['error'])).toBe('error');
    expect(deriveAgentActivity(['error', 'waiting'])).toBe('blocking');
    expect(deriveAgentActivity(['error', 'paused'])).toBe('blocking');
    expect(deriveAgentActivity(['waiting', 'running'])).toBe('working');
    expect(deriveAgentActivity(['error', 'running'])).toBe('working');
  });

  it('getInfo exposes aggregated activity', async () => {
    const { agent } = setup([{ kind: 'text', text: 'hi' }, { kind: 'error', error: 'boom' }]);
    await agent.start();
    expect((await agent.getInfo()).activity).toBe('idle');

    const t1 = await agent.createThread({ goal: 'one' });
    await agent.startThread(t1); // -> waiting
    expect((await agent.getInfo()).activity).toBe('blocking');

    const t2 = await agent.createThread({ goal: 'two' });
    await agent.startThread(t2); // fake run errors -> thread error
    expect((await agent.getThread(t2)).status).toBe('error');
    // t1 still waiting → blocking wins over error
    expect((await agent.getInfo()).activity).toBe('blocking');

    await agent.completeThread(t1);
    expect((await agent.getInfo()).activity).toBe('error');
  });
});
