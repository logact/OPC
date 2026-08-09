import { describe, expect, it, vi } from 'vitest';
import * as ApiClientModule from '../index.js';
import type { OpcHttpClient } from '../http.js';

/**
 * issue #130 之后 api-client task API 的目标形态：
 * create 不再携带 departmentId/target/requiredSkillTags，新增可选 assigneeId；
 * assign 不再携带 reviewerId/collaboratorIds；recommend/approve/reject 移除。
 */
interface TasksApi {
  create(request: {
    title: string;
    description?: string;
    assigneeId?: string;
    parentTaskId?: string;
  }): Promise<unknown>;
  decompose(
    taskId: string,
    request: {
      subtasks: Array<{ title: string; description?: string; assigneeId?: string }>;
      idempotencyKey: string;
    }
  ): Promise<unknown>;
  list(query?: {
    status?: string;
    creatorId?: string;
    assigneeId?: string;
    cursor?: string;
    limit?: number;
  }): Promise<unknown>;
  get(taskId: string): Promise<unknown>;
  assign(
    taskId: string,
    request: {
      assigneeId: string;
      reason?: string;
      idempotencyKey: string;
    }
  ): Promise<unknown>;
  block(
    taskId: string,
    request: { reason: string; idempotencyKey: string }
  ): Promise<unknown>;
  submit(
    taskId: string,
    request: { summary: string; idempotencyKey: string }
  ): Promise<unknown>;
}

interface TaskApiModule {
  createTasksApi(client: OpcHttpClient): TasksApi;
}

const module = ApiClientModule as unknown as TaskApiModule;
const timestamp = '2026-08-02T00:00:00.000Z';
const task = {
  id: 'task-1',
  title: 'API client task',
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

function createMockClient(): OpcHttpClient {
  return {
    axios: {} as unknown as OpcHttpClient['axios'],
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  };
}

describe('createTasksApi', () => {
  it('uses the task collection route and validates create responses', async () => {
    const client = createMockClient();
    vi.mocked(client.post).mockResolvedValue({ task });

    const result = await module.createTasksApi(client).create({
      title: 'API client task',
      description: '',
    });

    expect(client.post).toHaveBeenCalledWith('/tasks', {
      title: 'API client task',
      description: '',
    });
    expect(result).toEqual({ task });
  });

  it('supports direct assignment at creation via an optional assigneeId', async () => {
    const client = createMockClient();
    const assigned = { ...task, status: 'assigned', assigneeId: 'agent-1', roomId: 'room-1' };
    vi.mocked(client.post).mockResolvedValue({ task: assigned });

    const result = await module.createTasksApi(client).create({
      title: 'API client task',
      assigneeId: 'agent-1',
    });

    expect(client.post).toHaveBeenCalledWith('/tasks', {
      title: 'API client task',
      assigneeId: 'agent-1',
    });
    expect(result).toEqual({ task: assigned });
  });

  it('uses the protocol decomposition route and runtime-validates child projections', async () => {
    const client = createMockClient();
    const child = { ...task, id: 'child-1', parentTaskId: task.id };
    vi.mocked(client.post).mockResolvedValue({
      task: { ...task, progress: { total: 1, completed: 0 } },
      children: [child],
    });

    await module.createTasksApi(client).decompose(task.id, {
      subtasks: [{ title: 'Child task', assigneeId: 'agent-1' }],
      idempotencyKey: 'decompose-1',
    });

    expect(client.post).toHaveBeenCalledWith('/tasks/task-1/decompose', {
      subtasks: [{ title: 'Child task', assigneeId: 'agent-1' }],
      idempotencyKey: 'decompose-1',
    });
  });

  it('rejects malformed detail and list responses at runtime', async () => {
    const client = createMockClient();
    vi.mocked(client.get)
      .mockResolvedValueOnce({ task: { id: 'task-1' } })
      .mockResolvedValueOnce({ tasks: [{ id: 'task-1' }] });
    const api = module.createTasksApi(client);

    await expect(api.get('task-1')).rejects.toThrow();
    await expect(api.list()).rejects.toThrow();
  });

  it('encodes list filters with protocol field names', async () => {
    const client = createMockClient();
    vi.mocked(client.get).mockResolvedValue({ tasks: [] });

    await module.createTasksApi(client).list({
      status: 'blocked',
      creatorId: 'human/id',
      assigneeId: 'agent/id',
      cursor: 'cursor/id',
      limit: 10,
    });

    expect(client.get).toHaveBeenCalledWith(
      '/tasks?status=blocked&creatorId=human%2Fid&assigneeId=agent%2Fid&cursor=cursor%2Fid&limit=10'
    );
  });

  it('uses explicit assignment and transition routes and validates every response', async () => {
    const client = createMockClient();
    vi.mocked(client.post).mockResolvedValue({ task });
    const api = module.createTasksApi(client);

    await api.assign('task/id', {
      assigneeId: 'agent-1',
      idempotencyKey: 'assign-1',
    });
    await api.block('task/id', {
      reason: 'Waiting for input',
      idempotencyKey: 'block-1',
    });
    await api.submit('task/id', {
      summary: 'Done, completed directly without review',
      idempotencyKey: 'submit-1',
    });

    expect(client.post).toHaveBeenNthCalledWith(1, '/tasks/task%2Fid/assignments', {
      assigneeId: 'agent-1',
      idempotencyKey: 'assign-1',
    });
    expect(client.post).toHaveBeenNthCalledWith(2, '/tasks/task%2Fid/block', {
      reason: 'Waiting for input',
      idempotencyKey: 'block-1',
    });
    expect(client.post).toHaveBeenNthCalledWith(3, '/tasks/task%2Fid/submit', {
      summary: 'Done, completed directly without review',
      idempotencyKey: 'submit-1',
    });
  });
});
