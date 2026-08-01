import { index, jsonb, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import type { RoomType } from '@logact-pub/opc-protocol';
import { departments } from './organization.js';
import { participants } from './participants.js';

export const rooms = pgTable(
  'rooms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 255 }).notNull(),
    creatorId: varchar('creator_id', { length: 255 })
      .notNull()
      .references(() => participants.id, { onDelete: 'restrict' }),
    type: varchar('type', { length: 16 }).notNull().$type<RoomType>(),
    departmentId: uuid('department_id').references(() => departments.id, {
      onDelete: 'restrict',
    }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('rooms_creator_idx').on(table.creatorId),
    index('rooms_department_idx').on(table.departmentId),
  ]
);

export type Room = typeof rooms.$inferSelect;
export type NewRoom = typeof rooms.$inferInsert;
