import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import type { AgentMessage, IAgent, ThreadInfo, ThreadOptions } from '@opc/agent-edge';
import { AgentGateway, type AgentGatewayOptions } from '@opc/agent-gateway';
import { API_ROUTES, MQTT_ACL, MQTT_TOPICS } from '@logact-pub/opc-protocol';
import { OpcClient } from '@logact-pub/opc-sdk';
import {
  connectSdkClient,
  createAuthenticatedHttpClient,
  createHttpClient,
  registerParticipant,
  startTestServer,
  TEST_BASE_URL,
  TEST_MQTT,
} from './helpers.js';

/**
 * 确定性 fake agent：不调用 LLM，收到消息后立即按 goal 生成固定回复。
 * 覆盖 gateway 到 IM server 的完整集成路径，同时避免 E2E 依赖外部模型。
 */
/* eslint-disable @typescript-eslint/require-await */
class EchoAgent extends EventEmitter implements IAgent {
  readonly agentId: string;
  private threadSeq = 0;
  private lastGoal = '';
  private messageHandler?: (message: AgentMessage) => void;

  constructor(agentId: string) {
    super();
    this.agentId = agentId;
  }

  async initialize(): Promise<void> {}
  async start(): Promise<void> {}
  async pause(): Promise<void> {}
  async resume(): Promise<void> {}
  async terminate(): Promise<void> {}
  async destroy(): Promise<void> {}
  async getInfo() {
    return { agentId: this.agentId, status: 'running' as const, threadIds: [] };
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
    const threadId = `${this.agentId}-thread-${++this.threadSeq}`;
    this.lastGoal = options.goal;
    return threadId;
  }
  async getThread(): Promise<ThreadInfo> {
    return { threadId: 't', status: 'running', goal: this.lastGoal };
  }
  async getThreads() {
    return [];
  }
  async startThread(threadId: string): Promise<void> {
    // 模拟模型生成完成：立即向 gateway 发送回复
    this.messageHandler?.({
      id: `reply-${threadId}`,
      timestamp: Date.now(),
      from: this.agentId,
      threadId,
      content: { type: 'text', body: `Echo: ${this.lastGoal}` },
    });
  }
  async pauseThread(): Promise<void> {}
  async completeThread(): Promise<void> {}
  async resumeThread(): Promise<void> {}
  async terminateThread(): Promise<void> {}
  async destroyThread(): Promise<void> {}
  async getMessages(): Promise<AgentMessage[]> {
    return [];
  }
}
/* eslint-enable @typescript-eslint/require-await */

interface SpawnedAgent {
  participantId: string;
  agent: EchoAgent;
}

async function startTestGateway(
  gatewayId: string,
  token: string,
  onSpawn?: (spawned: SpawnedAgent) => void
): Promise<AgentGateway> {
  const gateway = new AgentGateway({
    gatewayId,
    serverUrl: TEST_BASE_URL,
    brokerUrl: TEST_MQTT.brokerUrl,
    token,
    roomSyncIntervalMs: 500,
    agentFactory: (participantId) => {
      const agent = new EchoAgent(participantId);
      onSpawn?.({ participantId, agent });
      return agent;
    },
  } satisfies AgentGatewayOptions);

  await gateway.start();
  return gateway;
}

async function waitForAgentRoom(
  gateway: AgentGateway,
  participantId: string,
  roomId: string,
  timeoutMs = 5000
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (gateway.isAgentSubscribedToRoom(participantId, roomId)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`agent ${participantId} did not subscribe to room ${roomId} within ${timeoutMs}ms`);
}

/** 等待来自指定发送者的 message.delivered 事件（跳过发送者自己的回显） */
function waitForMessageFrom(client: OpcClient, from: string): Promise<{ body: string }> {
  return new Promise((resolve) => {
    const handler = (event: { message: { from: string; content: { body: string } } }) => {
      if (event.message.from === from) {
        client.events.off('message.delivered', handler);
        resolve({ body: event.message.content.body });
      }
    };
    client.events.on('message.delivered', handler);
  });
}

describe('Agent Gateway E2E', () => {
  it('spawns an agent via control topic and replies to room messages', async () => {
    const { cleanup } = await startTestServer();
    const gatewayId = `gw-e2e-${Date.now()}`;
    let gateway: AgentGateway | undefined;
    let humanClient: OpcClient | undefined;

    try {
      const http = createHttpClient();
      const { token: gatewayToken } = await http.registerParticipant(gatewayId);

      let spawnedResolve: (value: SpawnedAgent) => void = () => {};
      const spawnedPromise = new Promise<SpawnedAgent>((resolve) => {
        spawnedResolve = resolve;
      });

      gateway = await startTestGateway(gatewayId, gatewayToken, (spawned) => spawnedResolve(spawned));

      const agentId = `agent-e2e-${Date.now()}`;
      const { token: agentToken } = await http.registerParticipant(
        agentId,
        undefined,
        undefined,
        'agent',
        gatewayId
      );
      expect(agentToken).toMatch(/^[0-9a-f]{64}$/);

      // 等待 gateway 收到 agent.spawn 并创建 agent runtime
      const spawned = await spawnedPromise;
      expect(spawned.participantId).toBe(agentId);

      const humanId = `human-e2e-${Date.now()}`;
      const humanToken = await registerParticipant(humanId);

      const authHttp = await createAuthenticatedHttpClient();
      const { roomId } = await authHttp.createRoom({
        name: 'gateway-e2e-room',
        participantIds: [humanId, agentId],
      });

      humanClient = await connectSdkClient(humanId, humanToken);
      await humanClient.subscribeRoom(roomId);

      // 等待 gateway 周期同步后订阅房间事件
      await waitForAgentRoom(gateway, agentId, roomId);
      const agentReply = waitForMessageFrom(humanClient, agentId);

      await humanClient.sendText(roomId, 'hello agent');

      const delivered = await agentReply;
      expect(delivered.body).toBe(`Echo: Message from ${humanId}: hello agent`);
    } finally {
      if (humanClient) await humanClient.disconnect();
      if (gateway) await gateway.stop();
      await cleanup();
    }
  });

  it('enforces gateway control topic ACL at server endpoint', async () => {
    const { baseUrl, cleanup } = await startTestServer();

    try {
      const http = createHttpClient();
      await http.registerParticipant('gw-acl-owner');
      await http.registerParticipant('gw-acl-other');

      const ownTopic = MQTT_TOPICS.gatewayControl('gw-acl-owner');
      const otherTopic = MQTT_TOPICS.gatewayControl('gw-acl-other');

      const check = async (username: string, topic: string, acc: number) => {
        const res = await fetch(`${baseUrl}${API_ROUTES.auth.mqttAcl}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, topic, acc }),
        });
        return res.status;
      };

      // gateway 只能 SUBSCRIBE/READ 自己的控制 topic
      expect(await check('gw-acl-owner', ownTopic, MQTT_ACL.SUBSCRIBE)).toBe(200);
      expect(await check('gw-acl-owner', ownTopic, MQTT_ACL.READ)).toBe(200);
      expect(await check('gw-acl-owner', ownTopic, MQTT_ACL.WRITE)).toBe(403);

      // gateway 不能订阅其他 gateway 的控制 topic
      expect(await check('gw-acl-owner', otherTopic, MQTT_ACL.SUBSCRIBE)).toBe(403);
      expect(await check('gw-acl-owner', otherTopic, MQTT_ACL.READ)).toBe(403);

      // 普通 participant 不能订阅任何 gateway 控制 topic
      expect(await check('some-user', ownTopic, MQTT_ACL.SUBSCRIBE)).toBe(403);
    } finally {
      await cleanup();
    }
  });
});
