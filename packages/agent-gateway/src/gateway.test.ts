import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { MqttClient } from 'mqtt';
import type { AgentMessage, AgentStatus, IAgent, ThreadInfo, ThreadOptions } from '@opc/agent-edge';
import { MQTT_TOPICS } from '@logact-pub/opc-protocol';
import { AgentGateway } from './gateway.js';

class FakeMqttClient extends EventEmitter {
  subscribe = vi.fn((_topic: string, _opts: unknown, cb?: (err: Error | null) => void) => cb?.(null));
  publish = vi.fn();
  end = vi.fn((_force: boolean, _opts: unknown, cb?: () => void) => cb?.());
}

/* eslint-disable @typescript-eslint/require-await */
class FakeAgent extends EventEmitter implements IAgent {
  readonly agentId: string;
  status = 'running';
  destroyed = false;
  private messageHandler?: (message: AgentMessage) => void;
  private threadIdSeq = 0;
  readonly createdThreads: Array<{ threadId: string; options: ThreadOptions }> = [];
  readonly startedThreads: string[] = [];

  constructor(agentId: string) {
    super();
    this.agentId = agentId;
  }

  async initialize(): Promise<void> {}
  async start(): Promise<void> {}
  async pause(): Promise<void> {}
  async resume(): Promise<void> {}
  async terminate(): Promise<void> {}
  async destroy(): Promise<void> {
    this.destroyed = true;
  }
  async getInfo() {
    return { agentId: this.agentId, status: this.status as AgentStatus, threadIds: [] };
  }
  onMessage(handler: (message: AgentMessage) => void): () => void {
    this.messageHandler = handler;
    return () => {
      this.messageHandler = undefined;
    };
  }
  onStatusChange(): () => void {
    return () => undefined;
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
  async getThreads() {
    return [];
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

function createFetchMock() {
  return vi.fn().mockImplementation((url: string) => {
    if (url.includes('/api/v1/rooms')) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            rooms: [{ id: 'room-1', name: 'r', participantIds: ['lobe'], createdAt: '' }],
          }),
      });
    }
    return Promise.resolve({ ok: false, status: 404 });
  });
}

function createGateway(options: { agentFactory: (id: string) => IAgent }) {
  const { connectFn, clients } = createFakeMqttConnect();
  globalThis.fetch = createFetchMock();

  const gateway = new AgentGateway({
    gatewayId: 'gw-1',
    serverUrl: 'http://localhost:3000',
    brokerUrl: 'mqtt://localhost:1883',
    token: 'gw-token',
    connectFn,
    agentFactory: options.agentFactory,
    roomSyncIntervalMs: 60_000,
  });

  return { gateway, connectFn, clients };
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

  it('spawns agent and connects its mqtt client on agent.spawn command', async () => {
    const agents = new Map<string, FakeAgent>();
    const { gateway, clients } = createGateway({
      agentFactory: (id) => {
        const agent = new FakeAgent(id);
        agents.set(id, agent);
        return agent;
      },
    });

    await gateway.start();
    const controlClient = clients[0];
    controlClient.emit(
      'message',
      MQTT_TOPICS.gatewayControl('gw-1'),
      Buffer.from(JSON.stringify({ type: 'agent.spawn', participantId: 'lobe', token: 'agent-tok' }))
    );

    await vi.waitFor(() => expect(agents.has('lobe')).toBe(true));
    await vi.waitFor(() => expect(clients).toHaveLength(2));

    const agentClient = clients[1];
    expect(agentClient.subscribe).toHaveBeenCalledWith(
      MQTT_TOPICS.events('room-1'),
      { qos: 1 },
      expect.any(Function)
    );
  });

  it('creates and starts thread when room message is delivered', async () => {
    const agents = new Map<string, FakeAgent>();
    const { gateway, clients } = createGateway({
      agentFactory: (id) => {
        const agent = new FakeAgent(id);
        agents.set(id, agent);
        return agent;
      },
    });

    await gateway.start();
    const controlClient = clients[0];
    controlClient.emit(
      'message',
      MQTT_TOPICS.gatewayControl('gw-1'),
      Buffer.from(JSON.stringify({ type: 'agent.spawn', participantId: 'lobe', token: 'agent-tok' }))
    );

    await vi.waitFor(() => expect(agents.has('lobe')).toBe(true));
    await vi.waitFor(() => expect(clients).toHaveLength(2));
    const agent = agents.get('lobe')!;
    const agentClient = clients[1];

    agentClient.emit(
      'message',
      MQTT_TOPICS.events('room-1'),
      Buffer.from(
        JSON.stringify({
          type: 'message.delivered',
          message: {
            id: 'msg-1',
            roomId: 'room-1',
            from: 'alice',
            content: { type: 'text', body: 'hello' },
            timestamp: new Date().toISOString(),
          },
        })
      )
    );

    await vi.waitFor(() => expect(agent.createdThreads).toHaveLength(1));
    expect(agent.createdThreads[0].options.goal).toBe('Message from alice: hello');
    expect(agent.startedThreads).toEqual([agent.createdThreads[0].threadId]);
  });

  it('drops own message echoes to prevent loops', async () => {
    const agents = new Map<string, FakeAgent>();
    const { gateway, clients } = createGateway({
      agentFactory: (id) => {
        const agent = new FakeAgent(id);
        agents.set(id, agent);
        return agent;
      },
    });

    await gateway.start();
    const controlClient = clients[0];
    controlClient.emit(
      'message',
      MQTT_TOPICS.gatewayControl('gw-1'),
      Buffer.from(JSON.stringify({ type: 'agent.spawn', participantId: 'lobe', token: 'agent-tok' }))
    );

    await vi.waitFor(() => expect(agents.has('lobe')).toBe(true));
    await vi.waitFor(() => expect(clients).toHaveLength(2));
    const agent = agents.get('lobe')!;
    const agentClient = clients[1];

    agentClient.emit(
      'message',
      MQTT_TOPICS.events('room-1'),
      Buffer.from(
        JSON.stringify({
          type: 'message.delivered',
          message: {
            id: 'msg-2',
            roomId: 'room-1',
            from: 'lobe',
            content: { type: 'text', body: 'my own echo' },
            timestamp: new Date().toISOString(),
          },
        })
      )
    );

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(agent.createdThreads).toHaveLength(0);
  });

  it('publishes agent outbound message to uplink with mapped room', async () => {
    const agents = new Map<string, FakeAgent>();
    const { gateway, clients } = createGateway({
      agentFactory: (id) => {
        const agent = new FakeAgent(id);
        agents.set(id, agent);
        return agent;
      },
    });

    await gateway.start();
    const controlClient = clients[0];
    controlClient.emit(
      'message',
      MQTT_TOPICS.gatewayControl('gw-1'),
      Buffer.from(JSON.stringify({ type: 'agent.spawn', participantId: 'lobe', token: 'agent-tok' }))
    );

    await vi.waitFor(() => expect(agents.has('lobe')).toBe(true));
    await vi.waitFor(() => expect(clients).toHaveLength(2));
    const agent = agents.get('lobe')!;
    const agentClient = clients[1];

    agentClient.emit(
      'message',
      MQTT_TOPICS.events('room-1'),
      Buffer.from(
        JSON.stringify({
          type: 'message.delivered',
          message: {
            id: 'msg-3',
            roomId: 'room-1',
            from: 'alice',
            content: { type: 'text', body: 'question' },
            timestamp: new Date().toISOString(),
          },
        })
      )
    );

    await vi.waitFor(() => expect(agent.createdThreads).toHaveLength(1));
    const threadId = agent.createdThreads[0].threadId;

    agent.emitOutbound({
      id: 'reply-1',
      timestamp: Date.now(),
      from: 'lobe',
      threadId,
      content: { type: 'text', body: 'answer' },
    });

    await vi.waitFor(() => expect(agentClient.publish).toHaveBeenCalled());
    expect(agentClient.publish).toHaveBeenCalledWith(
      MQTT_TOPICS.uplink('room-1'),
      JSON.stringify({ from: 'lobe', content: { type: 'text', body: 'answer' }, clientMessageId: 'reply-1' }),
      { qos: 1 },
      expect.any(Function)
    );
  });

  it('stops agent and cleans up on agent.stop command', async () => {
    const agents = new Map<string, FakeAgent>();
    const { gateway, clients } = createGateway({
      agentFactory: (id) => {
        const agent = new FakeAgent(id);
        agents.set(id, agent);
        return agent;
      },
    });

    await gateway.start();
    const controlClient = clients[0];
    controlClient.emit(
      'message',
      MQTT_TOPICS.gatewayControl('gw-1'),
      Buffer.from(JSON.stringify({ type: 'agent.spawn', participantId: 'lobe', token: 'agent-tok' }))
    );

    await vi.waitFor(() => expect(agents.has('lobe')).toBe(true));
    await vi.waitFor(() => expect(clients).toHaveLength(2));

    controlClient.emit(
      'message',
      MQTT_TOPICS.gatewayControl('gw-1'),
      Buffer.from(JSON.stringify({ type: 'agent.stop', participantId: 'lobe' }))
    );

    await vi.waitFor(() => expect(agents.get('lobe')!.destroyed).toBe(true));
    const agentClient = clients.find((c) => c !== controlClient)!;
    expect(agentClient.end).toHaveBeenCalled();
  });
});
