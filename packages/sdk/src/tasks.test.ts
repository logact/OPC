import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpcHttpClient } from './http.js';

/**
 * issue #130 之后 SDK task 方法的目标签名（TDD：实现尚未落地）：
 * createTask 不再携带 departmentId/target/requiredSkillTags，新增可选 assigneeId；
 * assignTask 不再携带 reviewerId/collaboratorIds；rejectTask/approveTask/recommendTask 移除。
 */
interface FutureTaskSdk {
  createTask(request: {
    title: string;
    description?: string;
    assigneeId?: string;
    parentTaskId?: string;
  }): Promise<unknown>;
  decomposeTask(
    taskId: string,
    request: {
      subtasks: Array<{ title: string; description?: string; assigneeId?: string }>;
      idempotencyKey: string;
    }
  ): Promise<unknown>;
  listTasks(query?: {
    status?: string;
    creatorId?: string;
    assigneeId?: string;
    cursor?: string;
    limit?: number;
  }): Promise<unknown>;
  getTask(taskId: string): Promise<unknown>;
  assignTask(
    taskId: string,
    request: {
      assigneeId: string;
      reason?: string;
      idempotencyKey: string;
    }
  ): Promise<unknown>;
  startTask(taskId: string, request: { idempotencyKey: string }): Promise<unknown>;
  submitTask(
    taskId: string,
    request: { summary: string; idempotencyKey: string }
  ): Promise<unknown>;
  appendTaskEvent(
    taskId: string,
    request: {
      kind: 'progress' | 'note' | 'decision' | 'artifact';
      message: string;
      idempotencyKey: string;
    }
  ): Promise<unknown>;
}

const baseUrl = 'http://localhost:3000';
const timestamp = '2026-08-02T00:00:00.000Z';
const task = {
  id: 'task-1',
  title: 'SDK task',
  description: '',
  creatorId: 'alice',
  parentTaskId: null,
  status: 'draft',
  assigneeId: null,
  roomId: null,
  latestResultId: null,
  createdAt: timestamp,
  updatedAt: timestamp,
  assignedAt: null,
  startedAt: null,
  completedAt: null,
  progress: { total: 0, completed: 0 },
};

function futureClient(token = 'jwt-token'): FutureTaskSdk {
  return new OpcHttpClient(baseUrl, token);
}

function response(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
  } as Response;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OpcHttpClient task contract', () => {
  it('creates a task through API_ROUTES and runtime-parses the response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ task }));
    globalThis.fetch = fetchMock;
    const client = futureClient();

    const result = await client.createTask({
      title: 'SDK task',
      description: '',
    });

    expect(result).toEqual({ task });
    expect(fetchMock).toHaveBeenCalledWith(
      `${baseUrl}/api/v1/tasks`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer jwt-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: 'SDK task',
          description: '',
        }),
      }
    );
  });

  it('supports direct assignment at creation via an optional assigneeId', async () => {
    const assigned = { ...task, status: 'assigned', assigneeId: 'agent-1', roomId: 'room-1' };
    const fetchMock = vi.fn().mockResolvedValue(response({ task: assigned }));
    globalThis.fetch = fetchMock;
    const client = futureClient();

    const result = await client.createTask({
      title: 'SDK task',
      assigneeId: 'agent-1',
    });

    expect(result).toEqual({ task: assigned });
    expect(fetchMock).toHaveBeenCalledWith(
      `${baseUrl}/api/v1/tasks`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          title: 'SDK task',
          assigneeId: 'agent-1',
        }),
      })
    );
  });

  it('creates auditable subtask batches through the decomposition route', async () => {
    const child = { ...task, id: 'child-1', parentTaskId: task.id };
    const fetchMock = vi.fn().mockResolvedValue(response({ task: { ...task, progress: { total: 1, completed: 0 } }, children: [child] }));
    globalThis.fetch = fetchMock;

    await futureClient().decomposeTask(task.id, {
      subtasks: [{ title: 'Child task', assigneeId: 'agent-1' }],
      idempotencyKey: 'decompose-1',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `${baseUrl}/api/v1/tasks/${task.id}/decompose`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          subtasks: [{ title: 'Child task', assigneeId: 'agent-1' }],
          idempotencyKey: 'decompose-1',
        }),
      })
    );
  });

  it('rejects a malformed server response instead of returning a type assertion', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(response({ task: { id: 'task-1' } }));

    await expect(futureClient().getTask('task-1')).rejects.toThrow();
  });

  it('encodes visibility filters and pagination deterministically', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ tasks: [], nextCursor: 'next' }));
    globalThis.fetch = fetchMock;

    await futureClient().listTasks({
      status: 'in_progress',
      creatorId: 'human/id',
      assigneeId: 'agent/id',
      cursor: 'cursor/value',
      limit: 25,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `${baseUrl}/api/v1/tasks?status=in_progress&creatorId=human%2Fid&assigneeId=agent%2Fid&cursor=cursor%2Fvalue&limit=25`,
      expect.objectContaining({ headers: { Authorization: 'Bearer jwt-token' } })
    );
  });

  it('routes assignment and lifecycle commands to explicit protocol paths', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ task }))
      .mockResolvedValueOnce(response({ task }))
      .mockResolvedValueOnce(response({ task }))
      .mockResolvedValueOnce(
        response({
          task,
          event: {
            id: 'event-1',
            taskId: task.id,
            kind: 'progress',
            actorId: 'alice',
            message: 'Half complete',
            createdAt: timestamp,
          },
        })
      );
    globalThis.fetch = fetchMock;
    const client = futureClient();

    await client.assignTask('task/id', {
      assigneeId: 'agent-1',
      idempotencyKey: 'assign-1',
    });
    await client.startTask('task/id', { idempotencyKey: 'start-1' });
    await client.submitTask('task/id', {
      summary: 'Done, completed directly without review',
      idempotencyKey: 'submit-1',
    });
    await client.appendTaskEvent('task/id', {
      kind: 'progress',
      message: 'Half complete',
      idempotencyKey: 'event-1',
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `${baseUrl}/api/v1/tasks/task%2Fid/assignments`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ assigneeId: 'agent-1', idempotencyKey: 'assign-1' }),
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `${baseUrl}/api/v1/tasks/task%2Fid/start`,
      expect.objectContaining({ method: 'POST' })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      `${baseUrl}/api/v1/tasks/task%2Fid/submit`,
      expect.objectContaining({ method: 'POST' })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      `${baseUrl}/api/v1/tasks/task%2Fid/events`,
      expect.objectContaining({ method: 'POST' })
    );
  });
});
