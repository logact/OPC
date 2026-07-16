import { pgTable, varchar, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { participantKind } from './constants.js';

export const participants = pgTable('participants', {
  // participant id 由接入方提供，不能用自增 uuid
  id: varchar('id', { length: 255 }).primaryKey(),
  kind: varchar('kind', { length: 16 }).notNull().$type<keyof typeof participantKind>(),
  name: varchar('name', { length: 255 }).notNull(),
  /** MQTT 登录 token 的 SHA-256 哈希；为空表示该参与者不可登录（如内部 ensure 创建） */
  tokenHash: varchar('token_hash', { length: 64 }),
  /** 独立登录密码的 scrypt 哈希（salt:hash）；为空表示未设置密码 */
  passwordHash: varchar('password_hash', { length: 255 }),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Participant = typeof participants.$inferSelect;
export type NewParticipant = typeof participants.$inferInsert;
