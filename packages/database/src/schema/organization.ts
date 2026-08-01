import { sql } from 'drizzle-orm';
import {
  AnyPgColumn,
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type { CapabilityGrant, Responsibility } from '@logact-pub/opc-protocol';
import { participants } from './participants.js';

export const DEFAULT_ORGANIZATION_ID = 'default';

export const organizations = pgTable('organizations', {
  id: varchar('id', { length: 64 }).primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const departments = pgTable(
  'departments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 64 })
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    name: varchar('name', { length: 255 }).notNull(),
    parentId: uuid('parent_id').references((): AnyPgColumn => departments.id, {
      onDelete: 'restrict',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('departments_organization_idx').on(table.organizationId),
    index('departments_parent_idx').on(table.parentId),
  ]
);

export const positions = pgTable(
  'positions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    departmentId: uuid('department_id')
      .notNull()
      .references(() => departments.id, { onDelete: 'restrict' }),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    responsibilities: jsonb('responsibilities')
      .$type<Responsibility[]>()
      .notNull()
      .default([]),
    skillTags: jsonb('skill_tags').$type<string[]>().notNull().default([]),
    capabilityGrants: jsonb('capability_grants')
      .$type<CapabilityGrant[]>()
      .notNull()
      .default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('positions_department_idx').on(table.departmentId)]
);

export const staffProfiles = pgTable(
  'staff_profiles',
  {
    participantId: varchar('participant_id', { length: 255 })
      .primaryKey()
      .references(() => participants.id, { onDelete: 'cascade' }),
    organizationId: varchar('organization_id', { length: 64 })
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    isOwner: boolean('is_owner').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('staff_profiles_single_owner_idx')
      .on(table.isOwner)
      .where(sql`${table.isOwner} = true`),
  ]
);

export const staffAssignments = pgTable(
  'staff_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    staffParticipantId: varchar('staff_participant_id', { length: 255 })
      .notNull()
      .references(() => staffProfiles.participantId, { onDelete: 'cascade' }),
    positionId: uuid('position_id')
      .notNull()
      .references(() => positions.id, { onDelete: 'restrict' }),
    active: boolean('active').notNull().default(true),
    isDepartmentLeader: boolean('is_department_leader').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('staff_assignments_staff_idx').on(table.staffParticipantId),
    index('staff_assignments_position_idx').on(table.positionId),
    uniqueIndex('staff_assignments_active_unique_idx')
      .on(table.staffParticipantId, table.positionId)
      .where(sql`${table.active} = true`),
  ]
);

export type OrganizationRow = typeof organizations.$inferSelect;
export type DepartmentRow = typeof departments.$inferSelect;
export type PositionRow = typeof positions.$inferSelect;
export type StaffProfileRow = typeof staffProfiles.$inferSelect;
export type StaffAssignmentRow = typeof staffAssignments.$inferSelect;
