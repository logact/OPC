import { describe, expect, it } from 'vitest';
import * as Schemas from './schemas.js';
import { API_ROUTES } from './routes.js';

interface RuntimeSchema {
  parse(value: unknown): unknown;
}

interface TaskSchemas {
  TaskStatusSchema: RuntimeSchema;
  TaskSchema: RuntimeSchema;
  TaskAssignmentSchema: RuntimeSchema;
  TaskResultSchema: RuntimeSchema;
  TaskTransitionSchema: RuntimeSchema;
  TaskEventKindSchema: RuntimeSchema;
  TaskEventSchema: RuntimeSchema;
  TaskErrorResponseSchema: RuntimeSchema;
  CreateTaskRequestSchema: RuntimeSchema;
  AssignTaskRequestSchema: RuntimeSchema;
  BlockTaskRequestSchema: RuntimeSchema;
  AppendTaskEventRequestSchema: RuntimeSchema;
  ServerEventSchema: RuntimeSchema;
}

const schemas = Schemas as unknown as TaskSchemas;
const timestamp = '2026-08-02T00:00:00.000Z';

const task = {
  id: 'task-1',
  title: 'Implement task domain',
  description: 'Ship an auditable state machine',
  creatorId: 'alice',
  status: 'assigned',
  assigneeId: 'agent-1',
  roomId: 'room-1',
  latestResultId: null,
  createdAt: timestamp,
  updatedAt: timestamp,
  assignedAt: timestamp,
  startedAt: null,
  completedAt: null,
};

const assignment = {
  id: 'assignment-1',
  taskId: 'task-1',
  assigneeId: 'agent-1',
  confirmedBy: 'alice',
  idempotencyKey: 'assign-command-1',
  createdAt: timestamp,
  supersededAt: null,
  supersededReason: null,
};

const transition = {
  id: 'transition-1',
  taskId: 'task-1',
  from: 'draft',
  to: 'assigned',
  actorId: 'alice',
  reason: null,
  details: { assignmentId: 'assignment-1' },
  idempotencyKey: 'assign-command-1',
  createdAt: timestamp,
};

const event = {
  id: 'event-1',
  taskId: 'task-1',
  kind: 'task.assigned',
  actorId: 'alice',
  message: 'Assigned to agent-1',
  metadata: { assignmentId: 'assignment-1' },
  createdAt: timestamp,
};

describe('task protocol contract (issue #130)', () => {
  it('owns the simplified task lifecycle without a review status', () => {
    for (const status of [
      'draft',
      'assigned',
      'in_progress',
      'blocked',
      'completed',
      'failed',
      'cancelled',
    ]) {
      expect(schemas.TaskStatusSchema.parse(status)).toBe(status);
    }
    expect(() => schemas.TaskStatusSchema.parse('review')).toThrow();
    expect(() => schemas.TaskStatusSchema.parse('done')).toThrow();
  });

  it('parses the task projection and every immutable audit model', () => {
    expect(schemas.TaskSchema.parse(task)).toEqual(task);
    expect(schemas.TaskAssignmentSchema.parse(assignment)).toEqual(assignment);
    expect(
      schemas.TaskResultSchema.parse({
        id: 'result-1',
        taskId: 'task-1',
        submittedBy: 'agent-1',
        summary: 'Implemented and verified',
        metadata: { artifact: 'pr-123' },
        createdAt: timestamp,
      })
    ).toEqual({
      id: 'result-1',
      taskId: 'task-1',
      submittedBy: 'agent-1',
      summary: 'Implemented and verified',
      metadata: { artifact: 'pr-123' },
      createdAt: timestamp,
    });
    expect(schemas.TaskTransitionSchema.parse(transition)).toEqual(transition);
    expect(schemas.TaskEventSchema.parse(event)).toEqual(event);
  });

  it('keeps deprecated review event kinds parseable for immutable history', () => {
    expect(schemas.TaskEventKindSchema.parse('task.approved')).toBe('task.approved');
    expect(schemas.TaskEventKindSchema.parse('task.rejected')).toBe('task.rejected');
  });

  it('supports direct assignment at creation and strips removed legacy fields', () => {
    expect(
      schemas.CreateTaskRequestSchema.parse({
        title: 'Implement tasks',
        description: 'Ship it',
        assigneeId: 'agent-1',
      })
    ).toEqual({
      title: 'Implement tasks',
      description: 'Ship it',
      assigneeId: 'agent-1',
    });
    // 旧客户端负载携带已移除字段时仍可通过校验（Zod 默认剥离未知键）
    expect(
      schemas.CreateTaskRequestSchema.parse({
        title: 'Legacy payload',
        departmentId: 'department-1',
        target: { type: 'participant', participantId: 'alice' },
        requiredSkillTags: ['mqtt'],
        reviewerId: 'lead-1',
        collaboratorIds: ['bob'],
      })
    ).toEqual({ title: 'Legacy payload' });
    expect(
      schemas.AssignTaskRequestSchema.parse({
        assigneeId: 'agent-1',
        reviewerId: 'lead-1',
        collaboratorIds: ['bob'],
        idempotencyKey: 'assign-1',
      })
    ).toEqual({ assigneeId: 'agent-1', idempotencyKey: 'assign-1' });
  });

  it('accepts an optional originRoomId for chat-originated tasks (issue #129)', () => {
    expect(
      schemas.CreateTaskRequestSchema.parse({
        title: 'Chat task',
        assigneeId: 'agent-1',
        originRoomId: 'room-1',
      })
    ).toEqual({ title: 'Chat task', assigneeId: 'agent-1', originRoomId: 'room-1' });
  });

  it('requires idempotency keys and visible reasons on state commands', () => {
    expect(() => schemas.AssignTaskRequestSchema.parse({ assigneeId: 'agent-1' })).toThrow();
    expect(() =>
      schemas.BlockTaskRequestSchema.parse({ reason: '', idempotencyKey: 'block-1' })
    ).toThrow();
    expect(() =>
      schemas.AppendTaskEventRequestSchema.parse({
        kind: 'task.approved',
        message: 'clients cannot forge lifecycle events',
        idempotencyKey: 'event-1',
      })
    ).toThrow();
  });

  it('adds task events to the existing ServerEvent union', () => {
    expect(
      schemas.ServerEventSchema.parse({
        type: 'task.event',
        roomId: 'room-1',
        taskId: 'task-1',
        event,
      })
    ).toEqual({
      type: 'task.event',
      roomId: 'room-1',
      taskId: 'task-1',
      event,
    });
  });

  it('provides every task route through API_ROUTES', () => {
    expect(API_ROUTES.tasks).toBe('/api/v1/tasks');
    expect(API_ROUTES.task('task-1')).toBe('/api/v1/tasks/task-1');
    expect(API_ROUTES.taskAssignments('task-1')).toBe('/api/v1/tasks/task-1/assignments');
    expect(API_ROUTES.taskStart('task-1')).toBe('/api/v1/tasks/task-1/start');
    expect(API_ROUTES.taskBlock('task-1')).toBe('/api/v1/tasks/task-1/block');
    expect(API_ROUTES.taskResume('task-1')).toBe('/api/v1/tasks/task-1/resume');
    expect(API_ROUTES.taskSubmit('task-1')).toBe('/api/v1/tasks/task-1/submit');
    expect(API_ROUTES.taskFail('task-1')).toBe('/api/v1/tasks/task-1/fail');
    expect(API_ROUTES.taskCancel('task-1')).toBe('/api/v1/tasks/task-1/cancel');
    expect(API_ROUTES.taskEvents('task-1')).toBe('/api/v1/tasks/task-1/events');
  });

  it('removed recommendation and review routes from API_ROUTES', () => {
    const routes = API_ROUTES as unknown as Record<string, unknown>;
    expect(routes.taskRecommendations).toBeUndefined();
    expect(routes.taskApprove).toBeUndefined();
    expect(routes.taskReject).toBeUndefined();
  });

  it('owns stable task errors and keeps authorization errors separate', () => {
    expect(
      schemas.TaskErrorResponseSchema.parse({
        error: {
          code: 'invalid_task_transition',
          message: 'cannot submit a task in assigned status',
          details: { status: 'assigned', command: 'submit' },
        },
      })
    ).toEqual({
      error: {
        code: 'invalid_task_transition',
        message: 'cannot submit a task in assigned status',
        details: { status: 'assigned', command: 'submit' },
      },
    });
    expect(
      schemas.TaskErrorResponseSchema.parse({
        error: { code: 'stale_task_assignment', message: 'assignment is no longer current' },
      })
    ).toEqual({
      error: { code: 'stale_task_assignment', message: 'assignment is no longer current' },
    });
    // 已随 recommendation / review 移除的错误码不再合法
    expect(() =>
      schemas.TaskErrorResponseSchema.parse({
        error: { code: 'task_candidate_ineligible', message: 'recommendation is gone' },
      })
    ).toThrow();
  });
});
