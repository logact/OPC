import type {
  PresencePayload,
  ServerEvent,
  UplinkPayload,
} from '@logact-pub/opc-protocol';

export type {
  Message,
  MessageContent,
  MessageDeliveredEvent,
  ParticipantJoinedEvent,
  ParticipantLeftEvent,
  ReadUpdatedEvent,
  RoomUpdatedEvent,
  ServerEvent,
  UplinkPayload,
} from '@logact-pub/opc-protocol';

export type MqttConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface OpcMqttClientOptions {
  brokerUrl: string;
  participantId: string;
  token: string;
  clientId: string;
}

export interface OpcMqttClient {
  readonly state: MqttConnectionState;
  readonly error: Error | null;
  connect(): void;
  disconnect(): void;
  /**
   * Reconciles room-event subscriptions in one batch. Rooms absent from the
   * next set are unsubscribed; newly joined rooms are added immediately.
   */
  subscribeRooms(roomIds: Iterable<string>): void;
  subscribeRoom(roomId: string): void;
  unsubscribeRoom(roomId: string): void;
  sendUplink(roomId: string, payload: UplinkPayload): void;
  /**
   * 上报已读回执（issue #108）：PUBLISH RoomReadsPayload 到
   * opc/participants/{participantId}/rooms/{roomId}/reads；lastReadAt 为 server 打的消息时间戳。
   */
  publishReadReceipt(roomId: string, participantId: string, lastReadAt: string): void;
  /**
   * 订阅所有 participant 的在线状态变化（opc/participants/+/presence）。
   * 返回取消订阅函数；最后一个 listener 移除后自动退订。
   */
  subscribePresence(listener: (participantId: string, presence: PresencePayload) => void): () => void;
  onEvent(listener: (event: ServerEvent) => void): () => void;
  onStateChange(listener: (state: MqttConnectionState) => void): () => void;
  onError(listener: (error: Error) => void): () => void;
}
