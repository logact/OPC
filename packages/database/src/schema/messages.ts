import { pgTable, uuid, varchar, timestamp, jsonb, text, index } from 'drizzle-orm/pg-core';
import { rooms } from './rooms.js';
import { participants } from './participants.js';

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    fromParticipantId: uuid('from_participant_id')
      .notNull()
      .references(() => participants.id, { onDelete: 'cascade' }),
    contentType: varchar('content_type', { length: 32 }).notNull(),
    contentBody: text('content_body').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('messages_room_id_idx').on(table.roomId)]
);

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
