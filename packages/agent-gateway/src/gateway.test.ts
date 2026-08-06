import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
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
  subscribe = vi.fn((_topic: string, _opts: unknown, cb?: (err: Error | null) => void) => cb?.(null));
  unsubscribe = vi.fn((_topic: string, cb?: (err: Error | null) => void) => cb?.(null));
  // 与真实 mqtt.js 一致：触发 publish 回调（gateway 的优雅离线会等待 PUBACK）
  publish = vi.fn((...args: unknown[]) => {
    const cb = args.find((a) => typeof a === 'function') as (() => void) | undefined;
    cb?.();
  });
  end = vi.fn((_force: boolean, _opts: unknown, cb?: () => void) => cb?.());
}

/* eslint-disable @typescript-eslint/require-await */
class FakeAgent extends EventEmitter implements IAgent {
  readonly agentId: string;
  status = 'running';
  destroyed = false;
  failOnStart = false;
  private messageHandler?: (message: AgentMessage) => void;
  private statusHandler?: (event: StatusChangeEvent) => void;
  private threadIdSeq = 0;
  readonly createdThreads: Array<{ threadId: string; options: ThreadOptions }> = [];
  readonly startedThreads: string[] = [];

  constructor(agentId: string) {
    super();
    this.agentId = agentId;
  }

  async initialize(): Promise<void> {}
  async start(): Promise<void> {
    if (this.failOnStart) throw new Error('invalid model api key');
  }
  async pause(): Promise<void> {}
  async resume(): Promise<void> {}
  async terminate(): Promise<void> {}
  async destroy(): Promise<void> {
    this.destroyed = true;
  }
  async getInfo() {
    return {
      agentId: this.agentId,
      status: this.status as AgentStatus,
      activity: 'idle' as const,
      threadIds: [],
    };
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
  async receiveMessage(): Promise<void> {}
  async createThread(options: ThreadOptions): Promise<string> {
    const threadId = `thread-${++this.threadIdSeq}`;
    this.createdThreads.push({ threadId, options });
    return threadId;
  }
  async getThread(): Promise<ThreadInfo> {
    return { threadId: 't', status: 'running', goal: 'g' };
  }
  /** 测试可直接改写，驱动 gateway 的忙闲聚合。 */
  threads: ThreadInfo[] = [];
  async getThreads() {
    return this.threads;
  }
  async startThread(threadId: string): Promise<void> {
    this.startedThreads.push(threadId);
  }
  async pauseThread(): Promise<void> {}
  async completeThread(): Promise<void> {}
  async resumeThread(): Promise<void> {}
  async terminateThread(): Promise<void> {}
  async destroyThread(): Promise<void> {}
  async getMessages(): Promise<AgentMessage[]> {
    return [];
  }

  emitOutbound(message: AgentMessage): void {
    this.messageHandler?.(message);
  }

  emitStatusChange(event: StatusChangeEvent): void {
    this.statusHandler?.(event);
  }
}
/* eslint-enable @typescript-eslint/require-await */

function createFakeMqttConnect() {
  const clients: FakeMqttClient[] = [];
  const connectFn = vi.fn(() => {
    const client = new FakeMqttClient();
    clients.push(client);
    // simulate async connect
    setImmediate(() => client.emit('connect'));
    return client as unknown as MqttClient;
  });
  return { connectFn, clients };
}

function createGateway(options: { agentFactory: (id: string) => IAgent }) {
  const { connectFn, clients } = createFakeMqttConnect();
  // model catalog PATCH 走 mock，避免测试触发真实 HTTP
  globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });

  const gateway = new AgentGateway({
    gatewayId: 'gw-1',
    serverUrl: 'http://localhost:3000',
    brokerUrl: 'mqtt://localhost:1883',
    token: 'gw-token',
    connectFn,
    agentFactory: options.agentFactory,
    logger: noopLogger,
  });

  return { gateway, connectFn, clients };
}

function spawnCommand(participantId: string) {
  return Buffer.from(JSON.stringify({ type: 'agent.spawn', participantId }));
}

/** 发送 spawn 命令并等待 spawn 完成（以订阅 agent events topic 为标志） */
async function spawnAndWait(client: FakeMqttClient, agents: Map<string, FakeAgent>, participantId: string) {
  client.emit('message', MQTT_TOPICS.gatewayControl('gw-1'), spawnCommand(participantId));
  await vi.waitFor(() =>
    expect(client.subscribe).toHaveBeenCalledWith(
      MQTT_TOPICS.agentEvents(participantId),
      { qos: 1 },
      expect.any(Function)
    )
  );
  return agents.get(participantId)!;
}

function roomMessage(id: string, from: string, body: string, timestamp = new Date().toISOString()) {
  return Buffer.from(
    JSON.stringify({
      type: 'message.delivered',
      message: {
        id,
        roomId: 'room-1',
        from,
        content: { type: 'text', body },
        timestamp,
      },
    })
  );
}

describe('AgentGateway', () => {
  it('connects and subscribes its control topic on start', async () => {
    const { gateway, clients } = createGateway({ agentFactory: (id) => new FakeAgent(id) });

    await gateway.start();

    expect(clients).toHaveLength(1);
    expect(clients[0].subscribe).toHaveBeenCalledWith(
      MQTT_TOPICS.gatewayControl('gw-1'),
      { qos: 1 },
      expect.any(Function)
    );
  });

  it('rejects a malformed brokerUrl before connecting', async () => {
    const connectFn = vi.fn();
    const gateway = new AgentGateway({
      gatewayId: 'gw-1',
      serverUrl: 'http://localhost:3000',
      brokerUrl: 'not a url',
      token: 'gw-token',
      connectFn,
      agentFactory: (id) => new FakeAgent(id),
      logger: noopLogger,
    });

    await expect(gateway.start()).rejects.toThrow('not a valid URL');
    expect(connectFn).not.toHaveBeenCalled();
  });

  it('rejects an unsupported brokerUrl protocol before connecting', async () => {
    const connectFn = vi.fn();
    const gateway = new AgentGateway({
      gatewayId: 'gw-1',
      serverUrl: 'http://localhost:3000',
      brokerUrl: 'http://localhost:9001',
      token: 'gw-token',
      connectFn,
      agentFactory: (id) => new FakeAgent(id),
      logger: noopLogger,
    });

    await expect(gateway.start()).rejects.toThrow('unsupported protocol "http:"');
    expect(connectFn).not.toHaveBeenCalled();
  });

  it('hints at ws:// when the broker port speaks non-MQTT bytes', async () => {
    // 用 mqtt:// 连 WebSocket listener 时，mqtt-packet 会把 HTTP 字节流
    // 当成 MQTT 报文解析，抛出 "Invalid header flag bits ..." 之类的错误
    const connectFn = vi.fn(() => {
      const client = new FakeMqttClient();
      setImmediate(() =>
        client.emit('error', new Error('Invalid header flag bits, must be 0x0 for puback packet'))
      );
      return client as unknown as MqttClient;
    });
    const gateway = new AgentGateway({
      gatewayId: 'gw-1',
      serverUrl: 'http://localhost:3000',
      brokerUrl: 'mqtt://localhost:9001',
      token: 'gw-token',
      connectFn,
      agentFactory: (id) => new FakeAgent(id),
      logger: noopLogger,
    });

    await expect(gateway.start()).rejects.toThrow(/non-MQTT bytes.*ws:\/\/ brokerUrl/s);
  });

  it('spawns agent on the same single connection: subscribes agent topic and publishes presence', async () => {
    const agents = new Map<string, FakeAgent>();
    const { gateway, clients } = createGateway({
      agentFactory: (id) => {
        const agent = new FakeAgent(id);
        agents.set(id, agent);
        return agent;
      },
    });

    await gateway.start();
    const client = clients[0];
    client.emit('message', MQTT_TOPICS.gatewayControl('gw-1'), spawnCommand('lobe'));

    await vi.waitFor(() =>
      expect(client.subscribe).toHaveBeenCalledWith(
        MQTT_TOPICS.agentEvents('lobe'),
        { qos: 1 },
        expect.any(Function)
      )
    );

    // 单连接多路复用：不再有第二个 MQTT client
    expect(clients).toHaveLength(1);
    expect(client.publish).toHaveBeenCalledWith(
      MQTT_TOPICS.presence('lobe'),
      JSON.stringify({ online: true, status: 'idle' }),
      { qos: 1, retain: true }
    );
  });

  it('routes agent events topic messages to the matching agent runtime', async () => {
    const agents = new Map<string, FakeAgent>();
    const { gateway, clients } = createGateway({
      agentFactory: (id) => {
        const agent = new FakeAgent(id);
        agents.set(id, agent);
        return agent;
      },
    });

    await gateway.start();
    const client = clients[0];
    const agent = await spawnAndWait(client, agents, 'lobe');

    client.emit('message', MQTT_TOPICS.agentEvents('lobe'), roomMessage('msg-1', 'alice', 'hello'));

    await vi.waitFor(() => expect(agent.createdThreads).toHaveLength(1));
    expect(agent.createdThreads[0].options.goal).toBe(' hello');
    expect(agent.startedThreads).toEqual([agent.createdThreads[0].threadId]);
  });

  it('publishes a read receipt after a thread takes over the message', async () => {
    const agents = new Map<string, FakeAgent>();
    const { gateway, clients } = createGateway({
      agentFactory: (id) => {
        const agent = new FakeAgent(id);
        agents.set(id, agent);
        return agent;
      },
    });

    await gateway.start();
    const client = clients[0];
    const agent = await spawnAndWait(client, agents, 'lobe');

    const timestamp = '2026-08-05T12:00:00.000Z';
    client.emit('message', MQTT_TOPICS.agentEvents('lobe'), roomMessage('msg-read', 'alice', 'hi', timestamp));

    await vi.waitFor(() => expect(agent.createdThreads).toHaveLength(1));
    expect(client.publish).toHaveBeenCalledWith(
      MQTT_TOPICS.reads('room-1'),
      JSON.stringify({ from: 'lobe', lastReadAt: timestamp }),
      { qos: 1 },
      expect.any(Function)
    );
  });

  it('drops events for unknown agents and own echoes', async () => {
    const agents = new Map<string, FakeAgent>();
    const { gateway, clients } = createGateway({
      agentFactory: (id) => {
        const agent = new FakeAgent(id);
        agents.set(id, agent);
        return agent;
      },
    });

    await gateway.start();
    const client = clients[0];
    const agent = await spawnAndWait(client, agents, 'lobe');

    client.emit('message', MQTT_TOPICS.agentEvents('ghost'), roomMessage('msg-x', 'alice', 'hi'));
    client.emit('message', MQTT_TOPICS.agentEvents('lobe'), roomMessage('msg-2', 'lobe', 'my own echo'));

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(agent.createdThreads).toHaveLength(0);
  });

  it('publishes agent outbound message to uplink via the gateway connection', async () => {
    const agents = new Map<string, FakeAgent>();
    const { gateway, clients } = createGateway({
      agentFactory: (id) => {
        const agent = new FakeAgent(id);
        agents.set(id, agent);
        return agent;
      },
    });

    await gateway.start();
    const client = clients[0];
    const agent = await spawnAndWait(client, agents, 'lobe');

    client.emit('message', MQTT_TOPICS.agentEvents('lobe'), roomMessage('msg-3', 'alice', 'question'));
    await vi.waitFor(() => expect(agent.createdThreads).toHaveLength(1));
    const threadId = agent.createdThreads[0].threadId;

    agent.emitOutbound({
      id: 'reply-1',
      timestamp: Date.now(),
      from: 'lobe',
      threadId,
      content: { type: 'text', body: 'answer' },
    });

    await vi.waitFor(() =>
      expect(client.publish).toHaveBeenCalledWith(
        MQTT_TOPICS.uplink('room-1'),
        JSON.stringify({ from: 'lobe', content: { type: 'text', body: 'answer' }, clientMessageId: 'reply-1' }),
        { qos: 1 },
        expect.any(Function)
      )
    );
  });

  it('marks agent offline when spawn fails (e.g. invalid model config)', async () => {
    const { gateway, clients } = createGateway({
      agentFactory: (id) => {
        const agent = new FakeAgent(id);
        agent.failOnStart = true;
        return agent;
      },
    });

    await gateway.start();
    const client = clients[0];
    client.emit('message', MQTT_TOPICS.gatewayControl('gw-1'), spawnCommand('lobe'));

    await vi.waitFor(() =>
      expect(client.publish).toHaveBeenCalledWith(
        MQTT_TOPICS.presence('lobe'),
        JSON.stringify({ online: false }),
        { qos: 1, retain: true }
      )
    );
    // 失败的 agent 不订阅 events topic
    expect(client.subscribe).not.toHaveBeenCalledWith(
      MQTT_TOPICS.agentEvents('lobe'),
      { qos: 1 },
      expect.any(Function)
    );
  });

  it('publishes error status (staying online) when a thread runs into error', async () => {
    const agents = new Map<string, FakeAgent>();
    const { gateway, clients } = createGateway({
      agentFactory: (id) => {
        const agent = new FakeAgent(id);
        agents.set(id, agent);
        return agent;
      },
    });

    await gateway.start();
    const client = clients[0];
    const agent = await spawnAndWait(client, agents, 'lobe');

    // thread 失败 → status:'error'，online 保持 true（offline 只表达连接层不可用）
    agent.threads = [{ threadId: 'thread-1', status: 'error', goal: 'g' }];
    agent.emitStatusChange({ threadId: 'thread-1', status: 'error' });

    await vi.waitFor(() =>
      expect(client.publish).toHaveBeenCalledWith(
        MQTT_TOPICS.presence('lobe'),
        JSON.stringify({ online: true, status: 'error' }),
        { qos: 1, retain: true }
      )
    );
    expect(client.publish).not.toHaveBeenCalledWith(
      MQTT_TOPICS.presence('lobe'),
      JSON.stringify({ online: false }),
      { qos: 1, retain: true }
    );
  });

  it('publishes aggregated activity on thread status changes, debounced', async () => {
    const agents = new Map<string, FakeAgent>();
    const { gateway, clients } = createGateway({
      agentFactory: (id) => {
        const agent = new FakeAgent(id);
        agents.set(id, agent);
        return agent;
      },
    });

    await gateway.start();
    const client = clients[0];
    const agent = await spawnAndWait(client, agents, 'lobe');

    const presenceCalls = () =>
      client.publish.mock.calls.filter((call) => call[0] === MQTT_TOPICS.presence('lobe'));

    agent.threads = [{ threadId: 'thread-1', status: 'running', goal: 'g' }];
    agent.emitStatusChange({ threadId: 'thread-1', status: 'running' });
    await vi.waitFor(() =>
      expect(client.publish).toHaveBeenCalledWith(
        MQTT_TOPICS.presence('lobe'),
        JSON.stringify({ online: true, status: 'working' }),
        { qos: 1, retain: true }
      )
    );

    agent.threads = [{ threadId: 'thread-1', status: 'waiting', goal: 'g' }];
    agent.emitStatusChange({ threadId: 'thread-1', status: 'waiting' });
    await vi.waitFor(() =>
      expect(client.publish).toHaveBeenCalledWith(
        MQTT_TOPICS.presence('lobe'),
        JSON.stringify({ online: true, status: 'blocking' }),
        { qos: 1, retain: true }
      )
    );

    // 状态未变的重复事件不再发布
    const before = presenceCalls().length;
    agent.emitStatusChange({ threadId: 'thread-1', status: 'waiting' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(presenceCalls().length).toBe(before);
  });

  it('stops agent on agent.stop command: offline presence, unsubscribe, destroy', async () => {
    const agents = new Map<string, FakeAgent>();
    const { gateway, clients } = createGateway({
      agentFactory: (id) => {
        const agent = new FakeAgent(id);
        agents.set(id, agent);
        return agent;
      },
    });

    await gateway.start();
    const client = clients[0];
    await spawnAndWait(client, agents, 'lobe');

    client.emit(
      'message',
      MQTT_TOPICS.gatewayControl('gw-1'),
      Buffer.from(JSON.stringify({ type: 'agent.stop', participantId: 'lobe' }))
    );

    await vi.waitFor(() => expect(agents.get('lobe')!.destroyed).toBe(true));
    expect(client.publish).toHaveBeenCalledWith(
      MQTT_TOPICS.presence('lobe'),
      JSON.stringify({ online: false }),
      { qos: 1, retain: true }
    );
    expect(client.unsubscribe).toHaveBeenCalledWith(MQTT_TOPICS.agentEvents('lobe'));
    // 单连接：stop agent 不关闭 gateway 连接
    expect(client.end).not.toHaveBeenCalled();
  });
});
