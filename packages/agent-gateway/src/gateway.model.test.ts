import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MqttClient } from 'mqtt';
import type { IAgent } from '@opc/agent-edge';
import { MQTT_TOPICS } from '@logact-pub/opc-protocol';

const { createModelConfigMock, createModelConfigFromEnvMock } = vi.hoisted(() => ({
  createModelConfigMock: vi.fn(() => ({ model: { id: 'mock-model' }, streamFn: vi.fn() })),
  createModelConfigFromEnvMock: vi.fn(() => ({ model: { id: 'env-model' }, streamFn: vi.fn() })),
}));

vi.mock('@opc/agent-edge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@opc/agent-edge')>();
  class FakeRuntime {
    async initialize(): Promise<void> {}
    async start(): Promise<void> {}
    onMessage(): () => void {
      return () => undefined;
    }
    onStatusChange(): () => void {
      return () => undefined;
    }
    async destroy(): Promise<void> {}
  }
  return {
    ...actual,
    AgentRuntime: FakeRuntime,
    createModelConfig: createModelConfigMock,
    createModelConfigFromEnv: createModelConfigFromEnvMock,
  };
});

import { AgentGateway } from './gateway.js';
import { noopLogger } from './logger.js';

class FakeMqttClient extends EventEmitter {
  subscribe = vi.fn((_topic: string, _opts: unknown, cb?: (err: Error | null) => void) => cb?.(null));
  unsubscribe = vi.fn((_topic: string, cb?: (err: Error | null) => void) => cb?.(null));
  // 与真实 mqtt.js 一致：触发 publish 回调（SDK/gateway 的优雅离线会等待 PUBACK）
  publish = vi.fn((...args: unknown[]) => {
    const cb = args.find((a) => typeof a === 'function') as (() => void) | undefined;
    cb?.();
  });
  end = vi.fn((_force: boolean, _opts: unknown, cb?: () => void) => cb?.());
}

function createFakeMqttConnect() {
  const clients: FakeMqttClient[] = [];
  const connectFn = vi.fn(() => {
    const client = new FakeMqttClient();
    clients.push(client);
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

interface TestGatewayOptions {
  modelOptions?: { provider: string; modelId: string; apiKey?: string };
  agentFactory?: (id: string) => IAgent;
}

function createGateway(options: TestGatewayOptions = {}) {
  const { connectFn, clients } = createFakeMqttConnect();
  globalThis.fetch = createFetchMock();

  const gateway = new AgentGateway({
    gatewayId: 'gw-1',
    serverUrl: 'http://localhost:3000',
    brokerUrl: 'mqtt://localhost:1883',
    token: 'gw-token',
    connectFn,
    ...(options.modelOptions && { modelOptions: options.modelOptions }),
    ...(options.agentFactory && { agentFactory: options.agentFactory }),
    logger: noopLogger,
  });

  return { gateway, connectFn, clients };
}

async function startAndSpawn(
  gateway: AgentGateway,
  clients: FakeMqttClient[],
  spawn: Record<string, unknown>
) {
  await gateway.start();
  clients[0].emit(
    'message',
    MQTT_TOPICS.gatewayControl('gw-1'),
    Buffer.from(JSON.stringify(spawn))
  );
  // 订阅 agent events topic 即表示 spawn 流程已走完模型解析与 AgentRuntime 创建
  const participantId = spawn.participantId as string;
  await vi.waitFor(() =>
    expect(clients[0].subscribe).toHaveBeenCalledWith(
      MQTT_TOPICS.agentEvents(participantId),
      { qos: 1 },
      expect.any(Function)
    )
  );
}

describe('AgentGateway model resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses model from spawn command when present', async () => {
    const { gateway, clients } = createGateway({
      modelOptions: { provider: 'anthropic', modelId: 'from-options' },
    });
    const model = { provider: 'deepseek', modelId: 'deepseek-chat', apiKey: 'k' };

    await startAndSpawn(gateway, clients, {
      type: 'agent.spawn',
      participantId: 'lobe',
      token: 'agent-tok',
      name: 'Lobe',
      model,
    });

    expect(createModelConfigMock).toHaveBeenCalledTimes(1);
    expect(createModelConfigMock).toHaveBeenCalledWith(model);
    expect(createModelConfigFromEnvMock).not.toHaveBeenCalled();
    await gateway.stop();
  });

  it('falls back to options.modelOptions when command has no model', async () => {
    const modelOptions = { provider: 'anthropic', modelId: 'from-options' };
    const { gateway, clients } = createGateway({ modelOptions });

    await startAndSpawn(gateway, clients, {
      type: 'agent.spawn',
      participantId: 'lobe',
      token: 'agent-tok',
    });

    expect(createModelConfigMock).toHaveBeenCalledTimes(1);
    expect(createModelConfigMock).toHaveBeenCalledWith(modelOptions);
    expect(createModelConfigFromEnvMock).not.toHaveBeenCalled();
    await gateway.stop();
  });

  it('falls back to env config when neither command model nor modelOptions is set', async () => {
    const { gateway, clients } = createGateway();

    await startAndSpawn(gateway, clients, {
      type: 'agent.spawn',
      participantId: 'lobe',
      token: 'agent-tok',
    });

    expect(createModelConfigFromEnvMock).toHaveBeenCalledTimes(1);
    expect(createModelConfigMock).not.toHaveBeenCalled();
    await gateway.stop();
  });

  it('ignores per-command model when agentFactory is injected', async () => {
    const fakeAgent = {
      initialize: vi.fn(async () => {}),
      start: vi.fn(async () => {}),
      onMessage: vi.fn(() => () => undefined),
      onStatusChange: vi.fn(() => () => undefined),
      destroy: vi.fn(async () => {}),
    } as unknown as IAgent;
    const { gateway, clients } = createGateway({ agentFactory: () => fakeAgent });

    await startAndSpawn(gateway, clients, {
      type: 'agent.spawn',
      participantId: 'lobe',
      token: 'agent-tok',
      model: { provider: 'deepseek', modelId: 'deepseek-chat' },
    });

    expect(createModelConfigMock).not.toHaveBeenCalled();
    expect(createModelConfigFromEnvMock).not.toHaveBeenCalled();
    await gateway.stop();
  });
});
