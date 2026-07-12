import type { Participant } from './participant.js';

export interface Room {
  id: string;
  name: string;
  participantIds: string[];
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface RoomMembership {
  roomId: string;
  participant: Participant;
  joinedAt: string;
}
