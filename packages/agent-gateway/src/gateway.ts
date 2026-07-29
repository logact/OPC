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
  type AgentModelConfig,
  type GatewayCommand,
  type GatewaySpawnCommand,
  type MessageDeliveredEvent,
} from '@logact-pub/opc-protocol';
import { OpcClient } from '@logact-pub/opc-sdk';
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
  /** 房间同步周期（ms），默认 5000。 */
  roomSyncIntervalMs?: number;
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
  client: OpcClient;
  subscribedRooms: Set<string>;
  syncTimer?: ReturnType<typeof setInterval>;
}

const DEFAULT_ROOM_SYNC_INTERVAL_MS = 5000;

/**
 * AgentGateway 是边缘机器上的网络编排层：
 * - 自身以 gateway participant 身份连 MQTT，订阅控制 topic；
 * - 收到 agent.spawn 后在进程内创建 AgentRuntime + 独立 MQTT client；
 * - 周期同步该 agent 所在的房间并订阅 events；
 * - 把房间内消息映射为 thread goal，agent 的回复再 PUBLISH 回房间 uplink。
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

    // 每次（重）连成功发布 retained online
    client.on('connect', () => {
      client.publish(MQTT_TOPICS.presence(gatewayId), JSON.stringify({ online: true }), {
        qos: 1,
        retain: true,
      });
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

    client.on('message', (_topic, payload) => void this.handleCommand(payload));
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
      subscribedRooms: [...managed.subscribedRooms],
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

  private async spawnAgent(command: GatewaySpawnCommand): Promise<void> {
    const { participantId, token } = command;
    if (this.agents.has(participantId)) {
      console.warn(`[gateway ${this.options.gatewayId}] agent ${participantId} already spawned`);
      return;
    }

    const agent = this.options.agentFactory
      ? await this.options.agentFactory(participantId)
      : this.createDefaultAgent(participantId, command.model);
    await agent.initialize({});
    await agent.start();

    const client = new OpcClient({
      baseUrl: this.options.serverUrl,
      brokerUrl: this.options.brokerUrl,
      participantId,
      token,
      accessToken: token,
      reconnectPeriod: 5000,
      connectFn: this.options.connectFn,
    });
    await client.connect();

    const managed: ManagedAgent = {
      participantId,
      agent,
      client,
      subscribedRooms: new Set(),
    };
    this.agents.set(participantId, managed);

    agent.onMessage((message) => {
      const roomId = this.threadRoomMap.get(message.threadId);
      if (!roomId) {
        console.warn(`[gateway ${this.options.gatewayId}] no room mapping for thread ${message.threadId}`);
        return;
      }
      void client.sendText(roomId, message.content.body, message.id);
    });

    client.events.on('message.delivered', (event: MessageDeliveredEvent) => {
      void this.handleRoomEvent(managed, event);
    });

    await this.syncRooms(managed);
    managed.syncTimer = setInterval(
      () => void this.syncRooms(managed),
      this.options.roomSyncIntervalMs ?? DEFAULT_ROOM_SYNC_INTERVAL_MS
    );

    console.log(
      `[gateway ${this.options.gatewayId}] spawned agent ${participantId}${command.name ? ` (name: ${command.name})` : ''}`
    );
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

  private async syncRooms(managed: ManagedAgent): Promise<void> {
    try {
      const { rooms } = await managed.client.http.listRooms();
      const desired = new Set(
        rooms.filter((room) => room.participantIds.includes(managed.participantId)).map((room) => room.id)
      );

      for (const roomId of desired) {
        if (!managed.subscribedRooms.has(roomId)) {
          await managed.client.subscribeRoom(roomId);
          managed.subscribedRooms.add(roomId);
        }
      }

      for (const roomId of managed.subscribedRooms) {
        if (!desired.has(roomId)) {
          await managed.client.unsubscribeRoom(roomId);
          managed.subscribedRooms.delete(roomId);
        }
      }
    } catch (err) {
      console.error(`[gateway ${this.options.gatewayId}] room sync failed for ${managed.participantId}:`, err);
    }
  }

  private async stopAgent(participantId: string): Promise<void> {
    const managed = this.agents.get(participantId);
    if (!managed) return;

    if (managed.syncTimer) {
      clearInterval(managed.syncTimer);
    }
    await managed.agent.destroy();
    await managed.client.disconnect();
    this.agents.delete(participantId);
    console.log(`[gateway ${this.options.gatewayId}] stopped agent ${participantId}`);
  }

  /** 测试/诊断用：查询指定 agent 是否已订阅某房间事件 */
  isAgentSubscribedToRoom(participantId: string, roomId: string): boolean {
    return this.agents.get(participantId)?.subscribedRooms.has(roomId) ?? false;
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
