import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * 某 agent 在某房间内已处理消息的水位（issue #84 离线补投）。
 * 语义：timestamp 严格小于 lastTimestamp、或同 timestamp 且 id 相同的
 * 消息视为已处理，补投/去重时跳过。
 */
export interface Watermark {
  lastTimestamp: string;
  lastMessageId: string;
}

/**
 * gateway 本地状态存储（SQLite，node:sqlite 内置模块，零外部依赖）：
 * - watermarks：per-agent-per-room 消息水位，重连/重启后按水位增量拉历史，
 *   并对 broker 离线队列与 HTTP 拉取的重叠消息幂等去重；
 * - thread_rooms：thread → room 映射的持久化副本（内存 threadRoomMap 的
 *   落盘备份，进程重启后仅供诊断/清理，runtime thread 本身不可恢复）。
 */
export interface GatewayStateStore {
  getWatermark(agentId: string, roomId: string): Watermark | undefined;
  setWatermark(agentId: string, roomId: string, watermark: Watermark): void;
  setThreadRoom(threadId: string, roomId: string, agentId: string): void;
  close(): void;
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
    close() {
      db.close();
    },
  };
}
