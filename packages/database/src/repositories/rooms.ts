import { and, asc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type {
  Message as CoreMessage,
  Room as CoreRoom,
  RoomWithState,
} from '@logact-pub/opc-protocol';
import type { DbClient } from '../client/index.js';
import { roomMembers, rooms } from '../schema/index.js';
import { isValidUuid } from '../utils/uuid.js';

export interface RoomUpdatePatch {
  name?: string;
  departmentId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface CreateRoomInput {
  name: string;
  participantIds: string[];
  creatorId: string;
  type: CoreRoom['type'];
  departmentId?: string | null;
  metadata?: Record<string, unknown>;
}

function toCoreRoom(
  room: typeof rooms.$inferSelect,
  participantIds: string[]
): CoreRoom {
  return {
    id: room.id,
    name: room.name,
    participantIds,
    creatorId: room.creatorId,
    type: room.type,
    departmentId: room.departmentId,
    createdAt: room.createdAt.toISOString(),
    metadata: room.metadata ?? undefined,
  };
}

interface ParticipantRoomStateRow {
  [key: string]: unknown;
  id: string;
  name: string;
  creatorId: string;
  type: CoreRoom['type'];
  departmentId: string | null;
  createdAt: Date | string;
  metadata: Record<string, unknown> | null;
  participantIds: string[];
  unreadCount: number;
  lastMessage: CoreMessage | null;
}

function toRoomWithState(row: ParticipantRoomStateRow): RoomWithState {
  const lastMessage = row.lastMessage
    ? { ...row.lastMessage, timestamp: new Date(row.lastMessage.timestamp).toISOString() }
    : null;
  return {
    id: row.id,
    name: row.name,
    participantIds: row.participantIds,
    creatorId: row.creatorId,
    type: row.type,
    departmentId: row.departmentId,
    createdAt:
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : new Date(row.createdAt).toISOString(),
    metadata: row.metadata ?? undefined,
    unreadCount: row.unreadCount,
    lastMessage,
  };
}

export function createRoomRepository(db: DbClient) {
  return {
    async create(input: CreateRoomInput): Promise<CoreRoom> {
      return await db.transaction(async (tx) => {
        const [room] = await tx
          .insert(rooms)
          .values({
            name: input.name,
            creatorId: input.creatorId,
            type: input.type,
            departmentId: input.departmentId ?? null,
            metadata: input.metadata,
          })
          .returning();

        if (input.participantIds.length > 0) {
          await tx
            .insert(roomMembers)
            .values(
              input.participantIds.map((participantId) => ({ roomId: room.id, participantId }))
            )
            .onConflictDoNothing();
        }

        return toCoreRoom(room, input.participantIds);
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

      return toCoreRoom(room, members.map((m) => m.participantId));
    },

    async update(id: string, patch: RoomUpdatePatch): Promise<CoreRoom | undefined> {
      if (!isValidUuid(id)) return undefined;
      const [room] = await db
        .update(rooms)
        .set({
          ...(patch.name !== undefined && { name: patch.name }),
          ...(patch.departmentId !== undefined && { departmentId: patch.departmentId }),
          ...(patch.metadata !== undefined && { metadata: patch.metadata }),
        })
        .where(eq(rooms.id, id))
        .returning();

      if (!room) return undefined;

      const members = await db
        .select({ participantId: roomMembers.participantId })
        .from(roomMembers)
        .where(eq(roomMembers.roomId, id));

      return toCoreRoom(room, members.map((m) => m.participantId));
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
      return roomRows.map((room) => toCoreRoom(room, membersByRoom.get(room.id) ?? []));
    },

    async listByParticipantId(participantId: string): Promise<CoreRoom[]> {
      const memberships = await db
        .select({ roomId: roomMembers.roomId })
        .from(roomMembers)
        .where(eq(roomMembers.participantId, participantId));

      const result: CoreRoom[] = [];
      for (const { roomId } of memberships) {
        const room = await this.findById(roomId);
        if (room) result.push(room);
      }
      return result;
    },

    /**
     * Membership-scoped conversation list state (issue #96).
     *
     * This is intentionally one SQL statement: it starts at the requesting
     * member row (and its read cursor), then derives both the unread count and
     * latest message with correlated room-local aggregates. Calculating this
     * server-side keeps badges correct after reconnects and on another device.
     */
    async listWithStateByParticipantId(participantId: string): Promise<RoomWithState[]> {
      const result = await db.execute<ParticipantRoomStateRow>(sql`
        SELECT
          ${rooms.id} AS "id",
          ${rooms.name} AS "name",
          ${rooms.creatorId} AS "creatorId",
          ${rooms.type} AS "type",
          ${rooms.departmentId} AS "departmentId",
          ${rooms.createdAt} AS "createdAt",
          ${rooms.metadata} AS "metadata",
          ARRAY(
            SELECT ${roomMembers.participantId}
            FROM ${roomMembers}
            WHERE ${roomMembers.roomId} = ${rooms.id}
            ORDER BY ${roomMembers.joinedAt}, ${roomMembers.participantId}
          ) AS "participantIds",
          (
            SELECT count(*)::integer
            FROM messages AS unread_message
            WHERE unread_message.room_id = ${rooms.id}
              AND unread_message.from_participant_id <> ${participantId}
              AND (
                ${roomMembers.lastReadAt} IS NULL
                OR unread_message.timestamp > ${roomMembers.lastReadAt}
              )
          ) AS "unreadCount",
          (
            SELECT jsonb_strip_nulls(
              jsonb_build_object(
                'id', latest_message.id,
                'roomId', latest_message.room_id,
                'from', latest_message.from_participant_id,
                'content', jsonb_build_object(
                  'type', latest_message.content_type,
                  'body', latest_message.content_body
                ),
                'timestamp', latest_message.timestamp,
                'metadata', latest_message.metadata,
                'intent', latest_message.intent
              )
            )
            FROM messages AS latest_message
            WHERE latest_message.room_id = ${rooms.id}
            ORDER BY latest_message.timestamp DESC, latest_message.id DESC
            LIMIT 1
          ) AS "lastMessage"
        FROM ${roomMembers}
        INNER JOIN ${rooms} ON ${rooms.id} = ${roomMembers.roomId}
        WHERE ${roomMembers.participantId} = ${participantId}
        ORDER BY ${rooms.createdAt} ASC
      `);
      return result.rows.map(toRoomWithState);
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

    async removeMember(roomId: string, participantId: string): Promise<CoreRoom | undefined> {
      const room = await this.findById(roomId);
      if (!room) return undefined;
      await db
        .delete(roomMembers)
        .where(
          and(
            eq(roomMembers.roomId, roomId),
            eq(roomMembers.participantId, participantId)
          )
        );
      return this.findById(roomId);
    },

    async findDirectRoom(a: string, b: string): Promise<CoreRoom | undefined> {
      const candidates = await db
        .select({ roomId: roomMembers.roomId })
        .from(roomMembers)
        .innerJoin(rooms, eq(rooms.id, roomMembers.roomId))
        .where(
          and(
            eq(rooms.type, 'direct'),
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

    /**
     * 推进房间内某成员的已读游标（issue #108）。单调、幂等：仅当游标为
     * NULL 或新时间戳更晚时才更新；返回是否真正推进（供调用方决定是否广播）。
     */
    async setLastReadAt(roomId: string, participantId: string, ts: Date): Promise<boolean> {
      if (!isValidUuid(roomId)) return false;
      const updated = await db
        .update(roomMembers)
        .set({ lastReadAt: ts })
        .where(
          and(
            eq(roomMembers.roomId, roomId),
            eq(roomMembers.participantId, participantId),
            or(isNull(roomMembers.lastReadAt), lt(roomMembers.lastReadAt, ts))
          )
        )
        .returning({ participantId: roomMembers.participantId });
      return updated.length > 0;
    },

    /** 房间内全部成员的已读游标（issue #108），从未读过的成员 lastReadAt 为 null */
    async getReadState(
      roomId: string
    ): Promise<Array<{ participantId: string; lastReadAt: string | null }>> {
      if (!isValidUuid(roomId)) return [];
      const rows = await db
        .select({
          participantId: roomMembers.participantId,
          lastReadAt: roomMembers.lastReadAt,
        })
        .from(roomMembers)
        .where(eq(roomMembers.roomId, roomId));
      return rows.map((row) => ({
        participantId: row.participantId,
        lastReadAt: row.lastReadAt ? row.lastReadAt.toISOString() : null,
      }));
    },
  };
}

export type RoomRepository = ReturnType<typeof createRoomRepository>;
