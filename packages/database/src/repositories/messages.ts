import { eq, desc } from 'drizzle-orm';
import type { Message as CoreMessage } from '@logact-pub/opc-core';
import type { DbClient } from '../client/index.js';
import { messages } from '../schema/index.js';

export function createMessageRepository(db: DbClient) {
  return {
    async insert(roomId: string, message: CoreMessage): Promise<void> {
      await db.insert(messages).values({
        id: message.id,
        roomId,
        fromParticipantId: message.from,
        contentType: message.content.type,
        contentBody: message.content.body,
        metadata: message.metadata,
        timestamp: new Date(message.timestamp),
      });
    },

    async findById(id: string): Promise<CoreMessage | undefined> {
      const row = await db.query.messages.findFirst({
        where: eq(messages.id, id),
      });
      if (!row) return undefined;
      return {
        id: row.id,
        roomId: row.roomId,
        from: row.fromParticipantId,
        content: { type: row.contentType as CoreMessage['content']['type'], body: row.contentBody },
        timestamp: row.timestamp.toISOString(),
        metadata: row.metadata ?? undefined,
      };
    },

    async findByRoomId(roomId: string): Promise<CoreMessage[]> {
      const rows = await db
        .select()
        .from(messages)
        .where(eq(messages.roomId, roomId))
        .orderBy(desc(messages.timestamp));

      return rows.map((m) => ({
        id: m.id,
        roomId: m.roomId,
        from: m.fromParticipantId,
        content: { type: m.contentType as CoreMessage['content']['type'], body: m.contentBody },
        timestamp: m.timestamp.toISOString(),
        metadata: m.metadata ?? undefined,
      }));
    },
  };
}

export type MessageRepository = ReturnType<typeof createMessageRepository>;
