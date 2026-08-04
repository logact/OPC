import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import type { AgentMessage, IAgent, ThreadInfo, ThreadOptions } from '@opc/agent-edge';
import { AgentGateway } from '@opc/agent-gateway';
import type { OpcClient } from '@logact-pub/opc-sdk';
import {
  connectSdkClient,
  createAuthenticatedHttpClient,
  registerParticipant,
  startTestServer,
  TEST_BASE_URL,
  TEST_MQTT,
} from './helpers.js';

/**
 * issue #84 离线 agent 消息补投 E2E：
 * - 场景 B：gateway 进程重启（新实例、同一 state.db）→ server 重发 spawn →
 *   按 SQLite 水位从 HTTP 历史补投离线期间的消息，且在线已处理的消息不重复回放。
 * - 场景 A：gateway 进程活着但 MQTT 断线 → broker 持久会话排队 → 重连后补收。
 */

/** 记录 startThread 次数与 goal 的确定性 fake agent（不调用 LLM） */
/* eslint-disable @typescript-eslint/require-await */
class RecordingAgent extends EventEmitter implements IAgent {
  readonly agentId: string;
  readonly startedGoals: string[] = [];
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
    this.lastGoal = options.goal;
    return `${this.agentId}-thread-${this.startedGoals.length + 1}`;
  }
  async getThread(): Promise<ThreadInfo> {
    return { threadId: 't', status: 'running', goal: this.lastGoal };
  }
  async getThreads() {
    return [];
  }
  async startThread(threadId: string): Promise<void> {
    this.startedGoals.push(this.lastGoal);
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

const POLL_TIMEOUT_MS = 15000;
const POLL_INTERVAL_MS = 200;

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

describe('Offline agent catch-up E2E (issue #84)', () => {
  it('replays missed messages after gateway process restart, without duplicating processed ones', async () => {
    const { cleanup } = await startTestServer();
    const suffix = Date.now();
    const gatewayId = `gw-offline-${suffix}`;
    const agentId = `agent-offline-${suffix}`;
    const humanId = `human-offline-${suffix}`;
    const stateDir = mkdtempSync(join(tmpdir(), 'opc-gw-state-'));
    const stateDbPath = join(stateDir, 'state.db');

    let gateway: AgentGateway | undefined;
    let humanClient: OpcClient | undefined;
    const spawnedAgents: RecordingAgent[] = [];

    const startGateway = async (token: string): Promise<AgentGateway> => {
      const gw = new AgentGateway({
        gatewayId,
        serverUrl: TEST_BASE_URL,
        brokerUrl: TEST_MQTT.brokerUrl,
        token,
        stateDbPath,
        agentFactory: (participantId) => {
          const agent = new RecordingAgent(participantId);
          spawnedAgents.push(agent);
          return agent;
        },
      });
      await gw.start();
      return gw;
    };

    try {
      const authHttp = await createAuthenticatedHttpClient();
      const { token: gatewayToken } = await authHttp.registerParticipant(
        gatewayId,
        undefined,
        undefined,
        'gateway'
      );

      gateway = await startGateway(gatewayToken);
      await authHttp.registerParticipant(agentId, undefined, undefined, 'agent', gatewayId);
      const humanToken = await registerParticipant(humanId);

      const { roomId } = await authHttp.createRoom({
        name: 'offline-catchup-room',
        participantIds: [humanId, agentId],
      });

      humanClient = await connectSdkClient(humanId, humanToken);
      await humanClient.subscribeRoom(roomId);

      // 等待首次 spawn 完成
      await waitFor(() => Promise.resolve(spawnedAgents.length === 1));

      // 在线消息：正常处理并推进水位
      await humanClient.sendText(roomId, 'online message');
      await waitFor(() =>
        Promise.resolve(spawnedAgents[0].startedGoals.some((g) => g.includes('online message')))
      );

      // gateway 进程停止（模拟进程退出）；离线期间发两条消息
      await gateway.stop();
      gateway = undefined;
      await humanClient.sendText(roomId, 'offline message 1');
      await humanClient.sendText(roomId, 'offline message 2');

      // 进程重启：新实例、同一 state.db；server 看到 gateway online 后重发 spawn
      gateway = await startGateway(gatewayToken);

      // agent 被重新 spawn 并补投离线期间的两条消息
      await waitFor(() => Promise.resolve(spawnedAgents.length === 2));
      const respawned = spawnedAgents[1];
      await waitFor(() =>
        Promise.resolve(
          respawned.startedGoals.some((g) => g.includes('offline message 1')) &&
            respawned.startedGoals.some((g) => g.includes('offline message 2'))
        )
      );

      // 幂等：在线已处理的 'online message' 不得被回放
      expect(respawned.startedGoals.filter((g) => g.includes('online message'))).toHaveLength(0);
      // 每条离线消息恰好补投一次（broker 队列与 HTTP 历史重叠时不重复）
      expect(
        respawned.startedGoals.filter((g) => g.includes('offline message 1'))
      ).toHaveLength(1);
      expect(
        respawned.startedGoals.filter((g) => g.includes('offline message 2'))
      ).toHaveLength(1);
    } finally {
      if (humanClient) await humanClient.disconnect();
      if (gateway) await gateway.stop();
      rmSync(stateDir, { recursive: true, force: true });
      await cleanup();
    }
  }, 30000);

  it('receives queued messages after a transient MQTT disconnect (broker persistent session)', async () => {
    const { cleanup } = await startTestServer();
    const suffix = Date.now();
    const gatewayId = `gw-blink-${suffix}`;
    const agentId = `agent-blink-${suffix}`;
    const humanId = `human-blink-${suffix}`;

    let gateway: AgentGateway | undefined;
    let humanClient: OpcClient | undefined;
    const spawnedAgents: RecordingAgent[] = [];

    try {
      const authHttp = await createAuthenticatedHttpClient();
      const { token: gatewayToken } = await authHttp.registerParticipant(
        gatewayId,
        undefined,
        undefined,
        'gateway'
      );

      gateway = new AgentGateway({
        gatewayId,
        serverUrl: TEST_BASE_URL,
        brokerUrl: TEST_MQTT.brokerUrl,
        token: gatewayToken,
        stateDbPath: ':memory:',
        agentFactory: (participantId) => {
          const agent = new RecordingAgent(participantId);
          spawnedAgents.push(agent);
          return agent;
        },
      });
      await gateway.start();

      await authHttp.registerParticipant(agentId, undefined, undefined, 'agent', gatewayId);
      const humanToken = await registerParticipant(humanId);

      const { roomId } = await authHttp.createRoom({
        name: 'blink-room',
        participantIds: [humanId, agentId],
      });

      humanClient = await connectSdkClient(humanId, humanToken);
      await humanClient.subscribeRoom(roomId);
      await waitFor(() => Promise.resolve(spawnedAgents.length === 1));
      const agent = spawnedAgents[0];

      // 在线处理一条，确认链路正常
      await humanClient.sendText(roomId, 'before blink');
      await waitFor(() =>
        Promise.resolve(agent.startedGoals.some((g) => g.includes('before blink')))
      );

      // 模拟短暂断线：销毁底层 socket（不发 DISCONNECT），mqtt.js 自动重连；
      // 断线窗口内发的消息由 broker 持久会话排队
      const mqttClient = (
        gateway as unknown as { mqtt: { stream: { destroy(): void } } }
      ).mqtt;
      mqttClient.stream.destroy();
      await sleep(500); // 确保 broker 已感知断连
      await humanClient.sendText(roomId, 'during blink');

      // 重连后：broker 补投排队消息（HTTP 水位兜底路径也不应造成重复）
      await waitFor(
        () => Promise.resolve(agent.startedGoals.some((g) => g.includes('during blink'))),
        POLL_TIMEOUT_MS + 5000 // reconnectPeriod 为 5s
      );
      await sleep(1000); // 给潜在重复投递一个暴露窗口
      expect(agent.startedGoals.filter((g) => g.includes('during blink'))).toHaveLength(1);
    } finally {
      if (humanClient) await humanClient.disconnect();
      if (gateway) await gateway.stop();
      await cleanup();
    }
  }, 40000);
});
