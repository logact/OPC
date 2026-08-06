import { pgTable, uuid, varchar, timestamp, primaryKey } from 'drizzle-orm/pg-core';
import { rooms } from './rooms.js';
import { participants } from './participants.js';

export const roomMembers = pgTable(
  'room_members',
  {
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    participantId: varchar('participant_id', { length: 255 })
      .notNull()
      .references(() => participants.id, { onDelete: 'cascade' }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    /** 已读游标（issue #108）：server 打的消息时间戳，null 表示从未读过 */
    lastReadAt: timestamp('last_read_at', { withTimezone: true }),
  },
  (table) => [primaryKey({ columns: [table.roomId, table.participantId] })]
);

export type RoomMember = typeof roomMembers.$inferSelect;
export type NewRoomMember = typeof roomMembers.$inferInsert;
