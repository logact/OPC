import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createStateStore, type GatewayStateStore } from './state.js';

interface TaskExecutionRecord {
  agentId: string;
  taskId: string;
  assignmentId: string;
  roomId: string;
  threadId: string;
  dispatchMessageId: string;
  state: 'active' | 'blocked' | 'review' | 'failed';
}

interface TaskCallbackRecord {
  agentId: string;
  taskId: string;
  assignmentId: string;
  sequence: number;
  command: 'start' | 'block' | 'resume' | 'submit' | 'fail';
  idempotencyKey: string;
  payload: Record<string, unknown>;
}

interface FutureTaskStateStore extends GatewayStateStore {
  claimTaskExecution(
    record: TaskExecutionRecord
  ): { record: TaskExecutionRecord; created: boolean };
  getTaskExecution(agentId: string, taskId: string): TaskExecutionRecord | undefined;
  listActiveTaskExecutions(agentId: string): TaskExecutionRecord[];
  updateTaskExecutionState(
    agentId: string,
    taskId: string,
    assignmentId: string,
    state: TaskExecutionRecord['state']
  ): void;
  markTaskMessageProcessed(agentId: string, messageId: string): boolean;
  enqueueTaskCallback(callback: TaskCallbackRecord): boolean;
  listPendingTaskCallbacks(agentId: string): TaskCallbackRecord[];
  completeTaskCallback(idempotencyKey: string): void;
}

function taskStore(path: string): FutureTaskStateStore {
  return createStateStore(path) as FutureTaskStateStore;
}

const record: TaskExecutionRecord = {
  agentId: 'agent-1',
  taskId: 'task-1',
  assignmentId: 'assignment-1',
  roomId: 'room-1',
  threadId: 'thread-1',
  dispatchMessageId: 'dispatch-1',
  state: 'active',
};

describe('gateway durable task execution state (issue #106)', () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  function databasePath(): string {
    const directory = mkdtempSync(join(tmpdir(), 'opc-gateway-task-state-'));
    temporaryDirectories.push(directory);
    return join(directory, 'state.db');
  }

  it('claims one task/thread mapping across duplicate dispatch and process reopen', () => {
    const path = databasePath();
    const first = taskStore(path);
    expect(first.claimTaskExecution(record)).toEqual({ record, created: true });
    expect(
      first.claimTaskExecution({
        ...record,
        threadId: 'duplicate-thread-must-not-win',
      })
    ).toEqual({ record, created: false });
    first.close();

    const reopened = taskStore(path);
    expect(reopened.getTaskExecution('agent-1', 'task-1')).toEqual(record);
    expect(reopened.listActiveTaskExecutions('agent-1')).toEqual([record]);
    reopened.close();
  });

  it('deduplicates task messages independently from timestamp watermarks', () => {
    const store = taskStore(':memory:');
    expect(store.markTaskMessageProcessed('agent-1', 'dispatch-1')).toBe(true);
    expect(store.markTaskMessageProcessed('agent-1', 'dispatch-1')).toBe(false);
    expect(store.markTaskMessageProcessed('agent-1', 'reply-same-timestamp-a')).toBe(true);
    expect(store.markTaskMessageProcessed('agent-1', 'reply-same-timestamp-b')).toBe(true);
    store.close();
  });

  it('persists callback order and idempotency across disconnect and restart', () => {
    const path = databasePath();
    const first = taskStore(path);
    first.claimTaskExecution(record);
    const start: TaskCallbackRecord = {
      agentId: 'agent-1',
      taskId: 'task-1',
      assignmentId: 'assignment-1',
      sequence: 1,
      command: 'start',
      idempotencyKey: 'task-1:assignment-1:start',
      payload: { assignmentId: 'assignment-1' },
    };
    const block: TaskCallbackRecord = {
      agentId: 'agent-1',
      taskId: 'task-1',
      assignmentId: 'assignment-1',
      sequence: 2,
      command: 'block',
      idempotencyKey: 'task-1:assignment-1:block:reply-1',
      payload: {
        assignmentId: 'assignment-1',
        reason: 'Which region should I deploy to?',
      },
    };
    expect(first.enqueueTaskCallback(block)).toBe(true);
    expect(first.enqueueTaskCallback(start)).toBe(true);
    expect(first.enqueueTaskCallback(start)).toBe(false);
    first.close();

    const reopened = taskStore(path);
    expect(reopened.listPendingTaskCallbacks('agent-1')).toEqual([start, block]);
    reopened.completeTaskCallback(start.idempotencyKey);
    expect(reopened.listPendingTaskCallbacks('agent-1')).toEqual([block]);
    reopened.close();
  });

  it('retains orphaned active mappings for deterministic restart failure instead of re-execution', () => {
    const path = databasePath();
    const first = taskStore(path);
    first.claimTaskExecution(record);
    first.updateTaskExecutionState(
      record.agentId,
      record.taskId,
      record.assignmentId,
      'blocked'
    );
    first.close();

    const reopened = taskStore(path);
    expect(reopened.listActiveTaskExecutions('agent-1')).toEqual([
      { ...record, state: 'blocked' },
    ]);
    reopened.close();
  });
});
