import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryManager, type MemoryRecord } from '@opc/memory';
import {
  createStateStore,
  type GatewayStateStore,
  type TaskCallbackRecord,
  type TaskExecutionRecord,
} from './state.js';
import { createGatewayMemoryStore } from './memory-store.js';

function taskStore(path: string): GatewayStateStore {
  return createStateStore(path);
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

const memory: MemoryRecord = {
  id: 'memory-1',
  scope: 'agent-1',
  content: 'The release codename is bluejay.',
  kind: 'fact',
  importance: 0.9,
  metadata: { source: 'participant_message' },
  createdAt: '2026-08-09T00:00:00.000Z',
  updatedAt: '2026-08-09T00:00:00.000Z',
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

  it('persists scope-isolated agent memory across a state-store reopen', () => {
    const path = databasePath();
    const first = taskStore(path);
    first.putMemory(memory);
    first.putMemory({ ...memory, id: 'memory-2', scope: 'agent-2', content: 'Other agent memory' });
    first.close();

    const reopened = taskStore(path);
    expect(reopened.listMemories('agent-1')).toEqual([memory]);
    expect(reopened.listMemories('agent-2')).toEqual([
      { ...memory, id: 'memory-2', scope: 'agent-2', content: 'Other agent memory' },
    ]);
    expect(reopened.deleteMemory('agent-1', memory.id)).toBe(true);
    expect(reopened.clearMemories('agent-2')).toBe(1);
    reopened.close();
  });

  it('adapts durable gateway state to the generic memory manager', async () => {
    const path = databasePath();
    const first = taskStore(path);
    const writer = new MemoryManager({
      store: createGatewayMemoryStore(() => first),
      idFactory: () => 'memory-1',
      now: () => new Date('2026-08-09T00:00:00.000Z'),
    });
    await writer.remember({
      scope: 'agent-1',
      content: 'The production release codename is bluejay.',
      kind: 'fact',
      importance: 0.9,
    });
    first.close();

    const reopened = taskStore(path);
    const reader = new MemoryManager({ store: createGatewayMemoryStore(() => reopened) });
    const matches = await reader.recall({ scope: 'agent-1', query: 'production bluejay' });

    expect(matches).toHaveLength(1);
    expect(matches[0]?.memory.content).toContain('bluejay');
    reopened.close();
  });
});
