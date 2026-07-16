import { connect as mqttConnect, type MqttClient } from 'mqtt';
import { MQTT_TOPICS, type UplinkPayload } from '@logact-pub/opc-protocol';
import type { ServerEvent } from '@logact-pub/opc-core';
import { EventBus } from './events.js';
import { OpcHttpClient } from './http.js';

export interface OpcClientOptions {
  /** HTTP 管理面地址，如 http://localhost:3000 */
  baseUrl: string;
  /** MQTT broker 地址，如 mqtt://localhost:1883 */
  brokerUrl: string;
  participantId: string;
  /** POST /api/v1/participants 发放的 token */
  token: string;
}

/**
 * 通用客户端：任何 Participant 都使用这个类接入。
 * 管理操作走 HTTP；实时消息走 MQTT（客户端直连 broker，server 落库后经 events topic 转发）。
 */
export class OpcClient {
  readonly http: OpcHttpClient;
  readonly events = new EventBus();
  private mqtt?: MqttClient;

  constructor(private readonly options: OpcClientOptions) {
    this.http = new OpcHttpClient(options.baseUrl);
  }

  connect(): void {
    this.mqtt = mqttConnect(this.options.brokerUrl, {
      username: this.options.participantId,
      password: this.options.token,
    });

    this.mqtt.on('connect', () => {
      this.events.emit('authenticated', this.options.participantId);
    });

    this.mqtt.on('message', (_topic, payload) => {
      try {
        const event = JSON.parse(payload.toString('utf8')) as ServerEvent;
        this.events.emitEvent(event);
      } catch {
        this.events.emit('protocol-error', payload.toString('utf8'));
      }
    });

    this.mqtt.on('error', (err) => {
      this.events.emit('error', err);
    });
  }

  disconnect(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.mqtt) return resolve();
      this.mqtt.end(false, {}, () => resolve());
    });
  }

  subscribeRoom(roomId: string): void {
    this.mqtt?.subscribe(MQTT_TOPICS.events(roomId), { qos: 1 }, (err) => {
      if (err) this.events.emit('error', err);
    });
  }

  unsubscribeRoom(roomId: string): void {
    this.mqtt?.unsubscribe(MQTT_TOPICS.events(roomId), (err) => {
      if (err) this.events.emit('error', err);
    });
  }

  sendText(roomId: string, text: string, clientMessageId?: string): void {
    const payload: UplinkPayload = {
      from: this.options.participantId,
      content: { type: 'text', body: text },
      clientMessageId,
    };
    this.mqtt?.publish(MQTT_TOPICS.uplink(roomId), JSON.stringify(payload), { qos: 1 }, (err) => {
      if (err) this.events.emit('error', err);
    });
  }
}

export { type ServerEvent };
