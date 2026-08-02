import { describe, expect, it } from 'vitest';
import * as Schemas from './schemas.js';
import { API_ROUTES } from './routes.js';

interface RuntimeSchema {
  parse(value: unknown): unknown;
}

interface FutureTaskSchemas {
  TaskStatusSchema: RuntimeSchema;
  TaskTargetSchema: RuntimeSchema;
  TaskSchema: RuntimeSchema;
  TaskAssignmentSchema: RuntimeSchema;
  TaskResultSchema: RuntimeSchema;
  TaskTransitionSchema: RuntimeSchema;
  TaskEventSchema: RuntimeSchema;
  TaskRecommendationSchema: RuntimeSchema;
  TaskErrorResponseSchema: RuntimeSchema;
  CreateTaskRequestSchema: RuntimeSchema;
  AssignTaskRequestSchema: RuntimeSchema;
  BlockTaskRequestSchema: RuntimeSchema;
  RejectTaskRequestSchema: RuntimeSchema;
  AppendTaskEventRequestSchema: RuntimeSchema;
  ServerEventSchema: RuntimeSchema;
}

interface FutureTaskRoutes {
  tasks: string;
  task(id: string): string;
  taskRecommendations(id: string): string;
  taskAssignments(id: string): string;
  taskStart(id: string): string;
  taskBlock(id: string): string;
  taskResume(id: string): string;
  taskSubmit(id: string): string;
  taskApprove(id: string): string;
  taskReject(id: string): string;
  taskFail(id: string): string;
  taskCancel(id: string): string;
  taskEvents(id: string): string;
}

const schemas = Schemas as unknown as FutureTaskSchemas;
const routes = API_ROUTES as unknown as FutureTaskRoutes;
const timestamp = '2026-08-02T00:00:00.000Z';

const task = {
  id: 'task-1',
  title: 'Implement task domain',
  description: 'Ship an auditable state machine',
  departmentId: 'department-1',
  creatorId: 'alice',
  target: {
    type: 'department',
    departmentId: 'department-1',
    includeDescendants: true,
  },
  requiredSkillTags: ['mqtt', 'typescript'],
  status: 'assigned',
  assigneeId: 'agent-1',
  collaboratorIds: ['bob'],
  reviewerId: 'reviewer-1',
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
  collaboratorIds: ['bob'],
  reviewerId: 'reviewer-1',
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

describe('task protocol contract (issue #109)', () => {
  it('owns the closed task lifecycle and normalized target/skill contract', () => {
    for (const status of [
      'draft',
      'assigned',
      'in_progress',
      'blocked',
      'review',
      'completed',
      'failed',
      'cancelled',
    ]) {
      expect(schemas.TaskStatusSchema.parse(status)).toBe(status);
    }
    expect(() => schemas.TaskStatusSchema.parse('done')).toThrow();

    expect(
      schemas.TaskTargetSchema.parse({
        type: 'participant',
        participantId: 'alice',
      })
    ).toEqual({ type: 'participant', participantId: 'alice' });
    expect(
      schemas.TaskTargetSchema.parse({
        type: 'position',
        positionId: 'position-1',
      })
    ).toEqual({ type: 'position', positionId: 'position-1' });
    expect(
      schemas.TaskTargetSchema.parse({
        type: 'department',
        departmentId: 'department-1',
      })
    ).toEqual({
      type: 'department',
      departmentId: 'department-1',
      includeDescendants: false,
    });

    expect(
      schemas.CreateTaskRequestSchema.parse({
        title: 'Implement tasks',
        departmentId: 'department-1',
        requiredSkillTags: ['TypeScript', 'mqtt', 'typescript'],
      })
    ).toEqual({
      title: 'Implement tasks',
      departmentId: 'department-1',
      requiredSkillTags: ['mqtt', 'typescript'],
    });
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

  it('parses deterministic recommendation evidence without assigning', () => {
    const recommendation = {
      participantId: 'agent-1',
      participantKind: 'agent',
      name: 'Agent One',
      targetMatch: 'position',
      matchedSkillTags: ['mqtt', 'typescript'],
      availability: 'idle',
      activeTaskCount: 0,
      score: 250,
      reasons: [
        { code: 'target.position', detail: 'active assignment position-1' },
        { code: 'skills.required', detail: 'mqtt,typescript' },
        { code: 'availability.idle', detail: 'online and idle' },
      ],
    };
    expect(schemas.TaskRecommendationSchema.parse(recommendation)).toEqual(recommendation);
    expect(() =>
      schemas.TaskRecommendationSchema.parse({
        ...recommendation,
        participantKind: 'gateway',
      })
    ).toThrow();
  });

  it('requires idempotency keys and visible reasons on state commands', () => {
    expect(
      schemas.AssignTaskRequestSchema.parse({
        assigneeId: 'agent-1',
        collaboratorIds: ['bob'],
        reviewerId: 'reviewer-1',
        idempotencyKey: 'assign-1',
      })
    ).toEqual({
      assigneeId: 'agent-1',
      collaboratorIds: ['bob'],
      reviewerId: 'reviewer-1',
      idempotencyKey: 'assign-1',
    });
    expect(() => schemas.AssignTaskRequestSchema.parse({ assigneeId: 'agent-1' })).toThrow();
    expect(() =>
      schemas.BlockTaskRequestSchema.parse({ reason: '', idempotencyKey: 'block-1' })
    ).toThrow();
    expect(() =>
      schemas.RejectTaskRequestSchema.parse({ feedback: '', idempotencyKey: 'reject-1' })
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
    expect(routes.tasks).toBe('/api/v1/tasks');
    expect(routes.task('task-1')).toBe('/api/v1/tasks/task-1');
    expect(routes.taskRecommendations('task-1')).toBe('/api/v1/tasks/task-1/recommendations');
    expect(routes.taskAssignments('task-1')).toBe('/api/v1/tasks/task-1/assignments');
    expect(routes.taskStart('task-1')).toBe('/api/v1/tasks/task-1/start');
    expect(routes.taskBlock('task-1')).toBe('/api/v1/tasks/task-1/block');
    expect(routes.taskResume('task-1')).toBe('/api/v1/tasks/task-1/resume');
    expect(routes.taskSubmit('task-1')).toBe('/api/v1/tasks/task-1/submit');
    expect(routes.taskApprove('task-1')).toBe('/api/v1/tasks/task-1/approve');
    expect(routes.taskReject('task-1')).toBe('/api/v1/tasks/task-1/reject');
    expect(routes.taskFail('task-1')).toBe('/api/v1/tasks/task-1/fail');
    expect(routes.taskCancel('task-1')).toBe('/api/v1/tasks/task-1/cancel');
    expect(routes.taskEvents('task-1')).toBe('/api/v1/tasks/task-1/events');
  });

  it('owns stable task errors and keeps authorization errors separate', () => {
    expect(
      schemas.TaskErrorResponseSchema.parse({
        error: {
          code: 'invalid_task_transition',
          message: 'cannot approve a task in assigned status',
          details: { status: 'assigned', command: 'approve' },
        },
      })
    ).toEqual({
      error: {
        code: 'invalid_task_transition',
        message: 'cannot approve a task in assigned status',
        details: { status: 'assigned', command: 'approve' },
      },
    });
    expect(() =>
      schemas.TaskErrorResponseSchema.parse({
        error: { code: 'forbidden', message: 'authorization error belongs elsewhere' },
      })
    ).toThrow();
  });
});
