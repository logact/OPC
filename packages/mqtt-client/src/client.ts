import mqtt, { type MqttClient as MqttConnection, type IClientOptions } from 'mqtt';
import {
  MQTT_TOPICS as PROTOCOL_MQTT_TOPICS,
  parsePresenceTopic,
  PresencePayloadSchema,
  type PresencePayload,
} from '@logact-pub/opc-protocol';
import { MQTT_TOPICS } from './topics.js';
import type {
  MqttConnectionState,
  OpcMqttClient,
  OpcMqttClientOptions,
  ServerEvent,
  UplinkPayload,
} from './types.js';

const UPLINK_QOS = 1 as const;
const EVENTS_QOS = 1 as const;
const PRESENCE_QOS = 1 as const;

export function createOpcMqttClient(options: OpcMqttClientOptions): OpcMqttClient {
  let connection: MqttConnection | null = null;
  let state: MqttConnectionState = 'disconnected';
  let lastError: Error | null = null;
  const subscribedRooms = new Set<string>();
  const presenceListeners = new Set<(participantId: string, presence: PresencePayload) => void>();
  const eventListeners = new Set<(event: ServerEvent) => void>();
  const stateListeners = new Set<(state: MqttConnectionState) => void>();
  const errorListeners = new Set<(error: Error) => void>();

  const ownPresenceTopic = PROTOCOL_MQTT_TOPICS.presence(options.participantId);

  function setState(next: MqttConnectionState): void {
    if (state === next) return;
    state = next;
    stateListeners.forEach((listener) => listener(next));
  }

  function emitError(error: Error): void {
    lastError = error;
    setState('error');
    errorListeners.forEach((listener) => listener(error));
  }

  function handleMessage(topic: string, payload: Buffer): void {
    const presenceId = parsePresenceTopic(topic);
    if (presenceId) {
      try {
        const parsed = PresencePayloadSchema.safeParse(JSON.parse(payload.toString()));
        if (parsed.success) {
          presenceListeners.forEach((listener) => listener(presenceId, parsed.data));
        }
      } catch {
        // 忽略格式非法的 presence 消息
      }
      return;
    }

    if (!topic.endsWith('/events')) return;

    let event: ServerEvent;
    try {
      event = JSON.parse(payload.toString()) as ServerEvent;
    } catch (err) {
      emitError(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    eventListeners.forEach((listener) => listener(event));
  }

  return {
    get state() {
      return state;
    },
    get error() {
      return lastError;
    },

    connect: () => {
      if (connection) return;

      setState('connecting');
      // Transport follows the brokerUrl scheme. In React Native, mqtt.js
      // resolves to its browser build (see mqtt's package exports), which has
      // no raw-TCP transport — 'mqtt'/'mqtts' only work in Node; the app must
      // use a ws:// / wss:// broker URL (mosquitto serves WS on 9001).
      const protocol = options.brokerUrl.startsWith('mqtts:')
        ? ('mqtts' as const)
        : options.brokerUrl.startsWith('wss:')
          ? ('wss' as const)
          : options.brokerUrl.startsWith('ws:')
            ? ('ws' as const)
            : ('mqtt' as const);
      const mqttOptions: IClientOptions = {
        username: options.participantId,
        password: options.token,
        clientId: options.clientId,
        protocol,
        reconnectPeriod: 3000,
        connectTimeout: 30_000,
        clean: true,
        // presence：异常断线（崩溃/杀进程/网络断开）由 broker 发布 LWT
        will: {
          topic: ownPresenceTopic,
          payload: JSON.stringify({ online: false }),
          qos: PRESENCE_QOS,
          retain: true,
        },
      };

      connection = mqtt.connect(options.brokerUrl, mqttOptions);

      connection.on('connect', () => {
        lastError = null;
        setState('connected');
        // 每次（重）连成功发布 retained online
        connection?.publish(ownPresenceTopic, JSON.stringify({ online: true }), {
          qos: PRESENCE_QOS,
          retain: true,
        });
        subscribedRooms.forEach((roomId) => {
          connection?.subscribe(MQTT_TOPICS.events(roomId), { qos: EVENTS_QOS });
        });
        if (presenceListeners.size > 0) {
          connection?.subscribe(PROTOCOL_MQTT_TOPICS.presenceFilter, { qos: PRESENCE_QOS });
        }
      });

      connection.on('reconnect', () => {
        setState('connecting');
      });

      connection.on('offline', () => {
        setState('disconnected');
      });

      connection.on('error', (err) => {
        emitError(err);
      });

      connection.on('message', handleMessage);
    },

    disconnect: () => {
      if (!connection) return;
      const conn = connection;
      connection = null;
      subscribedRooms.clear();
      setState('disconnected');
      if (conn.connected) {
        // 优雅离线：先发 retained offline（等 broker 确认），再关闭连接
        conn.publish(ownPresenceTopic, JSON.stringify({ online: false }), {
          qos: PRESENCE_QOS,
          retain: true,
        }, () => conn.end(true));
      } else {
        conn.end(true);
      }
    },

    subscribeRoom: (roomId: string) => {
      subscribedRooms.add(roomId);
      if (state === 'connected' && connection) {
        connection.subscribe(MQTT_TOPICS.events(roomId), { qos: EVENTS_QOS });
      }
    },

    unsubscribeRoom: (roomId: string) => {
      subscribedRooms.delete(roomId);
      if (state === 'connected' && connection) {
        connection.unsubscribe(MQTT_TOPICS.events(roomId));
      }
    },

    sendUplink: (roomId: string, payload: UplinkPayload) => {
      console.log(`[mqtt-client] sendUplink prepare: ${JSON.stringify(payload)}`);

      if (!connection || state !== 'connected') {
        throw new Error('MQTT client is not connected');
      }
      const topic = MQTT_TOPICS.uplink(roomId);
      console.log(`[mqtt-client] sendUplink → ${topic}: ${JSON.stringify(payload)}`);
      connection.publish(topic, JSON.stringify(payload), { qos: UPLINK_QOS }, (err) => {
        if (err) {
          console.error(`[mqtt-client] sendUplink failed (${topic}):`, err);
        }
      });
    },

    subscribePresence: (listener) => {
      presenceListeners.add(listener);
      if (state === 'connected' && connection) {
        connection.subscribe(PROTOCOL_MQTT_TOPICS.presenceFilter, { qos: PRESENCE_QOS });
      }
      return () => {
        presenceListeners.delete(listener);
        if (presenceListeners.size === 0 && state === 'connected' && connection) {
          connection.unsubscribe(PROTOCOL_MQTT_TOPICS.presenceFilter);
        }
      };
    },

    onEvent: (listener) => {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },

    onStateChange: (listener) => {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },

    onError: (listener) => {
      errorListeners.add(listener);
      return () => errorListeners.delete(listener);
    },
  };
}
