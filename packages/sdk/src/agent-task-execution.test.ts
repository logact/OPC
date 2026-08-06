import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpcHttpClient } from './http.js';

const timestamp = '2026-08-02T00:00:00.000Z';

// issue #130：task 不再携带 departmentId/target/requiredSkillTags/reviewerId/collaboratorIds；
// submit 直接进入 completed（不再有 review 状态）。
function task(status: 'assigned' | 'in_progress' | 'blocked' | 'completed' | 'failed') {
  return {
    id: 'task-1',
    title: 'Prepare release',
    description: 'Ship it safely',
    creatorId: 'owner-1',
    status,
    assigneeId: 'agent-1',
    roomId: 'room-1',
    latestResultId: status === 'completed' ? 'result-1' : null,
    createdAt: timestamp,
    updatedAt: timestamp,
    assignedAt: timestamp,
    startedAt: status === 'assigned' ? null : timestamp,
    completedAt: status === 'completed' ? timestamp : null,
  };
}

describe('OpcHttpClient delegated agent callbacks (issue #106)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('authenticates task transitions with the gateway credential and delegated agent id', async () => {
    const statuses: Array<'in_progress' | 'blocked' | 'completed' | 'failed'> = [
      'in_progress',
      'blocked',
      'in_progress',
      'completed',
      'failed',
    ];
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      void input;
      void init;
      const status = statuses.shift() ?? 'failed';
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ task: task(status) }),
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new OpcHttpClient('http://localhost:3000', 'gateway-token', {
      actorId: 'agent-1',
    });
    await client.startTask('task-1', {
      idempotencyKey: 'task-1:assignment-1:start',
      assignmentId: 'assignment-1',
    });
    await client.blockTask('task-1', {
      reason: 'Waiting for region',
      idempotencyKey: 'task-1:assignment-1:block:reply-1',
      assignmentId: 'assignment-1',
    });
    await client.resumeTask('task-1', {
      reason: 'Human replied in the task room',
      idempotencyKey: 'task-1:assignment-1:resume:message-2',
      assignmentId: 'assignment-1',
    });
    await client.submitTask('task-1', {
      summary: 'Release prepared',
      idempotencyKey: 'task-1:assignment-1:submit',
      assignmentId: 'assignment-1',
    });
    await client.failTask('task-1', {
      reason: 'Execution context lost after gateway restart',
      idempotencyKey: 'task-1:assignment-1:fail:restart',
      assignmentId: 'assignment-1',
    });

    expect(fetchMock).toHaveBeenCalledTimes(5);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init).toMatchObject({
        method: 'POST',
        headers: {
          Authorization: 'Bearer gateway-token',
          'Content-Type': 'application/json',
          'x-opc-actor-id': 'agent-1',
        },
      });
    }
    const firstBody = fetchMock.mock.calls[0][1]?.body;
    expect(typeof firstBody === 'string' ? firstBody : '').toContain(
      '"assignmentId":"assignment-1"'
    );
  });

  it('runtime-parses delegated callback responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ task: { id: 'task-1', status: 'completed' } }),
      })
    );
    const client = new OpcHttpClient('http://localhost:3000', 'gateway-token', {
      actorId: 'agent-1',
    });
    await expect(
      client.submitTask('task-1', {
        summary: 'done',
        idempotencyKey: 'submit-1',
        assignmentId: 'assignment-1',
      })
    ).rejects.toThrow();
  });
});
