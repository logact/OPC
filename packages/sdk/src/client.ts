import WebSocket from 'ws';
import { API_ROUTES, type ClientFrame, type ServerFrame } from '@opc/protocol';
import type { ServerEvent } from '@opc/core';
import { EventBus } from './events.js';
import { OpcHttpClient } from './http.js';

export interface OpcClientOptions {
  baseUrl: string;
  token: string;
  /** 自动重连间隔，毫秒；设为 0 禁用 */
  reconnectInterval?: number;
}

/**
 * 通用客户端：任何 Participant 都使用这个类接入 server。
 * 连接后即可收发消息、订阅房间、接收事件。
 */
export class OpcClient {
  readonly http: OpcHttpClient;
  readonly events = new EventBus();
  private ws?: WebSocket;
  private reconnectTimer?: NodeJS.Timeout;

  constructor(private readonly options: OpcClientOptions) {
    this.http = new OpcHttpClient(options.baseUrl);
  }

  connect(): void {
    const wsUrl = this.options.baseUrl.replace(/^http/, 'ws') + API_ROUTES.ws;
    this.ws = new WebSocket(wsUrl);

    this.ws.on('open', () => {
      this.send({ type: 'auth', token: this.options.token });
    });

    this.ws.on('message', (data) => {
      const text = Array.isArray(data)
        ? Buffer.concat(data).toString('utf8')
        : Buffer.isBuffer(data)
          ? data.toString('utf8')
          : Buffer.from(data).toString('utf8');
      const frame = JSON.parse(text) as ServerFrame;
      this.handleFrame(frame);
    });

    this.ws.on('close', () => {
      if (this.options.reconnectInterval) {
        this.reconnectTimer = setTimeout(() => this.connect(), this.options.reconnectInterval);
      }
    });

    this.ws.on('error', (err) => {
      this.events.emit('error', err);
    });
  }

  disconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }

  subscribeRoom(roomId: string): void {
    this.send({ type: 'room.subscribe', roomId });
  }

  unsubscribeRoom(roomId: string): void {
    this.send({ type: 'room.unsubscribe', roomId });
  }

  sendText(roomId: string, text: string, clientMessageId?: string): void {
    this.send({
      type: 'message.send',
      roomId,
      content: { type: 'text', body: text },
      clientMessageId,
    });
  }

  private send(frame: ClientFrame): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('websocket not open');
    }
    this.ws.send(JSON.stringify(frame));
  }

  private handleFrame(frame: ServerFrame): void {
    switch (frame.type) {
      case 'event':
        this.events.emitEvent(frame.event);
        break;
      case 'authenticated':
        this.events.emit('authenticated', frame.participantId);
        break;
      case 'error':
        this.events.emit('protocol-error', frame);
        break;
      case 'pong':
        this.events.emit('pong', frame.ts);
        break;
    }
  }
}

export { type ServerEvent };
