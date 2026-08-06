import { describe, expect, it } from 'vitest';
import * as Schemas from './schemas.js';
import * as Wire from './wire.js';

interface RuntimeSchema {
  parse(value: unknown): unknown;
}

interface FutureAgentTaskSchemas {
  TaskMessageMetadataSchema: RuntimeSchema;
  MessageSchema: RuntimeSchema;
  UplinkPayloadSchema: RuntimeSchema;
  TaskCommandRequestSchema: RuntimeSchema;
  BlockTaskRequestSchema: RuntimeSchema;
  ResumeTaskRequestSchema: RuntimeSchema;
  SubmitTaskRequestSchema: RuntimeSchema;
  FailTaskRequestSchema: RuntimeSchema;
  TaskErrorResponseSchema: RuntimeSchema;
}

interface FutureAgentTaskWire {
  OPC_HTTP_HEADERS: {
    delegatedActor: string;
  };
}

const schemas = Schemas as unknown as FutureAgentTaskSchemas;
const wire = Wire as unknown as FutureAgentTaskWire;

const assignmentMetadata = {
  opcTask: {
    kind: 'assignment',
    taskId: 'task-1',
    assignmentId: 'assignment-1',
    assigneeId: 'agent-1',
  },
};

describe('agent task execution protocol (issue #106)', () => {
  it('owns namespaced assignment and reply metadata without changing ordinary messages', () => {
    expect(schemas.TaskMessageMetadataSchema.parse(assignmentMetadata)).toEqual(
      assignmentMetadata
    );
    expect(() =>
      schemas.TaskMessageMetadataSchema.parse({
        opcTask: {
          kind: 'assignment',
          taskId: 'task-1',
          assigneeId: 'agent-1',
        },
      })
    ).toThrow();

    const dispatch = {
      id: 'message-1',
      roomId: 'room-1',
      from: 'owner-1',
      content: { type: 'markdown', body: '# Prepare release\nShip it safely.' },
      timestamp: '2026-08-02T00:00:00.000Z',
      intent: 'task',
      metadata: assignmentMetadata,
    };
    expect(schemas.MessageSchema.parse(dispatch)).toEqual(dispatch);

    const ordinary = {
      id: 'message-2',
      roomId: 'room-1',
      from: 'human-1',
      content: { type: 'text', body: 'hello' },
      timestamp: '2026-08-02T00:00:01.000Z',
    };
    expect(schemas.MessageSchema.parse(ordinary)).toEqual(ordinary);
  });

  it('accepts task card reference metadata (issue #129)', () => {
    const reference = { opcTask: { kind: 'reference', taskId: 'task-1' } };
    expect(schemas.TaskMessageMetadataSchema.parse(reference)).toEqual(reference);
    expect(() =>
      schemas.TaskMessageMetadataSchema.parse({ opcTask: { kind: 'reference' } })
    ).toThrow();
  });

  it('preserves task and thread context on agent uplink replies', () => {
    const payload = {
      content: { type: 'text', body: 'Which region should I deploy to?' },
      clientMessageId: 'reply-1',
      metadata: {
        opcTask: {
          kind: 'reply',
          taskId: 'task-1',
          assignmentId: 'assignment-1',
          threadId: 'thread-1',
        },
      },
    };
    expect(schemas.UplinkPayloadSchema.parse(payload)).toEqual(payload);
  });

  it('carries an optional assignment precondition on every agent lifecycle command', () => {
    expect(
      schemas.TaskCommandRequestSchema.parse({
        idempotencyKey: 'task-1:assignment-1:start',
        assignmentId: 'assignment-1',
      })
    ).toEqual({
      idempotencyKey: 'task-1:assignment-1:start',
      assignmentId: 'assignment-1',
    });
    expect(
      schemas.BlockTaskRequestSchema.parse({
        reason: 'Waiting for the deployment region',
        idempotencyKey: 'task-1:assignment-1:block:reply-1',
        assignmentId: 'assignment-1',
      })
    ).toMatchObject({ assignmentId: 'assignment-1' });
    expect(
      schemas.ResumeTaskRequestSchema.parse({
        reason: 'Human replied in the task room',
        idempotencyKey: 'task-1:assignment-1:resume:message-3',
        assignmentId: 'assignment-1',
      })
    ).toMatchObject({ assignmentId: 'assignment-1' });
    expect(
      schemas.SubmitTaskRequestSchema.parse({
        summary: 'Release prepared',
        idempotencyKey: 'task-1:assignment-1:submit',
        assignmentId: 'assignment-1',
      })
    ).toMatchObject({ assignmentId: 'assignment-1' });
    expect(
      schemas.FailTaskRequestSchema.parse({
        reason: 'Agent execution failed',
        diagnostics: 'bounded safe detail',
        idempotencyKey: 'task-1:assignment-1:fail',
        assignmentId: 'assignment-1',
      })
    ).toMatchObject({ assignmentId: 'assignment-1' });
  });

  it('defines delegated actor authentication and a stable stale-assignment error', () => {
    expect(wire.OPC_HTTP_HEADERS.delegatedActor).toBe('x-opc-actor-id');
    expect(
      schemas.TaskErrorResponseSchema.parse({
        error: {
          code: 'stale_task_assignment',
          message: 'assignment assignment-1 is no longer current',
          details: {
            taskId: 'task-1',
            assignmentId: 'assignment-1',
            currentAssignmentId: 'assignment-2',
          },
        },
      })
    ).toMatchObject({ error: { code: 'stale_task_assignment' } });
  });
});
