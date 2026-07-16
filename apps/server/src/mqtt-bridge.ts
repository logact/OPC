import { randomUUID } from 'node:crypto';
import mqtt, { type MqttClient } from 'mqtt';
import { MQTT_TOPICS, parseUplinkTopic, type ServerEvent } from '@logact-pub/opc-protocol';
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
  close(): Promise<void>;
}

/**
 * MQTT 数据面：订阅所有房间的上行消息，校验 + 落库后转发为 events topic 事件。
 * 订阅/成员隔离由 broker（go-auth ACL）负责，本模块只做持久化与转发。
 */
export function createMqttBridge(options: MqttBridgeOptions): MqttBridge {
  const { brokerUrl, username, password, participantRepo, roomRepo, messageRepo } = options;
  const connect = options.connectFn ?? mqtt.connect;
  const client = connect(brokerUrl, {
    username,
    password,
    clientId: `opc-server-${randomUUID()}`,
  });

  const ready = new Promise<void>((resolve, reject) => {
    client.once('connect', () => {
      client.subscribe(MQTT_TOPICS.uplinkFilter, { qos: 1 }, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });

  client.on('error', (err) => {
    console.error('[mqtt-bridge] connection error:', err.message);
  });

  client.on('message', (topic, payload) => void handleUplink(topic, payload));

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
      client.publish(MQTT_TOPICS.events(roomId), JSON.stringify(event), { qos: 1 });
    } catch (err) {
      console.error(`[mqtt-bridge] failed to handle uplink on ${topic}:`, err);
    }
  }

  return {
    client,
    ready,
    publish(roomId: string, event: ServerEvent) {
      client.publish(MQTT_TOPICS.events(roomId), JSON.stringify(event), { qos: 1 });
    },
    close: () =>
      new Promise((resolve) => {
        client.end(true, {}, () => resolve());
      }),
  };
}
