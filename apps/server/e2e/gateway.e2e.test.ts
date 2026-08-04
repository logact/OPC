import { EventEmitter } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import mqtt, { type MqttClient } from 'mqtt';
import type { AgentMessage, IAgent, ThreadInfo, ThreadOptions } from '@opc/agent-edge';
import { AgentGateway, type AgentGatewayOptions } from '@opc/agent-gateway';
import { API_ROUTES, MQTT_ACL, MQTT_TOPICS } from '@logact-pub/opc-protocol';
import { OpcClient } from '@logact-pub/opc-sdk';
import {
  connectSdkClient,
  createAuthenticatedHttpClient,
  createHttpClient,
  getOwnerAccessToken,
  grantCapabilities,
  registerParticipant,
  SELF_MESSAGING_GRANTS,
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
    agentFactory: (participantId) => {
      const agent = new EchoAgent(participantId);
      onSpawn?.({ participantId, agent });
      return agent;
    },
  } satisfies AgentGatewayOptions);

  await gateway.start();
  return gateway;
}

const POLL_TIMEOUT_MS = 10000;
const POLL_INTERVAL_MS = 200;

/** 轮询直到条件满足（go-auth 回调与 retained 回放都有额外延迟） */
async function waitFor(
  condition: () => Promise<boolean>,
  timeoutMs = POLL_TIMEOUT_MS
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await condition()) return;
    if (Date.now() > deadline) throw new Error('waitFor: condition not met before timeout');
    await sleep(POLL_INTERVAL_MS);
  }
}

/**
 * 等待 gateway 上报 agent 的 online presence。
 * spawn 流程中订阅 agent events topic 的 SUBSCRIBE 包先于 presence 的 PUBLISH
 * 包发出（同一连接保序），因此 online 即意味着 fan-out 订阅已生效。
 */
async function waitForAgentOnline(agentId: string, accessToken: string): Promise<void> {
  const http = createHttpClient();
  http.setAccessToken(accessToken);
  await waitFor(async () => {
    const { participant } = await http.getParticipant(agentId);
    return participant.presence?.online === true;
  });
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
      const http = await createAuthenticatedHttpClient();
      // 必须注册为 gateway kind：#116 起代理 uplink 的 ACL 要求连接身份为
      // gateway（server.ts checkAcl），否则 agent 回复的 uplink 会被 403 拒发
      const { token: gatewayToken } = await http.registerParticipant(
        gatewayId,
        undefined,
        undefined,
        'gateway'
      );

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
      // #112 enforced RBAC：human 订阅/发言需 message.read/message.send，
      // gateway 代 agent 发 uplink 时按 agent 的 message.send 能力判定
      await grantCapabilities(humanId, SELF_MESSAGING_GRANTS);
      await grantCapabilities(agentId, [
        { capability: 'message.send', scope: { type: 'self' } },
      ]);

      const authHttp = await createAuthenticatedHttpClient();
      const { roomId } = await authHttp.createRoom({
        name: 'gateway-e2e-room',
        participantIds: [humanId, agentId],
      });

      humanClient = await connectSdkClient(humanId, humanToken);
      await humanClient.subscribeRoom(roomId);

      // 等待 gateway 完成 spawn：订阅了 agent events topic 并上报 online presence
      // presence 读取走 Owner：#112 下 agent 无 participant.read 能力
      await waitForAgentOnline(agentId, getOwnerAccessToken());
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
      const http = await createAuthenticatedHttpClient();
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

  it('enforces agent events / proxied uplink / delegated presence ACL', async () => {
    const { baseUrl, cleanup } = await startTestServer();

    try {
      const http = await createAuthenticatedHttpClient();
      const suffix = Date.now();
      const gatewayId = `gw-acl2-${suffix}`;
      const otherGatewayId = `gw-acl2-other-${suffix}`;
      const agentId = `agent-acl2-${suffix}`;

      await http.registerParticipant(gatewayId, undefined, undefined, 'gateway');
      await http.registerParticipant(otherGatewayId, undefined, undefined, 'gateway');
      await http.registerParticipant(agentId, undefined, undefined, 'agent', gatewayId);
      // #112：gateway 代发 uplink 的 ACL 按 agent 的 message.send 能力判定
      //（与 HTTP broadcast 同一决策），self scope 覆盖 agent 所在的房间
      await grantCapabilities(agentId, [
        { capability: 'message.send', scope: { type: 'self' } },
      ]);

      const { roomId: roomWithAgent } = await http.createRoom({
        name: 'acl2-with-agent',
        participantIds: [agentId],
      });
      const { roomId: roomWithoutAgent } = await http.createRoom({
        name: 'acl2-without-agent',
        participantIds: [],
      });

      const check = async (username: string, topic: string, acc: number) => {
        const res = await fetch(`${baseUrl}${API_ROUTES.auth.mqttAcl}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, topic, acc }),
        });
        return res.status;
      };

      // agent events topic：仅所属 gateway 可订阅
      const agentTopic = MQTT_TOPICS.agentEvents(agentId);
      expect(await check(gatewayId, agentTopic, MQTT_ACL.SUBSCRIBE)).toBe(200);
      expect(await check(otherGatewayId, agentTopic, MQTT_ACL.SUBSCRIBE)).toBe(403);
      expect(await check(agentId, agentTopic, MQTT_ACL.SUBSCRIBE)).toBe(403);
      expect(await check(gatewayId, agentTopic, MQTT_ACL.WRITE)).toBe(403);

      // uplink 代发：gateway 可向其名下 agent 所在房间写 uplink，其他房间不行
      expect(
        await check(
          gatewayId,
          MQTT_TOPICS.participantUplink(agentId, roomWithAgent),
          MQTT_ACL.WRITE
        )
      ).toBe(200);
      expect(
        await check(
          gatewayId,
          MQTT_TOPICS.participantUplink(agentId, roomWithoutAgent),
          MQTT_ACL.WRITE
        )
      ).toBe(403);
      // 代发放行不扩展到 events 订阅
      expect(await check(gatewayId, MQTT_TOPICS.events(roomWithAgent), MQTT_ACL.SUBSCRIBE)).toBe(403);

      // presence 代写：gateway 可写名下 agent 的 presence，不能写其他人的
      expect(await check(gatewayId, MQTT_TOPICS.presence(agentId), MQTT_ACL.WRITE)).toBe(200);
      expect(await check(otherGatewayId, MQTT_TOPICS.presence(agentId), MQTT_ACL.WRITE)).toBe(403);
    } finally {
      await cleanup();
    }
  });

  it('cascades agents offline when their gateway drops abruptly', async () => {
    const { cleanup } = await startTestServer();
    let client: MqttClient | undefined;

    try {
      const authHttp = await createAuthenticatedHttpClient();
      const suffix = Date.now();
      const gatewayId = `gw-cascade-${suffix}`;
      const agentId = `agent-cascade-${suffix}`;

      const { token: gatewayToken } = await authHttp.registerParticipant(
        gatewayId,
        undefined,
        undefined,
        'gateway'
      );
      await authHttp.registerParticipant(agentId, undefined, undefined, 'agent', gatewayId);

      // 以 gateway 身份建立带 LWT 的连接，并代 agent 上报 online presence
      client = mqtt.connect(TEST_MQTT.brokerUrl, {
        username: gatewayId,
        password: gatewayToken,
        reconnectPeriod: 0,
        will: {
          topic: MQTT_TOPICS.presence(gatewayId),
          payload: JSON.stringify({ online: false }),
          qos: 1,
          retain: true,
        },
      });
      await new Promise<void>((resolve, reject) => {
        client!.once('connect', () => resolve());
        client!.once('error', reject);
      });
      client.publish(MQTT_TOPICS.presence(agentId), JSON.stringify({ online: true }), {
        qos: 1,
        retain: true,
      });

      // presence 读取走 Owner：#112 下 gateway 无 participant.read 能力
      await waitFor(async () => {
        const { participant } = await authHttp.getParticipant(agentId);
        return participant.presence?.online === true;
      });

      // 模拟 gateway 异常断线：销毁底层 socket（不发 DISCONNECT），broker 发布 LWT
      client.stream.destroy();
      client = undefined;

      // gateway 与其名下 agent 都应被置为 offline（agent 由 server 级联）
      await waitFor(async () => {
        const { participant: gw } = await authHttp.getParticipant(gatewayId);
        const { participant: agent } = await authHttp.getParticipant(agentId);
        return gw.presence?.online === false && agent.presence?.online === false;
      });
    } finally {
      if (client) {
        await new Promise<void>((resolve) => client!.end(true, {}, () => resolve()));
      }
      await cleanup();
    }
  });

  it('persists agent busy/idle status from delegated presence (issue #83)', async () => {
    const { cleanup } = await startTestServer();
    let client: MqttClient | undefined;

    try {
      const authHttp = await createAuthenticatedHttpClient();
      const suffix = Date.now();
      const gatewayId = `gw-status-${suffix}`;
      const agentId = `agent-status-${suffix}`;

      const { token: gatewayToken } = await authHttp.registerParticipant(
        gatewayId,
        undefined,
        undefined,
        'gateway'
      );
      await authHttp.registerParticipant(agentId, undefined, undefined, 'agent', gatewayId);

      client = mqtt.connect(TEST_MQTT.brokerUrl, {
        username: gatewayId,
        password: gatewayToken,
        reconnectPeriod: 0,
      });
      await new Promise<void>((resolve, reject) => {
        client!.once('connect', () => resolve());
        client!.once('error', reject);
      });

      // gateway 代发带忙闲状态的 presence
      client.publish(
        MQTT_TOPICS.presence(agentId),
        JSON.stringify({ online: true, status: 'working' }),
        { qos: 1, retain: true }
      );

      // presence 读取走 Owner：#112 下 gateway 无 participant.read 能力
      await waitFor(async () => {
        const { participant } = await authHttp.getParticipant(agentId);
        return participant.presence?.online === true && participant.presence?.status === 'working';
      });

      // 状态流转：working → idle
      client.publish(
        MQTT_TOPICS.presence(agentId),
        JSON.stringify({ online: true, status: 'idle' }),
        { qos: 1, retain: true }
      );
      await waitFor(async () => {
        const { participant } = await authHttp.getParticipant(agentId);
        return participant.presence?.status === 'idle';
      });

      // offline 后 status 清空（offline 由连接层表达，不再附带应用层状态）
      client.publish(MQTT_TOPICS.presence(agentId), JSON.stringify({ online: false }), {
        qos: 1,
        retain: true,
      });
      await waitFor(async () => {
        const { participant } = await authHttp.getParticipant(agentId);
        return participant.presence?.online === false && participant.presence?.status === undefined;
      });
    } finally {
      if (client) {
        await new Promise<void>((resolve) => client!.end(true, {}, () => resolve()));
      }
      await cleanup();
    }
  });
});
