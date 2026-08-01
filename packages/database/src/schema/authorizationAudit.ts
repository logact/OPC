import {
  index,
  jsonb,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type {
  AuthorizationChannel,
  AuthorizationOutcome,
  AuthorizationResourceType,
  CapabilityName,
} from '@logact-pub/opc-protocol';

/** Append-only record of authorization decisions for sensitive allows and all denials. */
export const authorizationAudit = pgTable(
  'authorization_audit',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: varchar('actor_id', { length: 255 }),
    claimedActorId: varchar('claimed_actor_id', { length: 255 }),
    channel: varchar('channel', { length: 16 }).notNull().$type<AuthorizationChannel>(),
    action: varchar('action', { length: 64 }).notNull().$type<CapabilityName>(),
    resourceType: varchar('resource_type', { length: 32 })
      .notNull()
      .$type<AuthorizationResourceType>(),
    resourceId: varchar('resource_id', { length: 255 }).notNull(),
    departmentId: varchar('department_id', { length: 255 }),
    outcome: varchar('outcome', { length: 16 }).notNull().$type<AuthorizationOutcome>(),
    reason: varchar('reason', { length: 255 }).notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('authorization_audit_actor_idx').on(table.actorId, table.createdAt),
    index('authorization_audit_outcome_idx').on(table.outcome, table.createdAt),
    index('authorization_audit_resource_idx').on(table.resourceType, table.resourceId),
  ]
);

export type AuthorizationAuditRow = typeof authorizationAudit.$inferSelect;
export type NewAuthorizationAuditRow = typeof authorizationAudit.$inferInsert;
