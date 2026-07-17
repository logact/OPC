export interface Participant {
  id: string;
  name: string | null;
  kind: 'human' | 'agent';
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface Room {
  id: string;
  name: string;
  participantIds: string[];
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface MessageContent {
  type: 'text' | 'markdown' | 'json' | 'system';
  body: string;
}

export interface Message {
  id: string;
  roomId: string;
  from: string;
  content: MessageContent;
  clientMessageId?: string;
  createdAt: string;
}

export interface RegisterParticipantRequest {
  id: string;
  name?: string;
}

export interface RegisterParticipantResponse {
  participantId: string;
  token: string;
}

export interface GetParticipantResponse {
  participant: Participant;
}

export interface UpdateParticipantRequest {
  name?: string;
  kind?: Participant['kind'];
  metadata?: Record<string, unknown>;
}

export interface UpdateParticipantResponse {
  participant: Participant;
}

export interface CreateRoomRequest {
  name: string;
  participantIds?: string[];
}

export interface CreateRoomResponse {
  roomId: string;
}

export interface ListRoomsResponse {
  rooms: { id: string; name: string }[];
}

export interface GetRoomResponse {
  room: Room;
}

export interface UpdateRoomRequest {
  name?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateRoomResponse {
  room: Room;
}

export interface RoomHistoryResponse {
  messages: Message[];
}

export interface GetMessageResponse {
  message: Message;
}
