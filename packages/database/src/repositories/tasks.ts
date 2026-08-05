import { createHash } from 'node:crypto';
import {
  and,
  asc,
  desc,
  eq,
  lt,
  sql,
  type SQL,
} from 'drizzle-orm';
import type {
  AppendTaskEventRequest,
  AppendTaskEventResponse,
  AssignTaskRequest,
  BlockTaskRequest,
  CancelTaskRequest,
  CreateTaskRequest,
  CreateTaskResponse,
  FailTaskRequest,
  GetTaskResponse,
  ListTasksQuery,
  ListTasksResponse,
  Message,
  ResumeTaskRequest,
  SubmitTaskRequest,
  Task,
  TaskAssignment,
  TaskErrorCode,
  TaskEvent,
  TaskEventKind,
  TaskMutationResponse,
  TaskResult,
  TaskStatus,
  TaskTransition,
  UpdateTaskRequest,
} from '@logact-pub/opc-protocol';
import type { DbClient } from '../client/index.js';
import {
  messages,
  roomMembers,
  rooms,
  taskAssignments,
  taskCommandReceipts,
  taskEvents,
  taskResults,
  taskTransitions,
  tasks,
  type TaskAssignmentRow,
  type TaskEventRow,
  type TaskResultRow,
  type TaskRow,
  type TaskTransitionRow,
} from '../schema/index.js';
import { isValidUuid } from '../utils/uuid.js';

export class TaskRepositoryError extends Error {
  constructor(
    readonly code: TaskErrorCode,
    readonly status: 404 | 409 | 422,
    message: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'TaskRepositoryError';
  }
}

function notFound(taskId: string): TaskRepositoryError {
  return new TaskRepositoryError('task_not_found', 404, `task ${taskId} not found`);
}

function conflict(
  code: Extract<
    TaskErrorCode,
    | 'task_not_draft'
    | 'invalid_task_transition'
    | 'task_idempotency_conflict'
    | 'task_concurrent_update'
  >,
  message: string,
  details?: Record<string, unknown>
): TaskRepositoryError {
  return new TaskRepositoryError(code, 409, message, details);
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
    .join(',')}}`;
}

function requestHash(command: string, request: unknown): string {
  return createHash('sha256').update(stableJson({ command, request })).digest('hex');
}

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    creatorId: row.creatorId,
    status: row.status,
    assigneeId: row.assigneeId,
    roomId: row.roomId,
    latestResultId: row.latestResultId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    assignedAt: row.assignedAt?.toISOString() ?? null,
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

function toAssignment(row: TaskAssignmentRow): TaskAssignment {
  return {
    id: row.id,
    taskId: row.taskId,
    assigneeId: row.assigneeId,
    confirmedBy: row.confirmedBy,
    idempotencyKey: row.idempotencyKey,
    createdAt: row.createdAt.toISOString(),
    supersededAt: row.supersededAt?.toISOString() ?? null,
    supersededReason: row.supersededReason,
  };
}

function toResult(row: TaskResultRow): TaskResult {
  return {
    id: row.id,
    taskId: row.taskId,
    submittedBy: row.submittedBy,
    summary: row.summary,
    metadata: row.metadata ?? undefined,
    createdAt: row.createdAt.toISOString(),
  };
}

function toTransition(row: TaskTransitionRow): TaskTransition {
  return {
    id: row.id,
    taskId: row.taskId,
    from: row.from,
    to: row.to,
    actorId: row.actorId,
    reason: row.reason,
    details: row.details ?? undefined,
    idempotencyKey: row.idempotencyKey,
    createdAt: row.createdAt.toISOString(),
  };
}

function toEvent(row: TaskEventRow): TaskEvent {
  return {
    id: row.id,
    taskId: row.taskId,
    kind: row.kind,
    actorId: row.actorId,
    message: row.message,
    metadata: row.metadata ?? undefined,
    createdAt: row.createdAt.toISOString(),
  };
}

type DbTransaction = Parameters<Parameters<DbClient['transaction']>[0]>[0];

interface CommandOutcome<T extends Record<string, unknown>> {
  response: T;
  event?: TaskEvent;
  message?: Message;
  replayed: boolean;
}

interface OperationResult<T extends Record<string, unknown>> {
  response: T;
  event?: TaskEvent;
  message?: Message;
}

/**
 * issue #130：生命周期 draft → assigned → in_progress (⇄ blocked) →
 * completed | failed | cancelled。submit 直接进入 completed（不再有 review）；
 * fail 可从 assigned/in_progress/blocked 发起；cancel 可从任意非终态发起；
 * assign（含 reassign）从 draft/assigned/in_progress/blocked 重置回 assigned。
 */
type TransitionRequest =
  | { command: 'start'; payload: { idempotencyKey: string } }
  | { command: 'block'; payload: BlockTaskRequest }
  | { command: 'resume'; payload: ResumeTaskRequest }
  | { command: 'submit'; payload: SubmitTaskRequest }
  | { command: 'fail'; payload: FailTaskRequest }
  | { command: 'cancel'; payload: CancelTaskRequest };

const transitionRules: Record<TransitionRequest['command'], TaskStatus[]> = {
  start: ['assigned'],
  block: ['in_progress'],
  resume: ['blocked'],
  submit: ['in_progress'],
  fail: ['assigned', 'in_progress', 'blocked'],
  cancel: ['draft', 'assigned', 'in_progress', 'blocked'],
};

const transitionTargets: Record<TransitionRequest['command'], TaskStatus> = {
  start: 'in_progress',
  block: 'blocked',
  resume: 'in_progress',
  submit: 'completed',
  fail: 'failed',
  cancel: 'cancelled',
};

const transitionKinds: Record<TransitionRequest['command'], TaskEventKind> = {
  start: 'task.started',
  block: 'task.blocked',
  resume: 'task.resumed',
  submit: 'task.submitted',
  fail: 'task.failed',
  cancel: 'task.cancelled',
};

const transitionMessages: Record<TransitionRequest['command'], string> = {
  start: 'Task started',
  block: 'Task blocked',
  resume: 'Task resumed',
  submit: 'Task submitted and completed',
  fail: 'Task failed',
  cancel: 'Task cancelled',
};

export function createTaskRepository(db: DbClient) {
  async function findRow(client: DbClient | DbTransaction, taskId: string): Promise<TaskRow> {
    if (!isValidUuid(taskId)) throw notFound(taskId);
    const row = await client.query.tasks.findFirst({ where: eq(tasks.id, taskId) });
    if (!row) throw notFound(taskId);
    return row;
  }

  async function insertEvent(
    tx: DbTransaction,
    input: {
      taskId: string;
      kind: TaskEventKind;
      actorId: string;
      message: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<TaskEvent> {
    const [row] = await tx.insert(taskEvents).values(input).returning();
    return toEvent(row);
  }

  async function withCommand<T extends Record<string, unknown>>(
    taskId: string,
    idempotencyKey: string,
    command: string,
    request: unknown,
    operation: (
      tx: DbTransaction,
      current: TaskRow
    ) => Promise<OperationResult<T>>
  ): Promise<CommandOutcome<T>> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${taskId}))`);
      const current = await findRow(tx, taskId);
      const hash = requestHash(command, request);
      const receipt = await tx.query.taskCommandReceipts.findFirst({
        where: and(
          eq(taskCommandReceipts.taskId, taskId),
          eq(taskCommandReceipts.idempotencyKey, idempotencyKey)
        ),
      });
      if (receipt) {
        if (receipt.command !== command || receipt.requestHash !== hash) {
          throw conflict(
            'task_idempotency_conflict',
            `idempotency key ${idempotencyKey} was already used for another command`,
            { taskId, idempotencyKey, command, existingCommand: receipt.command }
          );
        }
        return { response: receipt.response as T, replayed: true };
      }

      const result = await operation(tx, current);
      await tx.insert(taskCommandReceipts).values({
        taskId,
        idempotencyKey,
        command,
        requestHash: hash,
        response: result.response,
      });
      return { ...result, replayed: false };
    });
  }

  async function detail(taskId: string): Promise<GetTaskResponse> {
    const task = toTask(await findRow(db, taskId));
    const [assignmentRows, resultRows, transitionRows, eventRows] = await Promise.all([
      db
        .select()
        .from(taskAssignments)
        .where(eq(taskAssignments.taskId, taskId))
        .orderBy(asc(taskAssignments.createdAt), asc(taskAssignments.id)),
      db
        .select()
        .from(taskResults)
        .where(eq(taskResults.taskId, taskId))
        .orderBy(asc(taskResults.createdAt), asc(taskResults.id)),
      db
        .select()
        .from(taskTransitions)
        .where(eq(taskTransitions.taskId, taskId))
        .orderBy(asc(taskTransitions.createdAt), asc(taskTransitions.id)),
      db
        .select()
        .from(taskEvents)
        .where(eq(taskEvents.taskId, taskId))
        .orderBy(asc(taskEvents.createdAt), asc(taskEvents.id)),
    ]);
    return {
      task,
      assignments: assignmentRows.map(toAssignment),
      results: resultRows.map(toResult),
      transitions: transitionRows.map(toTransition),
      events: eventRows.map(toEvent),
    };
  }

  /**
   * 执行 assignment 的公共部分（issue #130）：supersede 旧 assignment、按需创建
   * 任务房间、写入成员（creator + assignee，旧 assignee 保留成员身份）、落
   * assignment 行与 dispatch 消息（intent 'task' + metadata.opcTask assignment）、
   * 更新任务状态为 assigned、记录 transition 与事件。供 assign 命令与
   * 创建即指派（create with assigneeId）复用。
   */
  async function applyAssignment(
    tx: DbTransaction,
    current: TaskRow,
    actorId: string,
    input: AssignTaskRequest
  ): Promise<OperationResult<TaskMutationResponse>> {
    const taskId = current.id;
    const now = new Date();
    const previous = await tx.query.taskAssignments.findFirst({
      where: and(
        eq(taskAssignments.taskId, taskId),
        sql`${taskAssignments.supersededAt} is null`
      ),
    });
    if (previous) {
      await tx
        .update(taskAssignments)
        .set({
          supersededAt: now,
          supersededReason: input.reason ?? 'Task reassigned',
        })
        .where(eq(taskAssignments.id, previous.id));
    }

    let roomId = current.roomId;
    if (!roomId) {
      const [room] = await tx
        .insert(rooms)
        .values({
          name: `Task: ${current.title}`,
          creatorId: current.creatorId,
          type: 'group',
          departmentId: null,
          metadata: { kind: 'task', taskId },
        })
        .returning();
      roomId = room.id;
    }
    const members = [...new Set([current.creatorId, input.assigneeId])];
    await tx
      .insert(roomMembers)
      .values(members.map((participantId) => ({ roomId, participantId })))
      .onConflictDoNothing();

    const [assignment] = await tx
      .insert(taskAssignments)
      .values({
        taskId,
        assigneeId: input.assigneeId,
        confirmedBy: actorId,
        idempotencyKey: input.idempotencyKey,
      })
      .returning();
    const dispatchBody = [`# ${current.title}`, current.description]
      .filter((part) => part.length > 0)
      .join('\n\n');
    const [dispatchRow] = await tx
      .insert(messages)
      .values({
        roomId,
        fromParticipantId: current.creatorId,
        contentType: 'markdown',
        contentBody: dispatchBody,
        intent: 'task',
        metadata: {
          opcTask: {
            kind: 'assignment',
            taskId,
            assignmentId: assignment.id,
            assigneeId: input.assigneeId,
          },
        },
        timestamp: now,
      })
      .returning();
    const message: Message = {
      id: dispatchRow.id,
      roomId: dispatchRow.roomId,
      from: dispatchRow.fromParticipantId,
      content: {
        type: dispatchRow.contentType as Message['content']['type'],
        body: dispatchRow.contentBody,
      },
      timestamp: dispatchRow.timestamp.toISOString(),
      metadata: dispatchRow.metadata ?? undefined,
      intent: dispatchRow.intent ?? undefined,
    };
    const [updated] = await tx
      .update(tasks)
      .set({
        status: 'assigned',
        assigneeId: input.assigneeId,
        roomId,
        assignedAt: now,
        startedAt: null,
        completedAt: null,
        updatedAt: now,
        version: sql`${tasks.version} + 1`,
      })
      .where(eq(tasks.id, taskId))
      .returning();
    await tx.insert(taskTransitions).values({
      taskId,
      from: current.status,
      to: 'assigned',
      actorId,
      reason: input.reason,
      details: { assignmentId: assignment.id },
      idempotencyKey: input.idempotencyKey,
    });
    const event = await insertEvent(tx, {
      taskId,
      kind: previous ? 'task.reassigned' : 'task.assigned',
      actorId,
      message: previous ? 'Task reassigned' : 'Task assigned',
      metadata: { assignmentId: assignment.id, assigneeId: input.assigneeId },
    });
    return { response: { task: toTask(updated) }, event, message };
  }

  return {
    async create(creatorId: string, input: CreateTaskRequest): Promise<CreateTaskResponse> {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .insert(tasks)
          .values({
            creatorId,
            title: input.title,
            description: input.description ?? '',
          })
          .returning();
        await insertEvent(tx, {
          taskId: row.id,
          kind: 'task.created',
          actorId: creatorId,
          message: 'Task created',
        });
        return { task: toTask(row) };
      });
    },

    /**
     * 创建即指派（issue #130）：在单个事务内创建 draft 并立即完成首次指派
     * （房间、成员、dispatch、assignment、transition 一步到位）。
     */
    async createAssigned(
      creatorId: string,
      input: CreateTaskRequest & { assigneeId: string }
    ): Promise<OperationResult<TaskMutationResponse>> {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .insert(tasks)
          .values({
            creatorId,
            title: input.title,
            description: input.description ?? '',
          })
          .returning();
        await insertEvent(tx, {
          taskId: row.id,
          kind: 'task.created',
          actorId: creatorId,
          message: 'Task created',
        });
        return applyAssignment(tx, row, creatorId, {
          assigneeId: input.assigneeId,
          idempotencyKey: `create-assign:${row.id}`,
        });
      });
    },

    async findById(taskId: string): Promise<Task | undefined> {
      if (!isValidUuid(taskId)) return undefined;
      const row = await db.query.tasks.findFirst({ where: eq(tasks.id, taskId) });
      return row ? toTask(row) : undefined;
    },

    getDetail: detail,

    async list(query: ListTasksQuery): Promise<ListTasksResponse> {
      const clauses: SQL[] = [];
      if (query.status) clauses.push(eq(tasks.status, query.status));
      if (query.creatorId) clauses.push(eq(tasks.creatorId, query.creatorId));
      if (query.assigneeId) clauses.push(eq(tasks.assigneeId, query.assigneeId));
      if (query.cursor && isValidUuid(query.cursor)) clauses.push(lt(tasks.id, query.cursor));
      const rows = await db
        .select()
        .from(tasks)
        .where(clauses.length > 0 ? and(...clauses) : undefined)
        .orderBy(desc(tasks.updatedAt), desc(tasks.id))
        .limit(query.limit + 1);
      const hasMore = rows.length > query.limit;
      const visible = rows.slice(0, query.limit);
      return {
        tasks: visible.map(toTask),
        ...(hasMore ? { nextCursor: visible.at(-1)!.id } : {}),
      };
    },

    /** 任务房间成员关系：角色制读可见性（creator / 当前 assignee / 房间成员） */
    async isRoomMember(roomId: string, participantId: string): Promise<boolean> {
      const row = await db.query.roomMembers.findFirst({
        where: and(
          eq(roomMembers.roomId, roomId),
          eq(roomMembers.participantId, participantId)
        ),
      });
      return row !== undefined;
    },

    async updateDraft(
      taskId: string,
      actorId: string,
      input: UpdateTaskRequest
    ): Promise<{ task: Task; event: TaskEvent }> {
      return db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${taskId}))`);
        const current = await findRow(tx, taskId);
        if (current.status !== 'draft') {
          throw conflict('task_not_draft', 'only draft tasks can be edited', {
            taskId,
            status: current.status,
          });
        }
        const [updated] = await tx
          .update(tasks)
          .set({
            ...(input.title !== undefined && { title: input.title }),
            ...(input.description !== undefined && { description: input.description }),
            updatedAt: new Date(),
            version: sql`${tasks.version} + 1`,
          })
          .where(eq(tasks.id, taskId))
          .returning();
        const event = await insertEvent(tx, {
          taskId,
          kind: 'task.updated',
          actorId,
          message: 'Task draft updated',
        });
        return { task: toTask(updated), event };
      });
    },

    async assign(
      taskId: string,
      actorId: string,
      input: AssignTaskRequest
    ): Promise<CommandOutcome<TaskMutationResponse>> {
      return withCommand(
        taskId,
        input.idempotencyKey,
        'assign',
        input,
        async (tx, current) => {
          if (!['draft', 'assigned', 'in_progress', 'blocked'].includes(current.status)) {
            throw conflict(
              'invalid_task_transition',
              `cannot assign a task in ${current.status} status`,
              { taskId, status: current.status, command: 'assign' }
            );
          }
          return applyAssignment(tx, current, actorId, input);
        }
      );
    },

    async transition(
      taskId: string,
      actorId: string,
      input: TransitionRequest
    ): Promise<CommandOutcome<TaskMutationResponse>> {
      return withCommand(
        taskId,
        input.payload.idempotencyKey,
        input.command,
        input.payload,
        async (tx, current) => {
          if (!transitionRules[input.command].includes(current.status)) {
            throw conflict(
              'invalid_task_transition',
              `cannot ${input.command} a task in ${current.status} status`,
              { taskId, status: current.status, command: input.command }
            );
          }
          const next = transitionTargets[input.command];
          const now = new Date();
          let resultId: string | undefined;
          if (input.command === 'submit') {
            const [result] = await tx
              .insert(taskResults)
              .values({
                taskId,
                submittedBy: actorId,
                summary: input.payload.summary,
                metadata: input.payload.metadata,
              })
              .returning();
            resultId = result.id;
          }

          const reason =
            input.command === 'block' ||
            input.command === 'resume' ||
            input.command === 'fail' ||
            input.command === 'cancel'
              ? input.payload.reason
              : null;
          const details: Record<string, unknown> = {};
          if (resultId) details.resultId = resultId;
          if (input.command === 'fail' && input.payload.diagnostics) {
            details.diagnostics = input.payload.diagnostics;
          }
          const [updated] = await tx
            .update(tasks)
            .set({
              status: next,
              ...(input.command === 'start' && { startedAt: now }),
              ...(input.command === 'submit' && { latestResultId: resultId }),
              ...(['submit', 'fail', 'cancel'].includes(input.command) && {
                completedAt: now,
              }),
              updatedAt: now,
              version: sql`${tasks.version} + 1`,
            })
            .where(eq(tasks.id, taskId))
            .returning();
          await tx.insert(taskTransitions).values({
            taskId,
            from: current.status,
            to: next,
            actorId,
            reason,
            details: Object.keys(details).length > 0 ? details : undefined,
            idempotencyKey: input.payload.idempotencyKey,
          });
          const event = await insertEvent(tx, {
            taskId,
            kind: transitionKinds[input.command],
            actorId,
            message: transitionMessages[input.command],
            metadata: {
              ...(reason ? { reason } : {}),
              ...details,
            },
          });
          return { response: { task: toTask(updated) }, event };
        }
      );
    },

    async appendEvent(
      taskId: string,
      actorId: string,
      input: AppendTaskEventRequest
    ): Promise<CommandOutcome<AppendTaskEventResponse>> {
      return withCommand(
        taskId,
        input.idempotencyKey,
        'event',
        input,
        async (tx) => {
          const event = await insertEvent(tx, {
            taskId,
            kind: input.kind,
            actorId,
            message: input.message,
            metadata: input.metadata,
          });
          const [updated] = await tx
            .update(tasks)
            .set({ updatedAt: new Date(), version: sql`${tasks.version} + 1` })
            .where(eq(tasks.id, taskId))
            .returning();
          return { response: { task: toTask(updated), event }, event };
        }
      );
    },
  };
}

export type TaskRepository = ReturnType<typeof createTaskRepository>;
