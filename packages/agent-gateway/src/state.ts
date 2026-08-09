import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { MemoryKind, MemoryMetadata, MemoryRecord } from '@opc/memory';

/**
 * 某 agent 在某房间内已处理消息的水位（issue #84 离线补投）。
 * 语义：timestamp 严格小于 lastTimestamp、或同 timestamp 且 id 相同的
 * 消息视为已处理，补投/去重时跳过。
 */
export interface Watermark {
  lastTimestamp: string;
  lastMessageId: string;
}

export type TaskExecutionState = 'active' | 'blocked' | 'review' | 'failed';

export interface TaskExecutionRecord {
  agentId: string;
  taskId: string;
  assignmentId: string;
  roomId: string;
  threadId: string;
  dispatchMessageId: string;
  state: TaskExecutionState;
}

export type TaskCallbackCommand = 'start' | 'block' | 'resume' | 'submit' | 'fail';

export interface TaskCallbackRecord {
  agentId: string;
  taskId: string;
  assignmentId: string;
  sequence: number;
  command: TaskCallbackCommand;
  idempotencyKey: string;
  payload: Record<string, unknown>;
}

/**
 * gateway 本地状态存储（SQLite，node:sqlite 内置模块，零外部依赖）：
 * - watermarks：per-agent-per-room 消息水位，重连/重启后按水位增量拉历史，
 *   并对 broker 离线队列与 HTTP 拉取的重叠消息幂等去重；
 * - thread_rooms：thread → room 映射的持久化副本（内存 threadRoomMap 的
 *   落盘备份，进程重启后仅供诊断/清理，runtime thread 本身不可恢复）。
 * - agent_memories：per-agent 记忆；runtime 在新 thread 创建时按当前目标
 *   检索相关上下文，SQLite 使这部分上下文跨 gateway 重启保留。
 */
export interface GatewayStateStore {
  getWatermark(agentId: string, roomId: string): Watermark | undefined;
  setWatermark(agentId: string, roomId: string, watermark: Watermark): void;
  setThreadRoom(threadId: string, roomId: string, agentId: string): void;
  claimTaskExecution(
    record: TaskExecutionRecord,
  ): { record: TaskExecutionRecord; created: boolean };
  getTaskExecution(agentId: string, taskId: string): TaskExecutionRecord | undefined;
  listTaskExecutions(agentId: string): TaskExecutionRecord[];
  listActiveTaskExecutions(agentId: string): TaskExecutionRecord[];
  updateTaskExecutionState(
    agentId: string,
    taskId: string,
    assignmentId: string,
    state: TaskExecutionState,
  ): void;
  markTaskMessageProcessed(agentId: string, messageId: string): boolean;
  enqueueTaskCallback(callback: TaskCallbackRecord): boolean;
  listPendingTaskCallbacks(agentId: string): TaskCallbackRecord[];
  completeTaskCallback(idempotencyKey: string): void;
  listMemories(scope: string): MemoryRecord[];
  putMemory(memory: MemoryRecord): void;
  deleteMemory(scope: string, id: string): boolean;
  clearMemories(scope: string): number;
  close(): void;
}

interface TaskExecutionRow {
  agent_id: string;
  task_id: string;
  assignment_id: string;
  room_id: string;
  thread_id: string;
  dispatch_message_id: string;
  state: TaskExecutionState;
}

interface TaskCallbackRow {
  agent_id: string;
  task_id: string;
  assignment_id: string;
  sequence: number;
  command: TaskCallbackCommand;
  idempotency_key: string;
  payload: string;
}

interface MemoryRow {
  memory_id: string;
  scope: string;
  content: string;
  kind: MemoryKind;
  importance: number;
  metadata: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
}

function taskExecutionFromRow(row: TaskExecutionRow): TaskExecutionRecord {
  return {
    agentId: row.agent_id,
    taskId: row.task_id,
    assignmentId: row.assignment_id,
    roomId: row.room_id,
    threadId: row.thread_id,
    dispatchMessageId: row.dispatch_message_id,
    state: row.state,
  };
}

function taskCallbackFromRow(row: TaskCallbackRow): TaskCallbackRecord {
  return {
    agentId: row.agent_id,
    taskId: row.task_id,
    assignmentId: row.assignment_id,
    sequence: row.sequence,
    command: row.command,
    idempotencyKey: row.idempotency_key,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
  };
}

function memoryFromRow(row: MemoryRow): MemoryRecord {
  return {
    id: row.memory_id,
    scope: row.scope,
    content: row.content,
    kind: row.kind,
    importance: row.importance,
    ...(row.metadata === null
      ? {}
      : { metadata: JSON.parse(row.metadata) as MemoryMetadata }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.expires_at === null ? {} : { expiresAt: row.expires_at }),
  };
}

export function createStateStore(dbPath: string): GatewayStateStore {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS watermarks (
      agent_id TEXT NOT NULL,
      room_id TEXT NOT NULL,
      last_timestamp TEXT NOT NULL,
      last_message_id TEXT NOT NULL,
      PRIMARY KEY (agent_id, room_id)
    );
    CREATE TABLE IF NOT EXISTS thread_rooms (
      thread_id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      agent_id TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS task_executions (
      agent_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      assignment_id TEXT NOT NULL,
      room_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      dispatch_message_id TEXT NOT NULL,
      state TEXT NOT NULL,
      PRIMARY KEY (agent_id, task_id)
    );
    CREATE TABLE IF NOT EXISTS processed_task_messages (
      agent_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      PRIMARY KEY (agent_id, message_id)
    );
    CREATE TABLE IF NOT EXISTS task_callbacks (
      idempotency_key TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      assignment_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      command TEXT NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS task_callbacks_agent_sequence
      ON task_callbacks (agent_id, sequence, idempotency_key);
    CREATE TABLE IF NOT EXISTS agent_memories (
      scope TEXT NOT NULL,
      memory_id TEXT NOT NULL,
      content TEXT NOT NULL,
      kind TEXT NOT NULL,
      importance REAL NOT NULL,
      metadata TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      expires_at TEXT,
      PRIMARY KEY (scope, memory_id)
    );
    CREATE INDEX IF NOT EXISTS agent_memories_scope_updated
      ON agent_memories (scope, updated_at DESC, memory_id);
  `);

  const getStmt = db.prepare(
    'SELECT last_timestamp, last_message_id FROM watermarks WHERE agent_id = ? AND room_id = ?'
  );
  const upsertStmt = db.prepare(
    `INSERT INTO watermarks (agent_id, room_id, last_timestamp, last_message_id)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (agent_id, room_id) DO UPDATE SET
       last_timestamp = excluded.last_timestamp,
       last_message_id = excluded.last_message_id`
  );
  const threadRoomStmt = db.prepare(
    'INSERT OR IGNORE INTO thread_rooms (thread_id, room_id, agent_id) VALUES (?, ?, ?)'
  );
  const getTaskExecutionStmt = db.prepare(
    `SELECT agent_id, task_id, assignment_id, room_id, thread_id, dispatch_message_id, state
     FROM task_executions WHERE agent_id = ? AND task_id = ?`,
  );
  const insertTaskExecutionStmt = db.prepare(
    `INSERT INTO task_executions
       (agent_id, task_id, assignment_id, room_id, thread_id, dispatch_message_id, state)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const replaceTaskExecutionStmt = db.prepare(
    `UPDATE task_executions SET
       assignment_id = ?, room_id = ?, thread_id = ?, dispatch_message_id = ?, state = ?
     WHERE agent_id = ? AND task_id = ?`,
  );
  const listActiveTaskExecutionsStmt = db.prepare(
    `SELECT agent_id, task_id, assignment_id, room_id, thread_id, dispatch_message_id, state
     FROM task_executions
     WHERE agent_id = ? AND state IN ('active', 'blocked')
     ORDER BY task_id`,
  );
  const listTaskExecutionsStmt = db.prepare(
    `SELECT agent_id, task_id, assignment_id, room_id, thread_id, dispatch_message_id, state
     FROM task_executions WHERE agent_id = ? ORDER BY task_id`,
  );
  const updateTaskExecutionStateStmt = db.prepare(
    `UPDATE task_executions SET state = ?
     WHERE agent_id = ? AND task_id = ? AND assignment_id = ?`,
  );
  const markTaskMessageProcessedStmt = db.prepare(
    'INSERT OR IGNORE INTO processed_task_messages (agent_id, message_id) VALUES (?, ?)',
  );
  const enqueueTaskCallbackStmt = db.prepare(
    `INSERT OR IGNORE INTO task_callbacks
       (idempotency_key, agent_id, task_id, assignment_id, sequence, command, payload)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const listPendingTaskCallbacksStmt = db.prepare(
    `SELECT agent_id, task_id, assignment_id, sequence, command, idempotency_key, payload
     FROM task_callbacks WHERE agent_id = ? ORDER BY sequence, idempotency_key`,
  );
  const completeTaskCallbackStmt = db.prepare(
    'DELETE FROM task_callbacks WHERE idempotency_key = ?',
  );
  const listMemoriesStmt = db.prepare(
    `SELECT memory_id, scope, content, kind, importance, metadata, created_at, updated_at, expires_at
     FROM agent_memories WHERE scope = ? ORDER BY updated_at DESC, created_at DESC, memory_id`,
  );
  const putMemoryStmt = db.prepare(
    `INSERT INTO agent_memories
       (scope, memory_id, content, kind, importance, metadata, created_at, updated_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (scope, memory_id) DO UPDATE SET
       content = excluded.content,
       kind = excluded.kind,
       importance = excluded.importance,
       metadata = excluded.metadata,
       updated_at = excluded.updated_at,
       expires_at = excluded.expires_at`,
  );
  const deleteMemoryStmt = db.prepare(
    'DELETE FROM agent_memories WHERE scope = ? AND memory_id = ?',
  );
  const clearMemoriesStmt = db.prepare('DELETE FROM agent_memories WHERE scope = ?');

  return {
    getWatermark(agentId, roomId) {
      const row = getStmt.get(agentId, roomId) as
        | { last_timestamp: string; last_message_id: string }
        | undefined;
      return row ? { lastTimestamp: row.last_timestamp, lastMessageId: row.last_message_id } : undefined;
    },
    setWatermark(agentId, roomId, watermark) {
      upsertStmt.run(agentId, roomId, watermark.lastTimestamp, watermark.lastMessageId);
    },
    setThreadRoom(threadId, roomId, agentId) {
      threadRoomStmt.run(threadId, roomId, agentId);
    },
    claimTaskExecution(record) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const existingRow = getTaskExecutionStmt.get(record.agentId, record.taskId) as
          | TaskExecutionRow
          | undefined;
        if (existingRow) {
          const existing = taskExecutionFromRow(existingRow);
          if (existing.assignmentId === record.assignmentId) {
            db.exec('COMMIT');
            return { record: existing, created: false };
          }
          replaceTaskExecutionStmt.run(
            record.assignmentId,
            record.roomId,
            record.threadId,
            record.dispatchMessageId,
            record.state,
            record.agentId,
            record.taskId,
          );
          db.exec('COMMIT');
          return { record, created: true };
        }
        insertTaskExecutionStmt.run(
          record.agentId,
          record.taskId,
          record.assignmentId,
          record.roomId,
          record.threadId,
          record.dispatchMessageId,
          record.state,
        );
        db.exec('COMMIT');
        return { record, created: true };
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    getTaskExecution(agentId, taskId) {
      const row = getTaskExecutionStmt.get(agentId, taskId) as TaskExecutionRow | undefined;
      return row ? taskExecutionFromRow(row) : undefined;
    },
    listTaskExecutions(agentId) {
      return (listTaskExecutionsStmt.all(agentId) as unknown as TaskExecutionRow[]).map(
        taskExecutionFromRow,
      );
    },
    listActiveTaskExecutions(agentId) {
      return (listActiveTaskExecutionsStmt.all(agentId) as unknown as TaskExecutionRow[]).map(
        taskExecutionFromRow,
      );
    },
    updateTaskExecutionState(agentId, taskId, assignmentId, state) {
      updateTaskExecutionStateStmt.run(state, agentId, taskId, assignmentId);
    },
    markTaskMessageProcessed(agentId, messageId) {
      return markTaskMessageProcessedStmt.run(agentId, messageId).changes > 0;
    },
    enqueueTaskCallback(callback) {
      return (
        enqueueTaskCallbackStmt.run(
          callback.idempotencyKey,
          callback.agentId,
          callback.taskId,
          callback.assignmentId,
          callback.sequence,
          callback.command,
          JSON.stringify(callback.payload),
        ).changes > 0
      );
    },
    listPendingTaskCallbacks(agentId) {
      return (listPendingTaskCallbacksStmt.all(agentId) as unknown as TaskCallbackRow[]).map(
        taskCallbackFromRow,
      );
    },
    completeTaskCallback(idempotencyKey) {
      completeTaskCallbackStmt.run(idempotencyKey);
    },
    listMemories(scope) {
      return (listMemoriesStmt.all(scope) as unknown as MemoryRow[]).map(memoryFromRow);
    },
    putMemory(memory) {
      putMemoryStmt.run(
        memory.scope,
        memory.id,
        memory.content,
        memory.kind,
        memory.importance,
        memory.metadata === undefined ? null : JSON.stringify(memory.metadata),
        memory.createdAt,
        memory.updatedAt,
        memory.expiresAt ?? null,
      );
    },
    deleteMemory(scope, id) {
      return deleteMemoryStmt.run(scope, id).changes > 0;
    },
    clearMemories(scope) {
      return Number(clearMemoriesStmt.run(scope).changes);
    },
    close() {
      db.close();
    },
  };
}
