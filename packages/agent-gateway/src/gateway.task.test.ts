import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MqttClient } from 'mqtt';
import type {
  AgentMessage,
  AgentStatus,
  IAgent,
  StatusChangeEvent,
  ThreadInfo,
  ThreadOptions,
} from '@opc/agent-edge';
import { MQTT_TOPICS } from '@logact-pub/opc-protocol';
import { AgentGateway } from './gateway.js';
import { noopLogger } from './logger.js';

class FakeMqttClient extends EventEmitter {
  subscribe = vi.fn(
    (_topic: string, _options: unknown, callback?: (error: Error | null) => void) =>
      callback?.(null)
  );
  unsubscribe = vi.fn(
    (_topic: string, callback?: (error: Error | null) => void) => callback?.(null)
  );
  publish = vi.fn((...args: unknown[]) => {
    const callback = args.find((arg) => typeof arg === 'function') as
      | ((error?: Error) => void)
      | undefined;
    callback?.();
  });
  end = vi.fn((_force: boolean, _options: unknown, callback?: () => void) => callback?.());
  connected = true;
}

class FakeAgent implements IAgent {
  readonly agentId: string;
  readonly createdThreads: Array<{ threadId: string; options: ThreadOptions }> = [];
  readonly startedThreads: string[] = [];
  readonly receivedMessages: AgentMessage[] = [];
  threads: ThreadInfo[] = [];
  private threadSequence = 0;
  private messageHandler?: (message: AgentMessage) => void;
  private statusHandler?: (event: StatusChangeEvent) => void;

  constructor(agentId: string) {
    this.agentId = agentId;
  }

  initialize(): Promise<void> {
    return Promise.resolve();
  }
  start(): Promise<void> {
    return Promise.resolve();
  }
  pause(): Promise<void> {
    return Promise.resolve();
  }
  resume(): Promise<void> {
    return Promise.resolve();
  }
  terminate(): Promise<void> {
    return Promise.resolve();
  }
  destroy(): Promise<void> {
    return Promise.resolve();
  }
  getInfo(): Promise<{
    agentId: string;
    status: AgentStatus;
    activity: 'idle';
    threadIds: string[];
  }> {
    return Promise.resolve({
      agentId: this.agentId,
      status: 'running',
      activity: 'idle',
      threadIds: this.threads.map((thread) => thread.threadId),
    });
  }
  onMessage(handler: (message: AgentMessage) => void): () => void {
    this.messageHandler = handler;
    return () => {
      this.messageHandler = undefined;
    };
  }
  onStatusChange(handler: (event: StatusChangeEvent) => void): () => void {
    this.statusHandler = handler;
    return () => {
      this.statusHandler = undefined;
    };
  }
  receiveMessage(message: AgentMessage): Promise<void> {
    this.receivedMessages.push(message);
    return Promise.resolve();
  }
  createThread(options: ThreadOptions): Promise<string> {
    const threadId = `thread-${++this.threadSequence}`;
    this.createdThreads.push({ threadId, options });
    this.threads.push({ threadId, status: 'initialized', goal: options.goal });
    return Promise.resolve(threadId);
  }
  getThread(threadId: string): Promise<ThreadInfo> {
    return Promise.resolve(this.threads.find((thread) => thread.threadId === threadId)!);
  }
  getThreads(): Promise<ThreadInfo[]> {
    return Promise.resolve(this.threads);
  }
  startThread(threadId: string): Promise<void> {
    this.startedThreads.push(threadId);
    this.threads = this.threads.map((thread) =>
      thread.threadId === threadId ? { ...thread, status: 'running' } : thread
    );
    return Promise.resolve();
  }
  completeThread(): Promise<void> {
    return Promise.resolve();
  }
  pauseThread(): Promise<void> {
    return Promise.resolve();
  }
  resumeThread(): Promise<void> {
    return Promise.resolve();
  }
  terminateThread(): Promise<void> {
    return Promise.resolve();
  }
  destroyThread(): Promise<void> {
    return Promise.resolve();
  }
  getMessages(): Promise<AgentMessage[]> {
    return Promise.resolve([]);
  }

  emitOutbound(message: AgentMessage): void {
    this.messageHandler?.(message);
  }

  emitStatus(
    event: StatusChangeEvent & { summary?: string; diagnostics?: string }
  ): void {
    if (event.threadId) {
      this.threads = this.threads.map((thread) =>
        thread.threadId === event.threadId
          ? { ...thread, status: event.status as ThreadInfo['status'] }
          : thread
      );
    }
    this.statusHandler?.(event);
  }
}

const timestamp = '2026-08-02T00:00:00.000Z';

function taskResponse(status: 'assigned' | 'in_progress' | 'blocked' | 'completed' | 'failed') {
  return {
    task: {
      id: 'task-1',
      title: 'Prepare release',
      description: 'Ship it safely',
      creatorId: 'owner-1',
      status,
      assigneeId: 'agent-1',
      roomId: 'room-1',
      latestResultId: status === 'completed' ? 'result-1' : null,
      createdAt: timestamp,
      updatedAt: timestamp,
      assignedAt: timestamp,
      startedAt: status === 'assigned' ? null : timestamp,
      completedAt: status === 'completed' ? timestamp : null,
    },
  };
}

function requestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function requestBody(init?: RequestInit): string {
  return typeof init?.body === 'string' ? init.body : '';
}

function createFetchMock() {
  const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = requestUrl(input);
    if (url.includes('/rooms') && url.includes('/participants/')) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ rooms: [] }) });
    }
    if (url.includes('/tasks/task-1/start')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(taskResponse('in_progress')),
      });
    }
    if (url.includes('/tasks/task-1/block')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(taskResponse('blocked')),
      });
    }
    if (url.includes('/tasks/task-1/resume')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(taskResponse('in_progress')),
      });
    }
    if (url.includes('/tasks/task-1/submit')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(taskResponse('completed')),
      });
    }
    if (url.includes('/tasks/task-1/fail')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(taskResponse('failed')),
      });
    }
    if (init?.method === 'PATCH') {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    }
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function createGateway() {
  const client = new FakeMqttClient();
  const agents = new Map<string, FakeAgent>();
  const connectFn = vi.fn(() => {
    setImmediate(() => client.emit('connect'));
    return client as unknown as MqttClient;
  });
  const gateway = new AgentGateway({
    gatewayId: 'gateway-1',
    serverUrl: 'http://localhost:3000',
    brokerUrl: 'mqtt://localhost:1883',
    token: 'gateway-token',
    connectFn,
    stateDbPath: ':memory:',
    agentFactory: (agentId) => {
      const agent = new FakeAgent(agentId);
      agents.set(agentId, agent);
      return agent;
    },
    logger: noopLogger,
  });
  return { gateway, client, agents };
}

function spawnCommand(agentId: string): Buffer {
  return Buffer.from(JSON.stringify({ type: 'agent.spawn', participantId: agentId }));
}

function deliveredMessage(input: {
  id: string;
  from: string;
  body: string;
  metadata?: Record<string, unknown>;
  intent?: 'task' | 'question';
}): Buffer {
  return Buffer.from(
    JSON.stringify({
      type: 'message.delivered',
      message: {
        id: input.id,
        roomId: 'room-1',
        from: input.from,
        content: { type: 'text', body: input.body },
        timestamp,
        ...(input.intent ? { intent: input.intent } : {}),
        ...(input.metadata ? { metadata: input.metadata } : {}),
      },
    })
  );
}

const assignmentMetadata = {
  opcTask: {
    kind: 'assignment',
    taskId: 'task-1',
    assignmentId: 'assignment-1',
    assigneeId: 'agent-1',
  },
};

async function spawn(
  client: FakeMqttClient,
  agents: Map<string, FakeAgent>,
  agentId = 'agent-1'
): Promise<FakeAgent> {
  client.emit('message', MQTT_TOPICS.gatewayControl('gateway-1'), spawnCommand(agentId));
  await vi.waitFor(() => expect(agents.has(agentId)).toBe(true));
  return agents.get(agentId)!;
}

function taskCallbackCalls(fetchMock: ReturnType<typeof createFetchMock>) {
  return fetchMock.mock.calls.filter(([input]) =>
    requestUrl(input).includes('/api/v1/tasks/task-1/')
  );
}

describe('AgentGateway durable task execution (issue #106)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates one goal thread for a task dispatch and routes a human reply to that exact thread', async () => {
    const fetchMock = createFetchMock();
    const { gateway, client, agents } = createGateway();
    await gateway.start();
    const agent = await spawn(client, agents);

    const dispatch = deliveredMessage({
      id: 'dispatch-1',
      from: 'owner-1',
      body: 'Prepare release\n\nShip it safely',
      intent: 'task',
      metadata: assignmentMetadata,
    });
    client.emit('message', MQTT_TOPICS.agentEvents('agent-1'), dispatch);
    client.emit('message', MQTT_TOPICS.agentEvents('agent-1'), dispatch);

    await vi.waitFor(() => expect(agent.createdThreads).toHaveLength(1));
    expect(agent.createdThreads[0].options).toMatchObject({ mode: 'goal' });
    const threadId = agent.createdThreads[0].threadId;
    await vi.waitFor(() =>
      expect(taskCallbackCalls(fetchMock).map(([input]) => requestUrl(input))).toContain(
        'http://localhost:3000/api/v1/tasks/task-1/start'
      )
    );

    client.emit(
      'message',
      MQTT_TOPICS.agentEvents('agent-1'),
      deliveredMessage({ id: 'human-reply-1', from: 'owner-1', body: 'Deploy to us-east-1' })
    );
    await vi.waitFor(() => expect(agent.receivedMessages).toHaveLength(1));
    expect(agent.receivedMessages[0]).toMatchObject({
      id: 'human-reply-1',
      threadId,
      content: { body: 'Deploy to us-east-1' },
    });
    expect(agent.createdThreads).toHaveLength(1);

    await gateway.stop();
  });

  it('does not execute a task dispatch addressed to another agent room member', async () => {
    createFetchMock();
    const { gateway, client, agents } = createGateway();
    await gateway.start();
    const collaborator = await spawn(client, agents, 'collaborator-agent');

    client.emit(
      'message',
      MQTT_TOPICS.agentEvents('collaborator-agent'),
      deliveredMessage({
        id: 'dispatch-1',
        from: 'owner-1',
        body: 'Prepare release',
        intent: 'task',
        metadata: assignmentMetadata,
      })
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(collaborator.createdThreads).toEqual([]);

    await gateway.stop();
  });

  it('serializes start, block, resume, and submit callbacks while keeping task replies in the room', async () => {
    const fetchMock = createFetchMock();
    const { gateway, client, agents } = createGateway();
    await gateway.start();
    const agent = await spawn(client, agents);
    client.emit(
      'message',
      MQTT_TOPICS.agentEvents('agent-1'),
      deliveredMessage({
        id: 'dispatch-1',
        from: 'owner-1',
        body: 'Prepare release',
        intent: 'task',
        metadata: assignmentMetadata,
      })
    );
    await vi.waitFor(() => expect(agent.createdThreads).toHaveLength(1));
    const threadId = agent.createdThreads[0].threadId;

    agent.emitOutbound({
      id: 'agent-question-1',
      timestamp: Date.now(),
      from: 'agent-1',
      threadId,
      content: { type: 'text', body: 'Which region should I deploy to?' },
    });
    agent.emitStatus({ threadId, status: 'waiting' });
    await vi.waitFor(() =>
      expect(taskCallbackCalls(fetchMock).map(([input]) => requestUrl(input))).toContain(
        'http://localhost:3000/api/v1/tasks/task-1/block'
      )
    );

    client.emit(
      'message',
      MQTT_TOPICS.agentEvents('agent-1'),
      deliveredMessage({ id: 'human-reply-1', from: 'owner-1', body: 'us-east-1' })
    );
    await vi.waitFor(() => expect(agent.receivedMessages).toHaveLength(1));
    await vi.waitFor(() =>
      expect(taskCallbackCalls(fetchMock).map(([input]) => requestUrl(input))).toContain(
        'http://localhost:3000/api/v1/tasks/task-1/resume'
      )
    );

    agent.emitStatus({ threadId, status: 'done', summary: 'Release prepared for us-east-1' });
    await vi.waitFor(() =>
      expect(taskCallbackCalls(fetchMock).map(([input]) => requestUrl(input))).toContain(
        'http://localhost:3000/api/v1/tasks/task-1/submit'
      )
    );

    const callbacks = taskCallbackCalls(fetchMock);
    expect(callbacks.map(([input]) => requestUrl(input).split('/').at(-1))).toEqual([
      'start',
      'block',
      'resume',
      'submit',
    ]);
    expect(callbacks[1][1]?.headers).toEqual(
      expect.objectContaining({
        Authorization: 'Bearer gateway-token',
        'x-opc-actor-id': 'agent-1',
      })
    );
    expect(requestBody(callbacks[1][1])).toContain(
      'Which region should I deploy to?'
    );
    expect(requestBody(callbacks[3][1])).toContain(
      'Release prepared for us-east-1'
    );
    expect(client.publish).toHaveBeenCalledWith(
      MQTT_TOPICS.participantUplink('agent-1', 'room-1'),
      expect.stringContaining('"threadId":"thread-1"'),
      { qos: 1 },
      expect.any(Function)
    );

    await gateway.stop();
  });

  it('fails once with bounded redacted diagnostics when the runtime errors', async () => {
    const fetchMock = createFetchMock();
    const { gateway, client, agents } = createGateway();
    await gateway.start();
    const agent = await spawn(client, agents);
    client.emit(
      'message',
      MQTT_TOPICS.agentEvents('agent-1'),
      deliveredMessage({
        id: 'dispatch-1',
        from: 'owner-1',
        body: 'Prepare release',
        intent: 'task',
        metadata: assignmentMetadata,
      })
    );
    await vi.waitFor(() => expect(agent.createdThreads).toHaveLength(1));
    const threadId = agent.createdThreads[0].threadId;
    agent.emitStatus({
      threadId,
      status: 'error',
      diagnostics: `provider failed apiKey=super-secret-token ${'x'.repeat(10_000)}`,
    });
    agent.emitStatus({
      threadId,
      status: 'error',
      diagnostics: `provider failed apiKey=super-secret-token ${'x'.repeat(10_000)}`,
    });

    await vi.waitFor(() =>
      expect(taskCallbackCalls(fetchMock).map(([input]) => requestUrl(input))).toContain(
        'http://localhost:3000/api/v1/tasks/task-1/fail'
      )
    );
    const failures = taskCallbackCalls(fetchMock).filter(([input]) =>
      requestUrl(input).endsWith('/fail')
    );
    expect(failures).toHaveLength(1);
    const body = requestBody(failures[0][1]);
    expect(body).not.toContain('super-secret-token');
    expect(body.length).toBeLessThan(2_500);

    await gateway.stop();
  });
});
