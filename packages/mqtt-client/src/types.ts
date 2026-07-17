export interface MessageContent {
  type: 'text' | 'markdown' | 'json' | 'system';
  body: string;
}

export interface UplinkPayload {
  from: string;
  content: MessageContent;
  clientMessageId?: string;
}

export interface Message {
  id: string;
  roomId: string;
  from: string;
  content: MessageContent;
  clientMessageId?: string;
  createdAt: string;
}

export interface MessageDeliveredEvent {
  type: 'message.delivered';
  message: Message;
}

export interface ParticipantJoinedEvent {
  type: 'participant.joined';
  roomId: string;
  participant: {
    id: string;
    name: string | null;
    kind: 'human' | 'agent';
  };
}

export interface ParticipantLeftEvent {
  type: 'participant.left';
  roomId: string;
  participantId: string;
}

export interface RoomUpdatedEvent {
  type: 'room.updated';
  room: {
    id: string;
    name: string;
    participantIds: string[];
  };
}

export type ServerEvent =
  | MessageDeliveredEvent
  | ParticipantJoinedEvent
  | ParticipantLeftEvent
  | RoomUpdatedEvent;

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
  subscribeRoom(roomId: string): void;
  unsubscribeRoom(roomId: string): void;
  sendUplink(roomId: string, payload: UplinkPayload): void;
  onEvent(listener: (event: ServerEvent) => void): () => void;
  onStateChange(listener: (state: MqttConnectionState) => void): () => void;
  onError(listener: (error: Error) => void): () => void;
}
