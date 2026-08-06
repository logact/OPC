import { randomUUID } from 'node:crypto';
import mqtt, { type MqttClient } from 'mqtt';
import {
  MQTT_TOPICS,
  parsePresenceTopic,
  parseReadsTopic,
  parseUplinkTopic,
  PresencePayloadSchema,
  RoomReadsPayloadSchema,
  type GatewayCommand,
  type GatewaySpawnCommand,
  type ServerEvent,
} from '@logact-pub/opc-protocol';
import type { UplinkPayload } from '@logact-pub/opc-protocol';
import { createTextMessage } from '@logact-pub/opc-core';
import type {
  MessageRepository,
  ParticipantRepository,
  RoomRepository,
} from '@opc/database';

export interface MqttBridgeOptions {
  brokerUrl: string;
  /** superuser 身份：可订阅 uplink 通配 topic、向任意 events topic 发布 */
  username: string;
  password: string;
  participantRepo: ParticipantRepository;
  roomRepo: RoomRepository;
  messageRepo: MessageRepository;
  /** 测试注入用 */
  connectFn?: typeof mqtt.connect;
}

export interface MqttBridge {
  client: MqttClient;
  /** uplink 通配 topic 订阅就绪 */
  ready: Promise<void>;
  publish(roomId: string, event: ServerEvent): void;
  publishGatewayCommand(gatewayId: string, command: GatewayCommand): void;
  close(): Promise<void>;
}

/**
 * MQTT 数据面：订阅所有房间的上行消息，校验 + 落库后转发为 events topic 事件；
 * 订阅 reads 通配 topic，单调推进已读游标并 fan-out read.updated（issue #108）；
 * 订阅 presence 通配 topic，把在线状态变化（LWT / retained）持久化到 participants 表。
 * 订阅/成员隔离由 broker（go-auth ACL）负责，本模块只做持久化与转发。
 */
export function createMqttBridge(options: MqttBridgeOptions): MqttBridge {
  const { brokerUrl, username, password, participantRepo, roomRepo, messageRepo } = options;
  const connect = options.connectFn ?? mqtt.connect;
  const client = connect(brokerUrl, {
    username,
    password,
    // 固定 clientId + 持久会话：server 进程断线/重启期间，broker 为 uplink
    // 通配订阅排队 QoS1 消息，重连后补收，避免丢消息（issue #84）
    clientId: 'opc-server-bridge',
    clean: false,
  });

  const ready = new Promise<void>((resolve, reject) => {
    client.once('connect', () => {
      // uplink 通配 + reads 通配 + presence 通配；presence 订阅会立即回放所有
      // retained 状态消息，server 重启后据此恢复在线状态
      client.subscribe(MQTT_TOPICS.uplinkFilter, { qos: 1 }, (err) => {
        if (err) return reject(err);
        client.subscribe(MQTT_TOPICS.readsFilter, { qos: 1 }, (err2) => {
          if (err2) return reject(err2);
          client.subscribe(MQTT_TOPICS.presenceFilter, { qos: 1 }, (err3) => {
            if (err3) reject(err3);
            else resolve();
          });
        });
      });
    });
  });

  client.on('connect', () => {
    console.log(`[mqtt-bridge] connected to ${brokerUrl}`);
  });

  client.on('reconnect', () => {
    console.log('[mqtt-bridge] reconnecting...');
  });

  client.on('close', () => {
    console.warn('[mqtt-bridge] connection closed');
  });

  client.on('error', (err) => {
    console.error('[mqtt-bridge] connection error:', err.message);
  });

  client.on('message', (topic, payload) => {
    const participantId = parsePresenceTopic(topic);
    if (participantId) {
      void handlePresence(participantId, payload);
      return;
    }
    const readsRoomId = parseReadsTopic(topic);
    if (readsRoomId) {
      void handleReads(readsRoomId, topic, payload);
      return;
    }
    void handleUplink(topic, payload);
  });

  async function handlePresence(participantId: string, raw: Buffer) {
    let body: unknown;
    try {
      body = JSON.parse(raw.toString('utf8'));
    } catch {
      console.warn(`[mqtt-bridge] malformed JSON on presence of ${participantId}, dropped`);
      return;
    }

    const parsed = PresencePayloadSchema.safeParse(body);
    if (!parsed.success) {
      console.warn(`[mqtt-bridge] invalid presence payload of ${participantId}, dropped`);
      return;
    }

    // lastSeen 由 server 打时间戳：负载不携带时间（LWT 内嵌时间不可靠）
    try {
      await participantRepo.setPresence(participantId, parsed.data.online, parsed.data.status);
      console.log(
        `[mqtt-bridge] presence: ${participantId} online=${parsed.data.online}` +
          (parsed.data.status ? ` status=${parsed.data.status}` : '')
      );
      await cascadeGatewayPresence(participantId, parsed.data.online);
      await respawnGatewayAgents(participantId, parsed.data.online);
    } catch (err) {
      console.error(`[mqtt-bridge] failed to persist presence of ${participantId}:`, err);
    }
  }

  /**
   * gateway 上线时重发其名下所有 agent 的 agent.spawn（issue #84）：
   * gateway 进程重启后内存中的 agents 表丢失，而 spawn 原本只在 participant
   * 注册时下发一次。此处按注册时持久化在 participant.metadata.spawn 的参数
   * 重发；gateway 侧 spawn 幂等（已运行的 agent 会跳过），重复下发无害。
   */
  async function respawnGatewayAgents(participantId: string, online: boolean) {
    if (!online) return;
    const participant = await participantRepo.findById(participantId);
    if (participant?.kind !== 'gateway') return;
    const agents = await participantRepo.listByGatewayId(participantId);
    if (agents.length > 0) {
      console.log(`[mqtt-bridge] gateway ${participantId} online, respawning ${agents.length} agent(s)`);
    }
    for (const agent of agents) {
      const spawn = agent.metadata?.spawn as
        | { name?: string; model?: GatewaySpawnCommand['model'] }
        | undefined;
      const command: GatewaySpawnCommand = {
        type: 'agent.spawn',
        participantId: agent.id,
        name: spawn?.name ?? agent.name ?? undefined,
        model: spawn?.model,
      };
      client.publish(MQTT_TOPICS.gatewayControl(participantId), JSON.stringify(command), {
        qos: 1,
      });
    }
  }

  /**
   * gateway 掉线级联：gateway 是其名下所有 agent 的唯一数据面出口，
   * gateway offline 时这些 agent 必然不可用，一并置为 offline 并覆写
   * retained presence（否则新订阅者会读到残留的旧 online 状态）。
   */
  async function cascadeGatewayPresence(participantId: string, online: boolean) {
    if (online) return;
    const participant = await participantRepo.findById(participantId);
    if (participant?.kind !== 'gateway') return;
    const agents = await participantRepo.listByGatewayId(participantId);
    if (agents.length > 0) {
      console.log(`[mqtt-bridge] gateway ${participantId} offline, cascading ${agents.length} agent(s) to offline`);
    }
    for (const agent of agents) {
      await participantRepo.setPresence(agent.id, false);
      client.publish(MQTT_TOPICS.presence(agent.id), JSON.stringify({ online: false }), {
        qos: 1,
        retain: true,
      });
    }
  }

  /**
   * 下行统一出口：房间事件发 events topic，并向房间内 kind=agent 且有所属
   * gateway 的成员 fan-out 到各自的 agent events topic（由其 gateway 订阅）。
   */
  async function publishToRoom(roomId: string, event: ServerEvent) {
    console.log(`[mqtt-bridge] publishToRoom: roomId=${roomId}, event=${JSON.stringify(event)}`);
    const payload = JSON.stringify(event);
    client.publish(MQTT_TOPICS.events(roomId), payload, { qos: 1 });

    const room = await roomRepo.findById(roomId);
    console.log(`[mqtt-bridge] publishToRoom: roomId=${roomId}, members=${room?.participantIds.join(',') ?? '(none)'}`);
    if (!room) return;
    const members = await participantRepo.findByIds(room.participantIds);
    for (const member of members) {
      if (member.kind === 'agent' && member.gatewayId) {
        console.log(`[mqtt-bridge] publishToRoom: publishing to agentEvents for member=${member.id}`);
        client.publish(MQTT_TOPICS.agentEvents(member.id), payload, { qos: 1 });
      }
    }
  }

  async function handleUplink(topic: string, raw: Buffer) {
    const roomId = parseUplinkTopic(topic);
    if (!roomId) return;

    let body: UplinkPayload;
    try {
      body = JSON.parse(raw.toString('utf8')) as UplinkPayload;
    } catch {
      console.warn(`[mqtt-bridge] malformed JSON on ${topic}, dropped`);
      return;
    }

    if (typeof body?.from !== 'string' || typeof body?.content?.body !== 'string') {
      console.warn(`[mqtt-bridge] invalid uplink payload on ${topic}, dropped`);
      return;
    }

    try {
      const room = await roomRepo.findById(roomId);
      if (!room) {
        console.warn(`[mqtt-bridge] uplink for unknown room ${roomId}, dropped`);
        return;
      }

      await participantRepo.ensure(body.from);
      const message = createTextMessage(
        randomUUID(),
        roomId,
        body.from,
        body.content.body,
        body.clientMessageId ? { clientMessageId: body.clientMessageId } : undefined
      );
      await messageRepo.insert(roomId, message);

      const event: ServerEvent = { type: 'message.delivered', message };
      await publishToRoom(roomId, event);
    } catch (err) {
      console.error(`[mqtt-bridge] failed to handle uplink on ${topic}:`, err);
    }
  }

  /**
   * 已读回执（issue #108）：只接受房间内现有成员的回执（不像 uplink 会
   * ensure 创建 participant；gateway 代发的回执 from 即其名下 agent，本身
   * 就是房间成员）。游标单调推进，未推进（重复/更旧的回执）时不广播。
   */
  async function handleReads(roomId: string, topic: string, raw: Buffer) {
    let body: unknown;
    try {
      body = JSON.parse(raw.toString('utf8'));
    } catch {
      console.warn(`[mqtt-bridge] malformed JSON on ${topic}, dropped`);
      return;
    }

    const parsed = RoomReadsPayloadSchema.safeParse(body);
    if (!parsed.success) {
      console.warn(`[mqtt-bridge] invalid reads payload on ${topic}, dropped`);
      return;
    }

    try {
      const room = await roomRepo.findById(roomId);
      if (!room) {
        console.warn(`[mqtt-bridge] read receipt for unknown room ${roomId}, dropped`);
        return;
      }
      if (!room.participantIds.includes(parsed.data.from)) {
        console.warn(
          `[mqtt-bridge] read receipt from non-member ${parsed.data.from} on room ${roomId}, dropped`
        );
        return;
      }

      const advanced = await roomRepo.setLastReadAt(
        roomId,
        parsed.data.from,
        new Date(parsed.data.lastReadAt)
      );
      if (!advanced) return;

      const event: ServerEvent = {
        type: 'read.updated',
        roomId,
        participantId: parsed.data.from,
        lastReadAt: parsed.data.lastReadAt,
      };
      await publishToRoom(roomId, event);
    } catch (err) {
      console.error(`[mqtt-bridge] failed to handle read receipt on ${topic}:`, err);
    }
  }

  return {
    client,
    ready,
    publish(roomId: string, event: ServerEvent) {
      void publishToRoom(roomId, event).catch((err) => {
        console.error(`[mqtt-bridge] failed to publish event on room ${roomId}:`, err);
      });
    },
    publishGatewayCommand(gatewayId: string, command: GatewayCommand) {
      client.publish(MQTT_TOPICS.gatewayControl(gatewayId), JSON.stringify(command), { qos: 1 });
    },
    close: () =>
      new Promise((resolve) => {
        client.end(true, {}, () => resolve());
      }),
  };
}
