import { randomUUID } from 'node:crypto';
import mqtt, { type MqttClient } from 'mqtt';
import type { IAgent } from '@opc/agent-edge';
import {
  AgentRuntime,
  createModelConfig,
  createModelConfigFromEnv,
  type EdgeModelOptions,
} from '@opc/agent-edge';
import {
  GatewayCommandSchema,
  MQTT_TOPICS,
  type GatewayCommand,
  type MessageDeliveredEvent,
} from '@logact-pub/opc-protocol';
import { OpcClient } from '@logact-pub/opc-sdk';

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
    });
    this.mqtt = client;

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
      await this.spawnAgent(command.participantId, command.token);
    } else if (command.type === 'agent.stop') {
      await this.stopAgent(command.participantId);
    }
  }

  private async spawnAgent(participantId: string, token: string): Promise<void> {
    if (this.agents.has(participantId)) {
      console.warn(`[gateway ${this.options.gatewayId}] agent ${participantId} already spawned`);
      return;
    }

    const agent = this.options.agentFactory
      ? await this.options.agentFactory(participantId)
      : this.createDefaultAgent(participantId);
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

    console.log(`[gateway ${this.options.gatewayId}] spawned agent ${participantId}`);
  }

  private createDefaultAgent(participantId: string): IAgent {
    const modelConfig = this.options.modelOptions
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
      await new Promise<void>((resolve) => {
        this.mqtt?.end(true, {}, () => resolve());
      });
    }
  }
}
