import { connect as mqttConnect, type MqttClient } from 'mqtt';
import { MQTT_TOPICS, type UplinkPayload } from '@logact-pub/opc-protocol';
import type { ServerEvent } from '@logact-pub/opc-protocol';
import { EventBus } from './events.js';
import { OpcHttpClient } from './http.js';

export interface OpcClientOptions {
  /** HTTP 管理面地址，如 http://localhost:3000 */
  baseUrl: string;
  /** MQTT broker 地址，如 mqtt://localhost:1883 */
  brokerUrl: string;
  participantId: string;
  /** POST /api/v1/participants 发放的 MQTT token */
  token: string;
  /** POST /api/v1/auth/login 发放的 JWT access token */
  accessToken?: string;
  /** MQTT 自动重连间隔（ms），默认 0（不重连），便于测试/应用层自行控制重连 */
  reconnectPeriod?: number;
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
    this.http = new OpcHttpClient(options.baseUrl, options.accessToken);
  }

  private emitError(err: Error): void {
    if (this.events.listenerCount('error') > 0) {
      this.events.emit('error', err);
    }
  }

  /** 建立 MQTT 连接；broker 认证通过（CONNACK）后 resolve，连接出错/关闭时 reject */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;

      const onConnect = () => {
        settled = true;
        cleanup();
        this.events.emit('authenticated', this.options.participantId);
        resolve();
      };

      const onError = (err: Error) => {
        if (settled) {
          this.emitError(err);
          return;
        }
        settled = true;
        cleanup();
        reject(err);
      };

      const onClose = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('MQTT connection closed before CONNACK'));
      };

      const cleanup = () => {
        this.mqtt?.off('connect', onConnect);
        this.mqtt?.off('error', onError);
        this.mqtt?.off('close', onClose);
      };

      this.mqtt = mqttConnect(this.options.brokerUrl, {
        username: this.options.participantId,
        password: this.options.token,
        reconnectPeriod: this.options.reconnectPeriod ?? 0,
      });

      this.mqtt.on('connect', onConnect);
      this.mqtt.on('error', onError);
      this.mqtt.on('close', onClose);

      this.mqtt.on('message', (_topic, payload) => {
        try {
          const event = JSON.parse(payload.toString('utf8')) as ServerEvent;
          this.events.emitEvent(event);
        } catch {
          this.events.emit('protocol-error', payload.toString('utf8'));
        }
      });
    });
  }

  disconnect(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.mqtt) return resolve();
      // force=true 立即终止连接（包括正在进行的重连），避免错误凭据/ACL 拒绝场景下 hang 住测试
      this.mqtt.end(true, {}, () => resolve());
    });
  }

  /** 订阅房间事件；收到 SUBACK 后 resolve，被 broker 拒绝时 reject */
  subscribeRoom(roomId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.mqtt) return reject(new Error('not connected'));
      let settled = false;

      const onError = (err: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        this.emitError(err);
        reject(err);
      };

      const cleanup = () => {
        this.mqtt?.off('error', onError);
        clearTimeout(timeout);
      };

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        const reason = new Error(`SUBSCRIBE timed out for room ${roomId}`);
        this.emitError(reason);
        reject(reason);
      }, 10000);

      this.mqtt.on('error', onError);
      this.mqtt.subscribe(MQTT_TOPICS.events(roomId), { qos: 1 }, (err, granted) => {
        if (settled) return;
        settled = true;
        cleanup();

        if (err) {
          this.emitError(err);
          reject(err);
          return;
        }

        if (granted && granted.some((g) => g.qos === 128)) {
          const reason = new Error(`SUBSCRIBE rejected by broker: granted=${JSON.stringify(granted.map((g) => g.qos))}`);
          this.emitError(reason);
          reject(reason);
          return;
        }

        resolve();
      });
    });
  }

  unsubscribeRoom(roomId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.mqtt) return reject(new Error('not connected'));
      this.mqtt.unsubscribe(MQTT_TOPICS.events(roomId), (err) => {
        if (err) {
          this.emitError(err);
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /** 发送文本消息；QoS 1 PUBACK 后 resolve，发布失败（如 ACL 拒绝）时 reject */
  sendText(roomId: string, text: string, clientMessageId?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.mqtt) return reject(new Error('not connected'));
      let settled = false;

      const onError = (err: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        this.emitError(err);
        reject(err);
      };

      const cleanup = () => {
        this.mqtt?.off('error', onError);
        clearTimeout(timeout);
      };

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        const reason = new Error(`PUBLISH timed out for room ${roomId}`);
        this.emitError(reason);
        reject(reason);
      }, 10000);

      const payload: UplinkPayload = {
        from: this.options.participantId,
        content: { type: 'text', body: text },
        clientMessageId,
      };

      this.mqtt.on('error', onError);
      this.mqtt.publish(MQTT_TOPICS.uplink(roomId), JSON.stringify(payload), { qos: 1 }, (err) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (err) {
          this.emitError(err);
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async sendDirectMessage(participantId: string, text: string): Promise<void> {
    const { roomId } = await this.http.createDirectRoom({
      participantIds: [this.options.participantId, participantId],
    });
    await this.sendText(roomId, text);
  }
}

export { type ServerEvent };
