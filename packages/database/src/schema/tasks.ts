import { sql } from 'drizzle-orm';
import {
  AnyPgColumn,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type {
  TaskEventKind,
  TaskStatus,
  TaskTarget,
} from '@logact-pub/opc-protocol';
import { departments } from './organization.js';
import { participants } from './participants.js';
import { rooms } from './rooms.js';

const taskStatusCheck = sql`status in ('draft', 'assigned', 'in_progress', 'blocked', 'review', 'completed', 'failed', 'cancelled')`;

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description').notNull().default(''),
    departmentId: uuid('department_id')
      .notNull()
      .references(() => departments.id, { onDelete: 'restrict' }),
    creatorId: varchar('creator_id', { length: 255 })
      .notNull()
      .references(() => participants.id, { onDelete: 'restrict' }),
    target: jsonb('target').$type<TaskTarget>(),
    requiredSkillTags: jsonb('required_skill_tags').$type<string[]>().notNull().default([]),
    status: varchar('status', { length: 32 }).notNull().$type<TaskStatus>().default('draft'),
    assigneeId: varchar('assignee_id', { length: 255 }).references(() => participants.id, {
      onDelete: 'restrict',
    }),
    collaboratorIds: jsonb('collaborator_ids').$type<string[]>().notNull().default([]),
    reviewerId: varchar('reviewer_id', { length: 255 }).references(() => participants.id, {
      onDelete: 'restrict',
    }),
    roomId: uuid('room_id').references(() => rooms.id, { onDelete: 'restrict' }),
    latestResultId: uuid('latest_result_id').references(
      (): AnyPgColumn => taskResults.id,
      { onDelete: 'set null' }
    ),
    version: integer('version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    assignedAt: timestamp('assigned_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    check('tasks_status_check', taskStatusCheck),
    index('tasks_department_idx').on(table.departmentId),
    index('tasks_creator_idx').on(table.creatorId),
    index('tasks_assignee_idx').on(table.assigneeId),
    index('tasks_reviewer_idx').on(table.reviewerId),
    index('tasks_status_updated_idx').on(table.status, table.updatedAt, table.id),
    uniqueIndex('tasks_room_unique_idx').on(table.roomId).where(sql`${table.roomId} is not null`),
  ]
);

export const taskAssignments = pgTable(
  'task_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    assigneeId: varchar('assignee_id', { length: 255 })
      .notNull()
      .references(() => participants.id, { onDelete: 'restrict' }),
    collaboratorIds: jsonb('collaborator_ids').$type<string[]>().notNull().default([]),
    reviewerId: varchar('reviewer_id', { length: 255 })
      .notNull()
      .references(() => participants.id, { onDelete: 'restrict' }),
    confirmedBy: varchar('confirmed_by', { length: 255 })
      .notNull()
      .references(() => participants.id, { onDelete: 'restrict' }),
    idempotencyKey: varchar('idempotency_key', { length: 200 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    supersededReason: text('superseded_reason'),
  },
  (table) => [
    index('task_assignments_task_idx').on(table.taskId, table.createdAt, table.id),
    index('task_assignments_assignee_idx').on(table.assigneeId),
    uniqueIndex('task_assignments_current_unique_idx')
      .on(table.taskId)
      .where(sql`${table.supersededAt} is null`),
  ]
);

export const taskResults = pgTable(
  'task_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    submittedBy: varchar('submitted_by', { length: 255 })
      .notNull()
      .references(() => participants.id, { onDelete: 'restrict' }),
    summary: text('summary').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('task_results_task_idx').on(table.taskId, table.createdAt, table.id)]
);

export const taskTransitions = pgTable(
  'task_transitions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    from: varchar('from_status', { length: 32 }).$type<TaskStatus>(),
    to: varchar('to_status', { length: 32 }).notNull().$type<TaskStatus>(),
    actorId: varchar('actor_id', { length: 255 })
      .notNull()
      .references(() => participants.id, { onDelete: 'restrict' }),
    reason: text('reason'),
    details: jsonb('details').$type<Record<string, unknown>>(),
    idempotencyKey: varchar('idempotency_key', { length: 200 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('task_transitions_task_idx').on(table.taskId, table.createdAt, table.id),
    uniqueIndex('task_transitions_command_unique_idx').on(
      table.taskId,
      table.idempotencyKey,
      table.to
    ),
  ]
);

export const taskEvents = pgTable(
  'task_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 32 }).notNull().$type<TaskEventKind>(),
    actorId: varchar('actor_id', { length: 255 })
      .notNull()
      .references(() => participants.id, { onDelete: 'restrict' }),
    message: text('message').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('task_events_task_idx').on(table.taskId, table.createdAt, table.id)]
);

export const taskCommandReceipts = pgTable(
  'task_command_receipts',
  {
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    idempotencyKey: varchar('idempotency_key', { length: 200 }).notNull(),
    command: varchar('command', { length: 32 }).notNull(),
    requestHash: varchar('request_hash', { length: 64 }).notNull(),
    response: jsonb('response').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.taskId, table.idempotencyKey] })]
);

export type TaskRow = typeof tasks.$inferSelect;
export type TaskAssignmentRow = typeof taskAssignments.$inferSelect;
export type TaskResultRow = typeof taskResults.$inferSelect;
export type TaskTransitionRow = typeof taskTransitions.$inferSelect;
export type TaskEventRow = typeof taskEvents.$inferSelect;
export type TaskCommandReceiptRow = typeof taskCommandReceipts.$inferSelect;
