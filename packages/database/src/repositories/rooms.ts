import { eq } from 'drizzle-orm';
import type { Room as CoreRoom } from '@logact-pub/opc-core';
import type { DbClient } from '../client/index.js';
import { roomMembers, rooms } from '../schema/index.js';

export interface RoomUpdatePatch {
  name?: string;
  metadata?: Record<string, unknown>;
}

export function createRoomRepository(db: DbClient) {
  return {
    async create(name: string, participantIds: string[]): Promise<CoreRoom> {
      return await db.transaction(async (tx) => {
        const [room] = await tx.insert(rooms).values({ name }).returning();

        if (participantIds.length > 0) {
          await tx
            .insert(roomMembers)
            .values(participantIds.map((participantId) => ({ roomId: room.id, participantId })))
            .onConflictDoNothing();
        }

        return {
          id: room.id,
          name: room.name,
          participantIds,
          createdAt: room.createdAt.toISOString(),
          metadata: room.metadata ?? undefined,
        };
      });
    },

    async findById(id: string): Promise<CoreRoom | undefined> {
      const room = await db.query.rooms.findFirst({
        where: eq(rooms.id, id),
      });
      if (!room) return undefined;

      const members = await db
        .select({ participantId: roomMembers.participantId })
        .from(roomMembers)
        .where(eq(roomMembers.roomId, id));

      return {
        id: room.id,
        name: room.name,
        participantIds: members.map((m) => m.participantId),
        createdAt: room.createdAt.toISOString(),
        metadata: room.metadata ?? undefined,
      };
    },

    async update(id: string, patch: RoomUpdatePatch): Promise<CoreRoom | undefined> {
      const [room] = await db
        .update(rooms)
        .set({
          ...(patch.name !== undefined && { name: patch.name }),
          ...(patch.metadata !== undefined && { metadata: patch.metadata }),
        })
        .where(eq(rooms.id, id))
        .returning();

      if (!room) return undefined;

      const members = await db
        .select({ participantId: roomMembers.participantId })
        .from(roomMembers)
        .where(eq(roomMembers.roomId, id));

      return {
        id: room.id,
        name: room.name,
        participantIds: members.map((m) => m.participantId),
        createdAt: room.createdAt.toISOString(),
        metadata: room.metadata ?? undefined,
      };
    },

    async list(): Promise<{ id: string; name: string }[]> {
      return await db.select({ id: rooms.id, name: rooms.name }).from(rooms);
    },
  };
}

export type RoomRepository = ReturnType<typeof createRoomRepository>;
