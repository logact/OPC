import type { Message } from './message.js';
import type { Participant } from './participant.js';
import type { Room } from './room.js';

export type ServerEvent =
  | MessageDeliveredEvent
  | ParticipantJoinedEvent
  | ParticipantLeftEvent
  | RoomUpdatedEvent;

export interface MessageDeliveredEvent {
  type: 'message.delivered';
  message: Message;
}

export interface ParticipantJoinedEvent {
  type: 'participant.joined';
  roomId: string;
  participant: Participant;
}

export interface ParticipantLeftEvent {
  type: 'participant.left';
  roomId: string;
  participantId: string;
}

export interface RoomUpdatedEvent {
  type: 'room.updated';
  room: Room;
}
