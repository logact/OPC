import mqtt, { type MqttClient as MqttConnection, type IClientOptions } from 'mqtt';
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

export function createOpcMqttClient(options: OpcMqttClientOptions): OpcMqttClient {
  let connection: MqttConnection | null = null;
  let state: MqttConnectionState = 'disconnected';
  let lastError: Error | null = null;
  const subscribedRooms = new Set<string>();
  const eventListeners = new Set<(event: ServerEvent) => void>();
  const stateListeners = new Set<(state: MqttConnectionState) => void>();
  const errorListeners = new Set<(error: Error) => void>();

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
      const mqttOptions: IClientOptions = {
        username: options.participantId,
        password: options.token,
        clientId: options.clientId,
        protocol: options.brokerUrl.startsWith('mqtts:') ? 'mqtts' : 'mqtt',
        reconnectPeriod: 3000,
        connectTimeout: 30_000,
        clean: true,
      };

      connection = mqtt.connect(options.brokerUrl, mqttOptions);

      connection.on('connect', () => {
        lastError = null;
        setState('connected');
        subscribedRooms.forEach((roomId) => {
          connection?.subscribe(MQTT_TOPICS.events(roomId), { qos: EVENTS_QOS });
        });
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
      connection.end(true);
      connection = null;
      subscribedRooms.clear();
      setState('disconnected');
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
      if (!connection || state !== 'connected') {
        throw new Error('MQTT client is not connected');
      }
      connection.publish(
        MQTT_TOPICS.uplink(roomId),
        JSON.stringify(payload),
        { qos: UPLINK_QOS },
      );
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
