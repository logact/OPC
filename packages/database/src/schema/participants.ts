import { pgTable, uuid, varchar, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { participantKind } from './constants.js';

export const participants = pgTable('participants', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: varchar('kind', { length: 16 }).notNull().$type<keyof typeof participantKind>(),
  name: varchar('name', { length: 255 }).notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Participant = typeof participants.$inferSelect;
export type NewParticipant = typeof participants.$inferInsert;
