import type { Server } from 'node:http';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import mqtt, { type MqttClient } from 'mqtt';
import type { IAgent, StatusChangeEvent } from '@opc/agent-edge';
import {
  AgentRuntime,
  EXECUTION_TOOL_NAMES,
  createExecutionTools,
  createModelConfig,
  createModelConfigFromEnv,
  deriveAgentActivity,
  type EdgeModelOptions,
  type ExecutionToolName,
} from '@opc/agent-edge';
import {
  API_ROUTES,
  GatewayCommandSchema,
  ListRoomsResponseSchema,
  MQTT_TOPICS,
  RoomHistoryResponseSchema,
  ServerEventSchema,
  TaskMessageMetadataSchema,
  parseAgentEventsTopic,
  parseGatewayControlTopic,
  type AgentModelConfig,
  type AgentPresenceStatus,
  type BlockTaskRequest,
  type FailTaskRequest,
  type GatewayCommand,
  type GatewaySpawnCommand,
  type Message,
  type MessageDeliveredEvent,
  type ResumeTaskRequest,
  type SubmitTaskRequest,
  type TaskCommandRequest,
  type TaskMessageMetadata,
} from '@logact-pub/opc-protocol';
import { OpcHttpClient, OpcHttpError } from '@logact-pub/opc-sdk';
import {
  createStateStore,
  type GatewayStateStore,
  type TaskCallbackCommand,
  type TaskCallbackRecord,
  type TaskExecutionRecord,
  type TaskExecutionState,
  type Watermark,
} from './state.js';
import {
  startAdminServer,
  stopAdminServer,
  type AdminAgentEntry,
  type AdminDataSource,
  type AdminThreadEntry,
} from './admin.js';
import { buildModelCatalog } from './model-catalog.js';
import { createLogger, type Logger } from './logger.js';

/** mqtt.js 支持的传输 scheme；其余（如直接把 HTTP 端口当 broker）建不了 MQTT 会话。 */
const SUPPORTED_BROKER_PROTOCOLS = new Set(['mqtt:', 'mqtts:', 'ws:', 'wss:']);

/**
 * 连接前校验 brokerUrl：配置错误应尽早以可读信息失败，
 * 而不是连上错误的端口后在 mqtt-packet 里炸出晦涩的解析错误。
 */
function assertBrokerUrl(brokerUrl: string): void {
  let url: URL;
  try {
    url = new URL(brokerUrl);
  } catch {
    throw new Error(`invalid brokerUrl "${brokerUrl}": not a valid URL`);
  }
  if (!SUPPORTED_BROKER_PROTOCOLS.has(url.protocol)) {
    throw new Error(
      `invalid brokerUrl "${brokerUrl}": unsupported protocol "${url.protocol}"; ` +
        'expected one of mqtt://, mqtts://, ws://, wss://',
    );
  }
}

/**
 * mqtt-packet 的报文解析错误：几乎总是把 mqtt:// 指向了
 * WebSocket / HTTP listener（例如 mosquitto 的 9001 端口），
 * 收到的是 HTTP 字节流而非 MQTT 报文。
 */
function isMqttParseError(err: Error): boolean {
  return /Invalid (header flag bits|packet type)/.test(err.message);
}

/**
 * 解析 EDGE_AGENT_TOOLS（issue #136）：默认全套 bash,read,write,edit；
 * 逗号分隔裁剪；显式设为空字符串表示不注入任何执行工具；
 * 未知名字告警并忽略。
 */
function parseExecutionToolNames(raw: string | undefined, logger: Logger): ExecutionToolName[] {
  if (raw === undefined) return [...EXECUTION_TOOL_NAMES];
  const valid = new Set<string>(EXECUTION_TOOL_NAMES);
  const names: ExecutionToolName[] = [];
  for (const part of raw.split(',')) {
    const name = part.trim();
    if (name.length === 0) continue;
    if (valid.has(name)) {
      names.push(name as ExecutionToolName);
    } else {
      logger.warn('unknown execution tool in EDGE_AGENT_TOOLS, ignored', { name });
    }
  }
  return names;
}

/**
 * Agent workspace 目录（issue #136）：EDGE_AGENT_WORKSPACE 显式指定时按原值
 * 使用，否则默认 ~/.opc-gateway/workspaces/<agentId>；spawn 时确保存在。
 */
function resolveAgentWorkspace(participantId: string): string {
  const dir =
    process.env.EDGE_AGENT_WORKSPACE ??
    join(homedir(), '.opc-gateway', 'workspaces', participantId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

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
  /**
   * SQLite 状态库路径（issue #84 离线补投的水位游标持久化）。
   * 默认 ':memory:'（进程内有效、重启即丢）；CLI 默认传
   * ~/.opc-gateway/state.db，测试可显式传 ':memory:'。
   * 打开失败时降级为无持久化（仅告警，不阻塞启动）。
   */
  stateDbPath?: string;
  /**
   * 自定义 logger。未提供时使用内置 console logger，级别由
   * `EDGE_LOG_LEVEL` / `LOG_LEVEL` 控制（默认 info）。
   */
  logger?: Logger;
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
  private readonly logger: Logger;
  private mqtt?: MqttClient;
  private readonly agents = new Map<string, ManagedAgent>();
  private readonly threadRoomMap = new Map<string, string>();
  /** 每个 agent 最近一次发布的忙闲状态（去抖 + 重连补发用）。 */
  private readonly lastActivity = new Map<string, AgentPresenceStatus>();
  private adminServer?: Server;
  private startedAtMs?: number;
  private stopped = false;
  private inboundQueue: Promise<void> = Promise.resolve();
  private state?: GatewayStateStore;
  /** 正在处理中的消息（roomId:messageId）：MQTT 队列与 HTTP 补投并发时的同步去重 */
  private readonly inflightMessages = new Set<string>();
  /** 当前进程中仍有 live runtime context 的 task execution。 */
  private readonly taskExecutionByThread = new Map<string, TaskExecutionRecord>();
  private readonly taskExecutionByAgentRoom = new Map<string, TaskExecutionRecord>();
  /** 标记 task room，避免非 assignee 因普通 room fan-out 意外创建 chat thread。 */
  private readonly taskControlledRooms = new Set<string>();
  private readonly latestTaskOutbound = new Map<string, { id: string; body: string }>();
  private readonly callbackSequences = new Map<string, number>();
  private readonly callbackDrains = new Map<string, Promise<void>>();

  constructor(options: AgentGatewayOptions) {
    this.options = options;
    this.connect = options.connectFn ?? mqtt.connect;
    this.logger = options.logger ?? createLogger(`gateway:${options.gatewayId}`);
  }

  async start(): Promise<void> {
    if (this.stopped) {
      throw new Error('gateway already stopped');
    }
    this.logger.info('starting gateway', { gatewayId: this.options.gatewayId, brokerUrl: this.options.brokerUrl });

    const { gatewayId, brokerUrl, token } = this.options;
    assertBrokerUrl(brokerUrl);
    const client = this.connect(brokerUrl, {
      username: gatewayId,
      password: token,
      // 固定 clientId + 持久会话：断线期间 broker 为本 gateway 订阅的
      // control / agent events topic 排队 QoS1 消息，重连后补收（issue #84）。
      // 副作用：同 gatewayId 双进程互踢——即期望的单实例语义。
      clientId: `opc-gateway-${gatewayId}`,
      clean: false,
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

    // 每次（重）连成功：先确保控制 topic 订阅生效，再上报 online presence——
    // server 收到 gateway online 后会重发 agent.spawn（issue #84），若 presence
    // 先于订阅到达 broker，重发的命令可能因会话尚无该订阅而丢失。
    client.on('connect', () => {
      client.subscribe(MQTT_TOPICS.gatewayControl(gatewayId), { qos: 1 }, (err) => {
        if (err) {
          this.logger.error('failed to subscribe control topic', { error: err.message });
          return;
        }
        client.publish(MQTT_TOPICS.presence(gatewayId), JSON.stringify({ online: true }), {
          qos: 1,
          retain: true,
        });
        // 重发所有 agent 的 online presence（broker 可能在我们离线期间
        // 收到过 server 级联写入的 offline retained）
        for (const participantId of this.agents.keys()) {
          this.publishAgentPresence(participantId, true, this.lastActivity.get(participantId));
          void this.drainTaskCallbacks(participantId);
          // 断线重连：broker 离线队列之外再以 HTTP 历史按水位兜底补投（issue #84）
          void this.catchUpAgent(participantId).catch((err2: unknown) => {
            this.logger.warn('catch-up for agent failed', { agentId: participantId, error: err2 instanceof Error ? err2.message : String(err2) });
          });
        }
      });
    });

    await new Promise<void>((resolve, reject) => {
      const onConnect = () => {
        cleanup();
        resolve();
      };
      const onError = (err: Error) => {
        cleanup();
        reject(
          isMqttParseError(err)
            ? new Error(
                `broker at ${brokerUrl} sent non-MQTT bytes (${err.message}); ` +
                  'the port is likely a WebSocket/HTTP listener — use a ws:// brokerUrl for it',
                { cause: err },
              )
            : err,
        );
      };
      const cleanup = () => {
        client.off('connect', onConnect);
        client.off('error', onError);
      };
      client.once('connect', onConnect);
      client.once('error', onError);
    });

    // 入站消息串行处理：MQTT 保证同一连接上的顺序，但 handler 是 async 的——
    // 若并发执行，agent.stop / 房间事件可能先于尚未完成的 agent.spawn 被处理
    client.on('message', (topic, payload) => {
      this.inboundQueue = this.inboundQueue
        .then(() => this.handleMqttMessage(topic, payload))
        .catch((err: unknown) => {
          this.logger.error('failed to handle mqtt message', { topic, error: err instanceof Error ? err.message : String(err) });
        });
    });
    client.on('error', (err) => {
      this.logger.error('mqtt error', { error: err.message });
    });

    this.startedAtMs = Date.now();

    // 状态库（水位游标持久化）；打开失败降级为无持久化，绝不阻塞启动
    try {
      this.state = createStateStore(this.options.stateDbPath ?? ':memory:');
    } catch (err) {
      this.logger.warn('state store unavailable, offline catch-up degraded', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

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
        this.logger.warn('model catalog report failed', { status: res.status });
      }
    } catch (err) {
      this.logger.warn('model catalog report failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async startAdmin(): Promise<void> {
    const admin = this.options.admin;
    if (!admin) return;

    const host = admin.host ?? '127.0.0.1';
    const port = admin.port ?? 4646;
    try {
      this.adminServer = await startAdminServer(this.buildAdminDataSource(), { host, port });
      this.logger.info('admin server listening', { host, port });
    } catch (err) {
      // admin 面失败不影响数据面
      this.logger.warn('admin server failed', { host, port, error: err instanceof Error ? err.message : String(err) });
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
    this.logger.info('received mqtt message', { topic, payloadSize: raw.length, agentId });
    if (agentId) {
      await this.handleAgentEvent(agentId, raw);
    }
  }

  private async handleCommand(raw: Buffer) {
    let command: GatewayCommand;
    try {
      command = GatewayCommandSchema.parse(JSON.parse(raw.toString('utf8')));
    } catch {
      this.logger.warn('malformed gateway command, dropped');
      return;
    }

    if (command.type === 'agent.spawn') {
      this.logger.info('received spawn command', { participantId: command.participantId });
      await this.spawnAgent(command);
    } else if (command.type === 'agent.stop') {
      this.logger.info('received stop command', { participantId: command.participantId });
      await this.stopAgent(command.participantId);
    }
  }

  private async handleAgentEvent(agentId: string, raw: Buffer): Promise<void> {
    this.logger.info('received agent event', { agentId, payloadSize: raw.length });
    const managed = this.agents.get(agentId);
    if (!managed) {
      this.logger.warn('event for unknown agent, dropped', { agentId });
      return;
    }

    let body: unknown;
    try {
      body = JSON.parse(raw.toString('utf8'));
    } catch {
      this.logger.warn('malformed event for agent, dropped', { agentId });
      return;
    }

    const parsed = ServerEventSchema.safeParse(body);
    if (!parsed.success) {
      this.logger.warn('invalid event for agent, dropped', { agentId, error: parsed.error.message });
      return;
    }

    if (parsed.data.type === 'message.delivered') {
      
      await this.handleRoomEvent(managed, parsed.data);
    }
  }

  private async spawnAgent(command: GatewaySpawnCommand): Promise<void> {
    const { participantId } = command;
    if (this.agents.has(participantId)) {
      this.logger.warn('agent already spawned', { participantId });
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
      this.logger.error('agent failed to start', { participantId, error: err instanceof Error ? err.message : String(err) });
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
        this.logger.warn('no room mapping for thread, dropping outbound message', { threadId: message.threadId });
        return;
      }
      const uplinkTopic = MQTT_TOPICS.participantUplink(participantId, roomId);
      const execution = this.taskExecutionByThread.get(message.threadId);
      if (execution) {
        this.latestTaskOutbound.set(message.threadId, {
          id: message.id,
          body: message.content.body,
        });
      }
      const uplinkPayload = JSON.stringify({
        content: message.content,
        clientMessageId: message.id,
        ...(execution
          ? {
              metadata: {
                opcTask: {
                  kind: 'reply',
                  taskId: execution.taskId,
                  assignmentId: execution.assignmentId,
                  threadId: execution.threadId,
                },
              },
            }
          : {}),
      });
      this.logger.info('publishing uplink message', { topic: uplinkTopic, participantId, messageId: message.id });
      this.mqtt?.publish(uplinkTopic, uplinkPayload, { qos: 1 }, (err) => {
        if (err) {
          this.logger.error('uplink publish failed', { topic: uplinkTopic, error: err.message });
        }
      });
    });

    // runtime 状态 → presence：聚合所有 thread 状态为 agent 忙闲状态并发布。
    // error 不再标 offline——offline 只表达连接层不可用（stop/spawn 失败/
    // gateway 级联），thread 失败通过 status:'error' 展示（issue #83）。
    agent.onStatusChange((event) => {
      void this.publishAgentActivity(managed);
      this.handleTaskStatus(event);
    });

    this.mqtt?.subscribe(MQTT_TOPICS.agentEvents(participantId), { qos: 1 }, (err) => {
      if (err) {
        this.logger.error('failed to subscribe agent events', { participantId, error: err.message });
      }
    });

    this.publishAgentPresence(participantId, true, 'idle');
    this.lastActivity.set(participantId, 'idle');
    this.logger.info('agent spawned', { participantId, name: command.name });

    this.restoreTaskRoomGuards(participantId);
    this.failOrphanedTaskExecutions(participantId);
    await this.drainTaskCallbacks(participantId);

    // spawn 后按水位补投离线期间错过的房间消息（issue #84）；
    // 补投失败（如 server 不可达）不影响已 spawn 的 agent，仅告警
    try {
      await this.catchUpAgent(participantId);
    } catch (err) {
      this.logger.warn('catch-up for agent failed', {
        participantId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** 上报 agent 的 retained presence；mqtt.js 在离线期间会排队，重连后补发。 */
  private publishAgentPresence(
    participantId: string,
    online: boolean,
    status?: AgentPresenceStatus
  ): void {
    this.mqtt?.publish(
      MQTT_TOPICS.presence(participantId),
      JSON.stringify(status ? { online, status } : { online }),
      { qos: 1, retain: true }
    );
  }

  /**
   * 聚合 agent 所有 thread 的状态并发布（与上次相同则跳过，避免 retained
   * presence 被无意义刷新）。error 保持 online:true——应用层失败不等于离线。
   */
  private async publishAgentActivity(managed: ManagedAgent): Promise<void> {
    try {
      const threads = await managed.agent.getThreads();
      const activity = deriveAgentActivity(threads.map((thread) => thread.status));
      if (this.lastActivity.get(managed.participantId) === activity) return;
      this.lastActivity.set(managed.participantId, activity);
      this.publishAgentPresence(managed.participantId, true, activity);
    } catch (err) {
      this.logger.warn('failed to aggregate agent activity', {
        participantId: managed.participantId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private createDefaultAgent(participantId: string, model?: AgentModelConfig): IAgent {
    // 模型优先级：spawn 命令自带 > gateway 显式配置 > EDGE_MODEL_* 环境变量
    const modelConfig = model
      ? createModelConfig(model)
      : this.options.modelOptions
        ? createModelConfig(this.options.modelOptions)
        : createModelConfigFromEnv();

    // 执行工具（issue #136）：goal 模式注入 bash/read/write/edit，
    // 可由 EDGE_AGENT_TOOLS 裁剪；工具以 per-agent workspace 为 cwd。
    const toolNames = parseExecutionToolNames(process.env.EDGE_AGENT_TOOLS, this.logger);
    const workspaceDir = resolveAgentWorkspace(participantId);

    return new AgentRuntime({
      agentId: participantId,
      model: modelConfig.model,
      streamFn: modelConfig.streamFn,
      logger: this.logger,
      executionTools: createExecutionTools(workspaceDir, toolNames),
      workspaceDir,
    });
  }

  private async handleRoomEvent(managed: ManagedAgent, event: MessageDeliveredEvent): Promise<void> {
    this.logger.info('handling room event', { participantId: managed.participantId, eventType: event.type, messageId: event.message.id });
    const message = event.message;
    if (message.from === managed.participantId) {
      // 自己的回显，丢弃以避免自循环
      return;
    }

    // 水位去重：broker 离线队列与 HTTP 历史补投可能重叠投递同一条消息，
    // 已处理过（timestamp 早于水位，或同 timestamp 同 id）的直接跳过；
    // inflight 集合关闭"两条路径并发处理同一消息"的竞态窗口
    const watermark = this.state?.getWatermark(managed.participantId, message.roomId);
    if (watermark && !this.isAfterWatermark(message, watermark)) {
      return;
    }
    const inflightKey = `${message.roomId}:${message.id}`;
    if (this.inflightMessages.has(inflightKey)) {
      return;
    }
    this.inflightMessages.add(inflightKey);

    try {
      const taskMetadata = this.parseTaskMetadata(message.metadata);
      if (taskMetadata?.opcTask.kind === 'assignment') {
        await this.handleTaskAssignment(managed, message, taskMetadata);
        this.advanceWatermark(managed.participantId, message);
        return;
      }

      const roomKey = this.agentRoomKey(managed.participantId, message.roomId);
      const execution = this.taskExecutionByAgentRoom.get(roomKey);
      if (execution) {
        if (!this.markTaskMessageProcessed(managed.participantId, message.id)) {
          return;
        }
        if (execution.state === 'blocked') {
          const active = this.setTaskExecutionState(execution, 'active');
          this.queueTaskCallback(active, 'resume', {
            assignmentId: active.assignmentId,
            reason: 'A participant replied in the task room',
            idempotencyKey: `${active.taskId}:${active.assignmentId}:resume:${message.id}`,
          });
        }
        await managed.agent.receiveMessage({
          id: message.id,
          timestamp: new Date(message.timestamp).getTime(),
          from: message.from,
          threadId: execution.threadId,
          content: message.content,
        });
        this.advanceWatermark(managed.participantId, message);
        return;
      }

      if (this.taskControlledRooms.has(roomKey)) {
        this.markTaskMessageProcessed(managed.participantId, message.id);
        this.advanceWatermark(managed.participantId, message);
        return;
      }

      // intent 路由（issue #104）：task → goal 模式（带 complete_task 完成工具），
      // question 或未标注 → chat 模式（纯问答，回复后 waiting）。goal 始终携带
      // 发送者上下文，agent 回复时能指名道姓。
      const goal = `Message from ${message.from}: ${message.content.body}`;
      const mode = message.intent === 'task' ? 'goal' : 'chat';
      const threadId = await managed.agent.createThread({ goal, mode });
      this.threadRoomMap.set(threadId, message.roomId);
      this.state?.setThreadRoom(threadId, message.roomId, managed.participantId);
      this.logger.info('created thread for message', { participantId: managed.participantId, threadId, messageId: message.id });
      await managed.agent.startThread(threadId);

      // 处理成功后推进水位（每条立即落盘，崩溃也只重放极少量消息）
      this.advanceWatermark(managed.participantId, message);
    } finally {
      this.inflightMessages.delete(inflightKey);
    }
  }

  private parseTaskMetadata(
    metadata: Record<string, unknown> | undefined,
  ): TaskMessageMetadata | undefined {
    if (!metadata) return undefined;
    const parsed = TaskMessageMetadataSchema.safeParse(metadata);
    return parsed.success ? parsed.data : undefined;
  }

  private async handleTaskAssignment(
    managed: ManagedAgent,
    message: Message,
    metadata: TaskMessageMetadata,
  ): Promise<void> {
    const assignment = metadata.opcTask;
    if (assignment.kind !== 'assignment') return;
    const roomKey = this.agentRoomKey(managed.participantId, message.roomId);
    this.taskControlledRooms.add(roomKey);
    if (assignment.assigneeId !== managed.participantId) {
      this.markTaskMessageProcessed(managed.participantId, message.id);
      return;
    }

    const existing = this.state?.getTaskExecution(managed.participantId, assignment.taskId);
    if (existing?.assignmentId === assignment.assignmentId) {
      this.markTaskMessageProcessed(managed.participantId, message.id);
      return;
    }

    const oldLive = existing ? this.taskExecutionByThread.get(existing.threadId) : undefined;
    if (oldLive) {
      await managed.agent.terminateThread(oldLive.threadId);
      this.removeTaskExecutionMaps(oldLive);
    }

    const goal = `Message from ${message.from}: ${message.content.body}`;
    const threadId = await managed.agent.createThread({ goal, mode: 'goal' });
    const requested: TaskExecutionRecord = {
      agentId: managed.participantId,
      taskId: assignment.taskId,
      assignmentId: assignment.assignmentId,
      roomId: message.roomId,
      threadId,
      dispatchMessageId: message.id,
      state: 'active',
    };
    const claim = this.state?.claimTaskExecution(requested) ?? {
      record: requested,
      created: true,
    };
    if (!claim.created) {
      await managed.agent.destroyThread(threadId);
      return;
    }

    const execution = claim.record;
    this.setTaskExecutionMaps(execution);
    this.threadRoomMap.set(threadId, message.roomId);
    this.state?.setThreadRoom(threadId, message.roomId, managed.participantId);
    this.queueTaskCallback(execution, 'start', {
      assignmentId: execution.assignmentId,
      idempotencyKey: `${execution.taskId}:${execution.assignmentId}:start`,
    });
    try {
      await managed.agent.startThread(threadId);
    } catch (error) {
      const current = this.taskExecutionByThread.get(threadId);
      if (current && current.state !== 'failed') {
        const failed = this.setTaskExecutionState(current, 'failed');
        this.queueTaskCallback(failed, 'fail', {
          assignmentId: failed.assignmentId,
          reason: 'Agent execution failed to start',
          diagnostics: this.sanitizeDiagnostics(
            error instanceof Error ? error.message : String(error),
          ),
          idempotencyKey: `${failed.taskId}:${failed.assignmentId}:fail`,
        });
      }
    }
    this.markTaskMessageProcessed(managed.participantId, message.id);
  }

  private advanceWatermark(agentId: string, message: Message): void {
    this.state?.setWatermark(agentId, message.roomId, {
      lastTimestamp: message.timestamp,
      lastMessageId: message.id,
    });
  }

  private markTaskMessageProcessed(agentId: string, messageId: string): boolean {
    return this.state ? this.state.markTaskMessageProcessed(agentId, messageId) : true;
  }

  private agentRoomKey(agentId: string, roomId: string): string {
    return `${agentId}:${roomId}`;
  }

  private setTaskExecutionMaps(execution: TaskExecutionRecord): void {
    this.taskExecutionByThread.set(execution.threadId, execution);
    this.taskExecutionByAgentRoom.set(
      this.agentRoomKey(execution.agentId, execution.roomId),
      execution,
    );
    this.taskControlledRooms.add(this.agentRoomKey(execution.agentId, execution.roomId));
  }

  private removeTaskExecutionMaps(execution: TaskExecutionRecord): void {
    this.taskExecutionByThread.delete(execution.threadId);
    this.taskExecutionByAgentRoom.delete(
      this.agentRoomKey(execution.agentId, execution.roomId),
    );
    this.latestTaskOutbound.delete(execution.threadId);
  }

  private setTaskExecutionState(
    execution: TaskExecutionRecord,
    state: TaskExecutionState,
  ): TaskExecutionRecord {
    const updated = { ...execution, state };
    this.state?.updateTaskExecutionState(
      execution.agentId,
      execution.taskId,
      execution.assignmentId,
      state,
    );
    if (state === 'active' || state === 'blocked') {
      this.setTaskExecutionMaps(updated);
    } else {
      this.removeTaskExecutionMaps(execution);
      this.taskControlledRooms.add(this.agentRoomKey(execution.agentId, execution.roomId));
    }
    return updated;
  }

  private handleTaskStatus(event: StatusChangeEvent): void {
    if (!event.threadId) return;
    const execution = this.taskExecutionByThread.get(event.threadId);
    if (!execution) return;

    if (event.status === 'waiting' && execution.state === 'active') {
      const outbound = this.latestTaskOutbound.get(event.threadId);
      const blocked = this.setTaskExecutionState(execution, 'blocked');
      this.queueTaskCallback(blocked, 'block', {
        assignmentId: blocked.assignmentId,
        reason: outbound?.body ?? 'Agent is waiting for input in the task room',
        idempotencyKey: `${blocked.taskId}:${blocked.assignmentId}:block:${outbound?.id ?? event.threadId}`,
      });
      return;
    }

    if (event.status === 'done' && execution.state !== 'review' && execution.state !== 'failed') {
      const review = this.setTaskExecutionState(execution, 'review');
      this.queueTaskCallback(review, 'submit', {
        assignmentId: review.assignmentId,
        summary: event.summary?.trim() || 'Agent completed the assigned task',
        metadata: { threadId: review.threadId },
        idempotencyKey: `${review.taskId}:${review.assignmentId}:submit`,
      });
      return;
    }

    if (event.status === 'error' && execution.state !== 'failed') {
      const failed = this.setTaskExecutionState(execution, 'failed');
      this.queueTaskCallback(failed, 'fail', {
        assignmentId: failed.assignmentId,
        reason: 'Agent execution failed',
        diagnostics: this.sanitizeDiagnostics(event.diagnostics),
        idempotencyKey: `${failed.taskId}:${failed.assignmentId}:fail`,
      });
    }
  }

  private sanitizeDiagnostics(diagnostics: string | undefined): string {
    const safe = (diagnostics ?? 'Runtime ended with an unspecified error')
      .replace(
        /(api[-_]?key|access[-_]?token|token|secret|password)\s*[:=]\s*\S+/gi,
        '$1=[REDACTED]',
      )
      .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]');
    return safe.slice(0, 1_800);
  }

  private callbackKey(execution: TaskExecutionRecord): string {
    return `${execution.agentId}:${execution.taskId}:${execution.assignmentId}`;
  }

  private nextCallbackSequence(execution: TaskExecutionRecord): number {
    const key = this.callbackKey(execution);
    let current = this.callbackSequences.get(key);
    if (current === undefined) {
      current = this.state
        ? Math.max(
            0,
            ...this.state
              .listPendingTaskCallbacks(execution.agentId)
              .filter(
                (callback) =>
                  callback.taskId === execution.taskId &&
                  callback.assignmentId === execution.assignmentId,
              )
              .map((callback) => callback.sequence),
          )
        : 0;
    }
    const next = current + 1;
    this.callbackSequences.set(key, next);
    return next;
  }

  private queueTaskCallback(
    execution: TaskExecutionRecord,
    command: TaskCallbackCommand,
    payload: Record<string, unknown> & { idempotencyKey: string },
  ): void {
    const callback: TaskCallbackRecord = {
      agentId: execution.agentId,
      taskId: execution.taskId,
      assignmentId: execution.assignmentId,
      sequence: this.nextCallbackSequence(execution),
      command,
      idempotencyKey: payload.idempotencyKey,
      payload,
    };
    if (!this.state) {
      const client = new OpcHttpClient(this.options.serverUrl, this.options.token, {
        actorId: execution.agentId,
      });
      void this.sendTaskCallback(client, callback).catch((error: unknown) => {
        this.logger.warn('task callback failed without durable state', {
          agentId: execution.agentId,
          taskId: execution.taskId,
          command,
          error: error instanceof Error ? error.message : String(error),
        });
      });
      return;
    }
    if (!this.state.enqueueTaskCallback(callback)) return;
    void this.drainTaskCallbacks(execution.agentId);
  }

  private drainTaskCallbacks(agentId: string): Promise<void> {
    const previous = this.callbackDrains.get(agentId) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(() => this.runTaskCallbackDrain(agentId));
    this.callbackDrains.set(agentId, current);
    void current.finally(() => {
      if (this.callbackDrains.get(agentId) === current) {
        this.callbackDrains.delete(agentId);
      }
    });
    return current;
  }

  private async runTaskCallbackDrain(agentId: string): Promise<void> {
    if (!this.state) return;
    const client = new OpcHttpClient(this.options.serverUrl, this.options.token, {
      actorId: agentId,
    });
    while (true) {
      const callback = this.state.listPendingTaskCallbacks(agentId)[0];
      if (!callback) return;
      try {
        await this.sendTaskCallback(client, callback);
        this.state.completeTaskCallback(callback.idempotencyKey);
      } catch (error) {
        if (error instanceof OpcHttpError && [403, 404, 409].includes(error.status)) {
          this.logger.warn('discarding rejected task callback', {
            agentId,
            taskId: callback.taskId,
            command: callback.command,
            status: error.status,
            code: error.code,
          });
          this.state.completeTaskCallback(callback.idempotencyKey);
          continue;
        }
        this.logger.warn('task callback deferred for retry', {
          agentId,
          taskId: callback.taskId,
          command: callback.command,
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }
    }
  }

  private async sendTaskCallback(
    client: OpcHttpClient,
    callback: TaskCallbackRecord,
  ): Promise<void> {
    switch (callback.command) {
      case 'start':
        await client.startTask(callback.taskId, callback.payload as TaskCommandRequest);
        return;
      case 'block':
        await client.blockTask(callback.taskId, callback.payload as BlockTaskRequest);
        return;
      case 'resume':
        await client.resumeTask(callback.taskId, callback.payload as ResumeTaskRequest);
        return;
      case 'submit':
        await client.submitTask(callback.taskId, callback.payload as SubmitTaskRequest);
        return;
      case 'fail':
        await client.failTask(callback.taskId, callback.payload as FailTaskRequest);
    }
  }

  private failOrphanedTaskExecutions(agentId: string): void {
    if (!this.state) return;
    for (const execution of this.state.listActiveTaskExecutions(agentId)) {
      const failed = this.setTaskExecutionState(execution, 'failed');
      this.queueTaskCallback(failed, 'fail', {
        assignmentId: failed.assignmentId,
        reason: 'Agent execution context was lost during gateway restart',
        diagnostics:
          'The durable task mapping was recovered, but the in-memory runtime transcript cannot be restored safely.',
        idempotencyKey: `${failed.taskId}:${failed.assignmentId}:fail:orphan`,
      });
    }
  }

  private restoreTaskRoomGuards(agentId: string): void {
    if (!this.state) return;
    for (const execution of this.state.listTaskExecutions(agentId)) {
      this.taskControlledRooms.add(this.agentRoomKey(agentId, execution.roomId));
    }
  }

  private isAfterWatermark(message: Message, watermark: Watermark): boolean {
    if (message.timestamp > watermark.lastTimestamp) return true;
    if (message.timestamp < watermark.lastTimestamp) return false;
    return message.id !== watermark.lastMessageId;
  }

  /**
   * 离线补投（issue #84）：按 agent 所在房间逐一拉取水位之后的历史消息，
   * 走与实时事件相同的 handleRoomEvent 路径喂给 runtime（内部含水位去重）。
   * 无水位（首次 spawn）时拉取全部历史。
   */
  private async catchUpAgent(participantId: string): Promise<void> {
    const managed = this.agents.get(participantId);
    if (!managed) return;

    const { rooms } = await this.httpGet(
      API_ROUTES.participantRooms(participantId),
      ListRoomsResponseSchema
    );
    for (const room of rooms) {
      const watermark = this.state?.getWatermark(participantId, room.id);
      const path = watermark
        ? `${API_ROUTES.roomHistory(room.id)}?since=${encodeURIComponent(watermark.lastTimestamp)}`
        : API_ROUTES.roomHistory(room.id);
      const { messages } = await this.httpGet(path, RoomHistoryResponseSchema);
      // history 按时间倒序返回，补投按时间正序回放
      for (const message of [...messages].reverse()) {
        await this.handleRoomEvent(managed, { type: 'message.delivered', message });
      }
    }
  }

  /** 管理面 HTTP GET（Bearer = gateway token），响应用 protocol schema 运行时校验 */
  private async httpGet<T>(path: string, schema: { parse(data: unknown): T }): Promise<T> {
    const res = await fetch(`${this.options.serverUrl}${path}`, {
      headers: { Authorization: `Bearer ${this.options.token}` },
    });
    if (!res.ok) {
      throw new Error(`GET ${path} failed: HTTP ${res.status}`);
    }
    return schema.parse(await res.json());
  }

  private async stopAgent(participantId: string): Promise<void> {
    const managed = this.agents.get(participantId);
    if (!managed) return;

    this.publishAgentPresence(participantId, false);
    this.lastActivity.delete(participantId);
    this.mqtt?.unsubscribe(MQTT_TOPICS.agentEvents(participantId));
    await managed.agent.destroy();
    for (const execution of [...this.taskExecutionByThread.values()]) {
      if (execution.agentId === participantId) this.removeTaskExecutionMaps(execution);
    }
    this.agents.delete(participantId);
    this.logger.info('stopped agent', { participantId });
  }

  async stop(): Promise<void> {
    this.logger.info('stopping gateway', { gatewayId: this.options.gatewayId });
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
    this.state?.close();
    this.state = undefined;
    this.logger.info('gateway stopped', { gatewayId: this.options.gatewayId });
  }
}
