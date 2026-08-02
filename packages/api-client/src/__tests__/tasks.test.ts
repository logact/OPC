import { describe, expect, it, vi } from 'vitest';
import * as ApiClientModule from '../index.js';
import type { OpcHttpClient } from '../http.js';

interface FutureTasksApi {
  create(request: {
    title: string;
    departmentId: string;
    requiredSkillTags?: string[];
  }): Promise<unknown>;
  list(query?: {
    status?: string;
    departmentId?: string;
    assigneeId?: string;
    cursor?: string;
    limit?: number;
  }): Promise<unknown>;
  get(taskId: string): Promise<unknown>;
  assign(
    taskId: string,
    request: {
      assigneeId: string;
      reviewerId: string;
      idempotencyKey: string;
    }
  ): Promise<unknown>;
  block(
    taskId: string,
    request: { reason: string; idempotencyKey: string }
  ): Promise<unknown>;
  approve(
    taskId: string,
    request: { comment?: string; idempotencyKey: string }
  ): Promise<unknown>;
}

interface FutureTaskApiModule {
  createTasksApi(client: OpcHttpClient): FutureTasksApi;
}

const module = ApiClientModule as unknown as FutureTaskApiModule;
const timestamp = '2026-08-02T00:00:00.000Z';
const task = {
  id: 'task-1',
  title: 'API client task',
  description: '',
  departmentId: 'department-1',
  creatorId: 'alice',
  target: null,
  requiredSkillTags: [],
  status: 'draft',
  assigneeId: null,
  collaboratorIds: [],
  reviewerId: null,
  roomId: null,
  latestResultId: null,
  createdAt: timestamp,
  updatedAt: timestamp,
  assignedAt: null,
  startedAt: null,
  completedAt: null,
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
      departmentId: 'department-1',
      requiredSkillTags: [],
    });

    expect(client.post).toHaveBeenCalledWith('/tasks', {
      title: 'API client task',
      departmentId: 'department-1',
      requiredSkillTags: [],
    });
    expect(result).toEqual({ task });
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
      departmentId: 'department/id',
      assigneeId: 'agent/id',
      cursor: 'cursor/id',
      limit: 10,
    });

    expect(client.get).toHaveBeenCalledWith(
      '/tasks?status=blocked&departmentId=department%2Fid&assigneeId=agent%2Fid&cursor=cursor%2Fid&limit=10'
    );
  });

  it('uses explicit assignment and transition routes and validates every response', async () => {
    const client = createMockClient();
    vi.mocked(client.post).mockResolvedValue({ task });
    const api = module.createTasksApi(client);

    await api.assign('task/id', {
      assigneeId: 'agent-1',
      reviewerId: 'reviewer-1',
      idempotencyKey: 'assign-1',
    });
    await api.block('task/id', {
      reason: 'Waiting for input',
      idempotencyKey: 'block-1',
    });
    await api.approve('task/id', {
      comment: 'Looks good',
      idempotencyKey: 'approve-1',
    });

    expect(client.post).toHaveBeenNthCalledWith(1, '/tasks/task%2Fid/assignments', {
      assigneeId: 'agent-1',
      reviewerId: 'reviewer-1',
      idempotencyKey: 'assign-1',
    });
    expect(client.post).toHaveBeenNthCalledWith(2, '/tasks/task%2Fid/block', {
      reason: 'Waiting for input',
      idempotencyKey: 'block-1',
    });
    expect(client.post).toHaveBeenNthCalledWith(3, '/tasks/task%2Fid/approve', {
      comment: 'Looks good',
      idempotencyKey: 'approve-1',
    });
  });
});
