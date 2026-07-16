import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Room as CoreRoom } from '@logact-pub/opc-protocol';
import type { DbClient } from '../client/index.js';
import { roomMembers, rooms } from '../schema/index.js';
import { isValidUuid } from '../utils/uuid.js';

export interface RoomUpdatePatch {
  name?: string;
  metadata?: Record<string, unknown>;
}

export function createRoomRepository(db: DbClient) {
  return {
    async create(
      name: string,
      participantIds: string[],
      metadata?: Record<string, unknown>
    ): Promise<CoreRoom> {
      return await db.transaction(async (tx) => {
        const [room] = await tx.insert(rooms).values({ name, metadata }).returning();

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
      if (!isValidUuid(id)) return undefined;
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
      if (!isValidUuid(id)) return undefined;
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

    async list(): Promise<CoreRoom[]> {
      const roomRows = await db.select().from(rooms).orderBy(asc(rooms.createdAt));
      const allMembers = await db.select().from(roomMembers);
      const membersByRoom = new Map<string, string[]>();
      for (const m of allMembers) {
        const list = membersByRoom.get(m.roomId) ?? [];
        list.push(m.participantId);
        membersByRoom.set(m.roomId, list);
      }
      return roomRows.map((room) => ({
        id: room.id,
        name: room.name,
        participantIds: membersByRoom.get(room.id) ?? [],
        createdAt: room.createdAt.toISOString(),
        metadata: room.metadata ?? undefined,
      }));
    },

    async addMembers(roomId: string, participantIds: string[]): Promise<CoreRoom | undefined> {
      const room = await this.findById(roomId);
      if (!room) return undefined;
      if (participantIds.length === 0) return room;

      await db.transaction(async (tx) => {
        await tx
          .insert(roomMembers)
          .values(participantIds.map((participantId) => ({ roomId, participantId })))
          .onConflictDoNothing();
      });

      return this.findById(roomId);
    },

    async findDirectRoom(a: string, b: string): Promise<CoreRoom | undefined> {
      const candidates = await db
        .select({ roomId: roomMembers.roomId })
        .from(roomMembers)
        .innerJoin(rooms, eq(rooms.id, roomMembers.roomId))
        .where(
          and(
            sql`${rooms.metadata} ->> 'type' = 'direct'`,
            inArray(roomMembers.participantId, [a, b])
          )
        )
        .groupBy(roomMembers.roomId)
        .having(sql`count(distinct ${roomMembers.participantId}) = 2`);

      for (const { roomId } of candidates) {
        const room = await this.findById(roomId);
        if (
          room &&
          room.participantIds.length === 2 &&
          room.participantIds.includes(a) &&
          room.participantIds.includes(b)
        ) {
          return room;
        }
      }
      return undefined;
    },
  };
}

export type RoomRepository = ReturnType<typeof createRoomRepository>;
