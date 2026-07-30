import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MqttClient } from 'mqtt';
import type { AgentMessage, AgentStatus, IAgent, ThreadInfo, ThreadOptions } from '@opc/agent-edge';
import { MQTT_TOPICS } from '@logact-pub/opc-protocol';
import { AgentGateway } from './gateway.js';
import { noopLogger } from './logger.js';

class FakeMqttClient extends EventEmitter {
  connected = false;
  subscribe = vi.fn((_topic: string, _opts: unknown, cb?: (err: Error | null) => void) => cb?.(null));
  unsubscribe = vi.fn((_topic: string, cb?: (err: Error | null) => void) => cb?.(null));
  // 与真实 mqtt.js 一致：触发 publish 回调（SDK/gateway 的优雅离线会等待 PUBACK）
  publish = vi.fn((...args: unknown[]) => {
    const cb = args.find((a) => typeof a === 'function') as (() => void) | undefined;
    cb?.();
  });
  end = vi.fn((_force: boolean, _opts: unknown, cb?: () => void) => cb?.());
}

/* eslint-disable @typescript-eslint/require-await */
class FakeAgent extends EventEmitter implements IAgent {
  readonly agentId: string;
  destroyed = false;
  private messageHandler?: (message: AgentMessage) => void;
  private threadIdSeq = 0;
  private readonly threads = new Map<string, ThreadInfo>();
  private readonly messages = new Map<string, AgentMessage[]>();

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
    return {
      agentId: this.agentId,
      status: 'running' as AgentStatus,
      activity: 'idle' as const,
      threadIds: [...this.threads.keys()],
    };
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
    this.threads.set(threadId, { threadId, status: 'running', goal: options.goal });
    this.messages.set(threadId, [
      {
        id: 'm-1',
        timestamp: Date.now(),
        from: 'user',
        threadId,
        content: { type: 'text', body: options.goal },
      },
    ]);
    return threadId;
  }
  async getThread(threadId: string): Promise<ThreadInfo> {
    return this.threads.get(threadId)!;
  }
  async getThreads(): Promise<ThreadInfo[]> {
    return [...this.threads.values()];
  }
  async startThread(): Promise<void> {}
  async pauseThread(): Promise<void> {}
  async completeThread(): Promise<void> {}
  async resumeThread(): Promise<void> {}
  async terminateThread(): Promise<void> {}
  async destroyThread(): Promise<void> {}
  async getMessages(threadId: string): Promise<AgentMessage[]> {
    return this.messages.get(threadId) ?? [];
  }
}
/* eslint-enable @typescript-eslint/require-await */

function createFakeMqttConnect() {
  const clients: FakeMqttClient[] = [];
  const connectFn = vi.fn(() => {
    const client = new FakeMqttClient();
    clients.push(client);
    setImmediate(() => {
      client.connected = true;
      client.emit('connect');
    });
    return client as unknown as MqttClient;
  });
  return { connectFn, clients };
}

describe('AgentGateway admin server', () => {
  const realFetch = globalThis.fetch;
  let gateway: AgentGateway | undefined;

  afterEach(async () => {
    await gateway?.stop();
    gateway = undefined;
    globalThis.fetch = realFetch;
  });

  async function startGatewayWithAdmin() {
    const agents = new Map<string, FakeAgent>();
    const { connectFn, clients } = createFakeMqttConnect();

    gateway = new AgentGateway({
      gatewayId: 'gw-1',
      serverUrl: 'http://localhost:3000',
      brokerUrl: 'mqtt://localhost:1883',
      token: 'gw-token',
      connectFn,
      agentFactory: (id) => {
        const agent = new FakeAgent(id);
        agents.set(id, agent);
        return agent;
      },
      admin: { host: '127.0.0.1', port: 0 },
      logger: noopLogger,
    });

    // OPC HTTP 调用（model catalog 上报）走 mock；admin server 的请求走真实 fetch
    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/v1/')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      return realFetch(url, init);
    }) as typeof fetch;

    await gateway.start();
    const address = gateway.adminAddress();
    expect(address).toBeDefined();
    const baseUrl = `http://127.0.0.1:${address!.port}`;
    return { agents, clients, baseUrl };
  }

  async function spawnAgent(clients: FakeMqttClient[], agents: Map<string, FakeAgent>, id: string) {
    clients[0].emit(
      'message',
      MQTT_TOPICS.gatewayControl('gw-1'),
      Buffer.from(JSON.stringify({ type: 'agent.spawn', participantId: id, token: 'agent-tok' }))
    );
    await vi.waitFor(() => expect(agents.has(id)).toBe(true));
  }

  it('GET /status reports gateway info and live state', async () => {
    const { baseUrl, clients, agents } = await startGatewayWithAdmin();
    await spawnAgent(clients, agents, 'lobe');

    const res = await fetch(`${baseUrl}/status`);
    expect(res.status).toBe(200);
    const status = (await res.json()) as Record<string, unknown>;
    expect(status.gatewayId).toBe('gw-1');
    expect(status.serverUrl).toBe('http://localhost:3000');
    expect(status.mqttConnected).toBe(true);
    expect(status.agentCount).toBe(1);
    expect(status.agentIds).toEqual(['lobe']);
    expect(typeof status.uptimeSec).toBe('number');
  });

  it('GET /agents and /agents/:id expose agent info', async () => {
    const { baseUrl, clients, agents } = await startGatewayWithAdmin();
    await spawnAgent(clients, agents, 'lobe');

    const list = (await (await fetch(`${baseUrl}/agents`)).json()) as {
      agents: Array<{ participantId: string; info: { status: string } }>;
    };
    expect(list.agents).toHaveLength(1);
    expect(list.agents[0].participantId).toBe('lobe');
    expect(list.agents[0].info.status).toBe('running');

    const entry = (await (await fetch(`${baseUrl}/agents/lobe`)).json()) as {
      participantId: string;
      info: { status: string };
    };
    expect(entry.participantId).toBe('lobe');
    expect(entry.info.status).toBe('running');

    const missing = await fetch(`${baseUrl}/agents/nobody`);
    expect(missing.status).toBe(404);
  });

  it('GET threads and messages expose thread data with room mapping', async () => {
    const { baseUrl, clients, agents } = await startGatewayWithAdmin();
    await spawnAgent(clients, agents, 'lobe');
    const agent = agents.get('lobe')!;
    const threadId = await agent.createThread({ goal: 'Message from alice: hi' });
    // 模拟 gateway 收到房间消息后建立的 thread→room 映射
    (gateway as unknown as { threadRoomMap: Map<string, string> }).threadRoomMap.set(threadId, 'room-1');

    const threadsRes = await fetch(`${baseUrl}/agents/lobe/threads`);
    expect(threadsRes.status).toBe(200);
    const { threads } = (await threadsRes.json()) as {
      threads: Array<{ threadId: string; goal: string; roomId?: string }>;
    };
    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({ threadId, goal: 'Message from alice: hi', roomId: 'room-1' });

    const messagesRes = await fetch(`${baseUrl}/agents/lobe/threads/${threadId}/messages`);
    expect(messagesRes.status).toBe(200);
    const { messages } = (await messagesRes.json()) as { messages: AgentMessage[] };
    expect(messages).toHaveLength(1);
    expect(messages[0].content.body).toBe('Message from alice: hi');

    const unknownAgent = await fetch(`${baseUrl}/agents/nobody/threads`);
    expect(unknownAgent.status).toBe(404);
  });

  it('DELETE /agents/:id stops the agent', async () => {
    const { baseUrl, clients, agents } = await startGatewayWithAdmin();
    await spawnAgent(clients, agents, 'lobe');

    const res = await fetch(`${baseUrl}/agents/lobe`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(agents.get('lobe')!.destroyed).toBe(true);

    const after = (await (await fetch(`${baseUrl}/agents`)).json()) as { agents: unknown[] };
    expect(after.agents).toHaveLength(0);

    const again = await fetch(`${baseUrl}/agents/lobe`, { method: 'DELETE' });
    expect(again.status).toBe(404);
  });

  it('returns 404 for unknown routes', async () => {
    const { baseUrl } = await startGatewayWithAdmin();
    const res = await fetch(`${baseUrl}/nope`);
    expect(res.status).toBe(404);
  });
});
