import { eq } from 'drizzle-orm';
import type { Room as CoreRoom } from '@opc/core';
import type { DbClient } from '../client/index.js';
import { roomMembers, rooms } from '../schema/index.js';

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
      };
    },

    async list(): Promise<{ id: string; name: string }[]> {
      return await db.select({ id: rooms.id, name: rooms.name }).from(rooms);
    },
  };
}

export type RoomRepository = ReturnType<typeof createRoomRepository>;
