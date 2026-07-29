import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import mqtt, { type MqttClient } from 'mqtt';
import type { IAgent } from '@opc/agent-edge';
import {
  AgentRuntime,
  createModelConfig,
  createModelConfigFromEnv,
  type EdgeModelOptions,
} from '@opc/agent-edge';
import {
  API_ROUTES,
  GatewayCommandSchema,
  MQTT_TOPICS,
  ServerEventSchema,
  parseAgentEventsTopic,
  parseGatewayControlTopic,
  type AgentModelConfig,
  type GatewayCommand,
  type GatewaySpawnCommand,
  type MessageDeliveredEvent,
} from '@logact-pub/opc-protocol';
import {
  startAdminServer,
  stopAdminServer,
  type AdminAgentEntry,
  type AdminDataSource,
  type AdminThreadEntry,
} from './admin.js';
import { buildModelCatalog } from './model-catalog.js';

export interface AgentGatewayOptions {
  /** 本 gateway 在 OPC 中的唯一标识，需作为 participant 注册过。 */
  gatewayId: string;
  /** OPC HTTP 管理面地址。 */
  serverUrl: string;
  /** MQTT broker 地址。 */
  brokerUrl: string;
  /** gateway 自身的 MQTT token（与 HTTP Bearer 同一凭证）。 */
  token: string;
  /** 显式指定模型；缺省读取 EDGE_MODEL_* 环境变量。 */
  modelOptions?: EdgeModelOptions;
  /** 测试注入用 MQTT connect 函数。 */
  connectFn?: typeof mqtt.connect;
  /**
   * 自定义 agent 工厂，用于测试或替换 runtime 实现。
   * 未提供时使用内置 AgentRuntime。
   */
  agentFactory?: (participantId: string) => IAgent | Promise<IAgent>;
  /**
   * 本机 loopback admin server（供 `opc-gateway` CLI 查询/管理）。
   * 不提供则不启动；应只绑定 127.0.0.1（无鉴权）。
   */
  admin?: { host?: string; port?: number };
}

interface ManagedAgent {
  participantId: string;
  agent: IAgent;
}

/**
 * AgentGateway 是边缘机器上的网络编排层，单条 MQTT 连接多路复用本机所有 agent：
 * - 自身以 gateway participant 身份连 MQTT，订阅控制 topic；
 * - 收到 agent.spawn 后在进程内创建 AgentRuntime，并在同一连接上订阅
 *   opc/agents/{agentId}/events；server 会把房间事件 fan-out 到这些 topic；
 * - 入站按 topic 中的 agentId 路由到对应 runtime，映射为 thread goal；
 * - 出站通过 agent.onMessage 回调由 gateway 统一代发到房间 uplink；
 * - agent 的 presence 由 gateway 按 runtime 真实状态上报（agent 不再有
 *   独立 MQTT 连接）；gateway 异常断线时由 server 级联置 offline。
 */
export class AgentGateway {
  private readonly options: AgentGatewayOptions;
  private readonly connect: typeof mqtt.connect;
  private mqtt?: MqttClient;
  private readonly agents = new Map<string, ManagedAgent>();
  private readonly threadRoomMap = new Map<string, string>();
  private adminServer?: Server;
  private startedAtMs?: number;
  private stopped = false;
  private inboundQueue: Promise<void> = Promise.resolve();

  constructor(options: AgentGatewayOptions) {
    this.options = options;
    this.connect = options.connectFn ?? mqtt.connect;
  }

  async start(): Promise<void> {
    if (this.stopped) {
      throw new Error('gateway already stopped');
    }

    const { gatewayId, brokerUrl, token } = this.options;
    const client = this.connect(brokerUrl, {
      username: gatewayId,
      password: token,
      clientId: `opc-gateway-${gatewayId}-${randomUUID()}`,
      reconnectPeriod: 5000,
      // presence：异常断线由 broker 发布 LWT（retained offline）
      will: {
        topic: MQTT_TOPICS.presence(gatewayId),
        payload: JSON.stringify({ online: false }),
        qos: 1,
        retain: true,
      },
    });
    this.mqtt = client;

    // 每次（重）连成功发布 retained online，并重发所有 agent 的 online presence
    // （broker 可能在我们离线期间收到过 server 级联写入的 offline retained）
    client.on('connect', () => {
      client.publish(MQTT_TOPICS.presence(gatewayId), JSON.stringify({ online: true }), {
        qos: 1,
        retain: true,
      });
      for (const participantId of this.agents.keys()) {
        this.publishAgentPresence(participantId, true);
      }
    });

    await new Promise<void>((resolve, reject) => {
      const onConnect = () => {
        cleanup();
        resolve();
      };
      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };
      const cleanup = () => {
        client.off('connect', onConnect);
        client.off('error', onError);
      };
      client.once('connect', onConnect);
      client.once('error', onError);
    });

    client.subscribe(MQTT_TOPICS.gatewayControl(gatewayId), { qos: 1 }, (err) => {
      if (err) {
        console.error(`[gateway ${gatewayId}] failed to subscribe control topic:`, err.message);
      } else {
        console.log(`[gateway ${gatewayId}] subscribed control topic`);
      }
    });

    // 入站消息串行处理：MQTT 保证同一连接上的顺序，但 handler 是 async 的——
    // 若并发执行，agent.stop / 房间事件可能先于尚未完成的 agent.spawn 被处理
    client.on('message', (topic, payload) => {
      this.inboundQueue = this.inboundQueue
        .then(() => this.handleMqttMessage(topic, payload))
        .catch((err: unknown) => {
          console.error(`[gateway ${gatewayId}] failed to handle message on ${topic}:`, err);
        });
    });
    client.on('error', (err) => {
      console.error(`[gateway ${gatewayId}] mqtt error:`, err.message);
    });

    this.startedAtMs = Date.now();
    await this.startAdmin();

    // 上报本机模型目录供 server/mobile 查询；失败只告警，绝不阻塞启动
    void this.reportModelCatalog();
  }

  /** 将 pi-ai 内建模型目录 PATCH 到 server（持久化在本 gateway 的 metadata.modelCatalog） */
  private async reportModelCatalog(): Promise<void> {
    const { gatewayId, serverUrl, token } = this.options;
    try {
      const modelCatalog = buildModelCatalog();
      const res = await fetch(`${serverUrl}${API_ROUTES.participant(gatewayId)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ modelCatalog }),
      });
      if (!res.ok) {
        console.warn(`[gateway ${gatewayId}] model catalog report failed: HTTP ${res.status}`);
      }
    } catch (err) {
      console.warn(
        `[gateway ${gatewayId}] model catalog report failed:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  private async startAdmin(): Promise<void> {
    const admin = this.options.admin;
    if (!admin) return;

    const host = admin.host ?? '127.0.0.1';
    const port = admin.port ?? 4646;
    try {
      this.adminServer = await startAdminServer(this.buildAdminDataSource(), { host, port });
      console.log(`[gateway ${this.options.gatewayId}] admin server listening on http://${host}:${port}`);
    } catch (err) {
      // admin 面失败不影响数据面
      console.warn(
        `[gateway ${this.options.gatewayId}] admin server failed on ${host}:${port}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  private buildAdminDataSource(): AdminDataSource {
    const toEntry = async (managed: ManagedAgent): Promise<AdminAgentEntry> => ({
      participantId: managed.participantId,
      info: await managed.agent.getInfo(),
    });

    return {
      getStatus: () => ({
        gatewayId: this.options.gatewayId,
        serverUrl: this.options.serverUrl,
        brokerUrl: this.options.brokerUrl,
        startedAt: new Date(this.startedAtMs ?? Date.now()).toISOString(),
        uptimeSec: this.startedAtMs ? Math.floor((Date.now() - this.startedAtMs) / 1000) : 0,
        mqttConnected: this.mqtt?.connected ?? false,
        agentCount: this.agents.size,
        agentIds: [...this.agents.keys()],
      }),
      listAgents: async () => Promise.all([...this.agents.values()].map(toEntry)),
      getAgent: async (participantId) => {
        const managed = this.agents.get(participantId);
        return managed ? toEntry(managed) : undefined;
      },
      stopAgent: async (participantId) => {
        if (!this.agents.has(participantId)) return false;
        await this.stopAgent(participantId);
        return true;
      },
      listThreads: async (participantId): Promise<AdminThreadEntry[] | undefined> => {
        const managed = this.agents.get(participantId);
        if (!managed) return undefined;
        const threads = await managed.agent.getThreads();
        return threads.map((thread) => {
          const roomId = this.threadRoomMap.get(thread.threadId);
          return roomId ? { ...thread, roomId } : thread;
        });
      },
      getThreadMessages: async (participantId, threadId) => {
        const managed = this.agents.get(participantId);
        if (!managed) return undefined;
        return managed.agent.getMessages(threadId);
      },
    };
  }

  /** 测试/诊断用：admin server 的实际监听地址（未启动时为 undefined）。 */
  adminAddress(): { host: string; port: number } | undefined {
    const address = this.adminServer?.address();
    if (!address || typeof address === 'string') return undefined;
    const { address: host, port } = address;
    return { host, port };
  }

  /** 入站分流：控制命令 vs 各 agent 的 events topic（按 agentId 路由）。 */
  private async handleMqttMessage(topic: string, raw: Buffer): Promise<void> {
    if (parseGatewayControlTopic(topic)) {
      await this.handleCommand(raw);
      return;
    }
    const agentId = parseAgentEventsTopic(topic);
    if (agentId) {
      await this.handleAgentEvent(agentId, raw);
    }
  }

  private async handleCommand(raw: Buffer) {
    let command: GatewayCommand;
    try {
      command = GatewayCommandSchema.parse(JSON.parse(raw.toString('utf8')));
    } catch {
      console.warn(`[gateway ${this.options.gatewayId}] malformed gateway command, dropped`);
      return;
    }

    if (command.type === 'agent.spawn') {
      await this.spawnAgent(command);
    } else if (command.type === 'agent.stop') {
      await this.stopAgent(command.participantId);
    }
  }

  private async handleAgentEvent(agentId: string, raw: Buffer): Promise<void> {
    const managed = this.agents.get(agentId);
    if (!managed) {
      console.warn(`[gateway ${this.options.gatewayId}] event for unknown agent ${agentId}, dropped`);
      return;
    }

    let body: unknown;
    try {
      body = JSON.parse(raw.toString('utf8'));
    } catch {
      console.warn(`[gateway ${this.options.gatewayId}] malformed event for agent ${agentId}, dropped`);
      return;
    }

    const parsed = ServerEventSchema.safeParse(body);
    if (!parsed.success) {
      console.warn(`[gateway ${this.options.gatewayId}] invalid event for agent ${agentId}, dropped`);
      return;
    }

    if (parsed.data.type === 'message.delivered') {
      await this.handleRoomEvent(managed, parsed.data);
    }
  }

  private async spawnAgent(command: GatewaySpawnCommand): Promise<void> {
    const { participantId } = command;
    if (this.agents.has(participantId)) {
      console.warn(`[gateway ${this.options.gatewayId}] agent ${participantId} already spawned`);
      return;
    }

    const agent = this.options.agentFactory
      ? await this.options.agentFactory(participantId)
      : this.createDefaultAgent(participantId, command.model);

    try {
      await agent.initialize({});
      await agent.start();
    } catch (err) {
      // runtime 初始化失败（如模型配置无效）：显式标 offline，绝不上报 online
      console.error(`[gateway ${this.options.gatewayId}] agent ${participantId} failed to start:`, err);
      await agent.destroy().catch(() => undefined);
      this.publishAgentPresence(participantId, false);
      return;
    }

    const managed: ManagedAgent = { participantId, agent };
    this.agents.set(participantId, managed);

    // 出站：agent runtime 的发送接口——回复经 gateway 唯一连接代发到房间 uplink
    agent.onMessage((message) => {
      const roomId = this.threadRoomMap.get(message.threadId);
      if (!roomId) {
        console.warn(`[gateway ${this.options.gatewayId}] no room mapping for thread ${message.threadId}`);
        return;
      }
      this.mqtt?.publish(
        MQTT_TOPICS.uplink(roomId),
        JSON.stringify({ from: participantId, content: message.content, clientMessageId: message.id }),
        { qos: 1 }
      );
    });

    // runtime 健康 → presence：thread 进入 error（典型如模型 token 无效）即标 offline
    agent.onStatusChange((event) => {
      if (event.threadId && event.status === 'error') {
        console.warn(
          `[gateway ${this.options.gatewayId}] agent ${participantId} thread ${event.threadId} errored, marking offline`
        );
        this.publishAgentPresence(participantId, false);
      }
    });

    this.mqtt?.subscribe(MQTT_TOPICS.agentEvents(participantId), { qos: 1 }, (err) => {
      if (err) {
        console.error(
          `[gateway ${this.options.gatewayId}] failed to subscribe events for agent ${participantId}:`,
          err.message
        );
      }
    });

    this.publishAgentPresence(participantId, true);
    console.log(
      `[gateway ${this.options.gatewayId}] spawned agent ${participantId}${command.name ? ` (name: ${command.name})` : ''}`
    );
  }

  /** 上报 agent 的 retained presence；mqtt.js 在离线期间会排队，重连后补发。 */
  private publishAgentPresence(participantId: string, online: boolean): void {
    this.mqtt?.publish(MQTT_TOPICS.presence(participantId), JSON.stringify({ online }), {
      qos: 1,
      retain: true,
    });
  }

  private createDefaultAgent(participantId: string, model?: AgentModelConfig): IAgent {
    // 模型优先级：spawn 命令自带 > gateway 显式配置 > EDGE_MODEL_* 环境变量
    const modelConfig = model
      ? createModelConfig(model)
      : this.options.modelOptions
        ? createModelConfig(this.options.modelOptions)
        : createModelConfigFromEnv();

    return new AgentRuntime({
      agentId: participantId,
      model: modelConfig.model,
      streamFn: modelConfig.streamFn,
    });
  }

  private async handleRoomEvent(managed: ManagedAgent, event: MessageDeliveredEvent): Promise<void> {
    const message = event.message;
    if (message.from === managed.participantId) {
      // 自己的回显，丢弃以避免自循环
      return;
    }

    const goal = this.buildGoal(message.from, message.content.body);
    const threadId = await managed.agent.createThread({ goal });
    this.threadRoomMap.set(threadId, message.roomId);
    await managed.agent.startThread(threadId);
  }

  private buildGoal(from: string, body: string): string {
    return `Message from ${from}: ${body}`;
  }

  private async stopAgent(participantId: string): Promise<void> {
    const managed = this.agents.get(participantId);
    if (!managed) return;

    this.publishAgentPresence(participantId, false);
    this.mqtt?.unsubscribe(MQTT_TOPICS.agentEvents(participantId));
    await managed.agent.destroy();
    this.agents.delete(participantId);
    console.log(`[gateway ${this.options.gatewayId}] stopped agent ${participantId}`);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const participantId of [...this.agents.keys()]) {
      await this.stopAgent(participantId);
    }
    if (this.mqtt) {
      const mqtt = this.mqtt;
      await new Promise<void>((resolve) => {
        if (!mqtt.connected) {
          mqtt.end(true, {}, () => resolve());
          return;
        }
        // 优雅离线：先发 retained offline，再关闭连接
        mqtt.publish(
          MQTT_TOPICS.presence(this.options.gatewayId),
          JSON.stringify({ online: false }),
          { qos: 1, retain: true },
          () => mqtt.end(true, {}, () => resolve())
        );
      });
    }
    if (this.adminServer) {
      await stopAdminServer(this.adminServer);
      this.adminServer = undefined;
    }
  }
}
