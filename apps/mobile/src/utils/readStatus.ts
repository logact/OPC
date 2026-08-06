import type { Message } from '@opc/api-client';

/**
 * 已读状态推导（issue #108）。
 *
 * 游标语义：participant P 读过消息 M 当且仅当 P.lastReadAt >= M 的 server
 * 时间戳；游标为 null（从未读过）一律算未读。时间戳均为 server 打的 ISO
 * 字符串，字典序比较即可。
 */

/**
 * 消息的 server 时间戳。wire 字段是 `timestamp`（protocol MessageSchema），
 * mobile 本地遗留 Message 类型写作 `createdAt`，两者都兜底。
 */
export function messageTimestamp(message: Message): string | undefined {
  const wire = message as unknown as { timestamp?: string };
  return wire.timestamp ?? message.createdAt;
}

/** 房间内除自己以外的其他成员 id 列表（保持 room.participantIds 顺序）。 */
export function otherMemberIds(memberIds: string[], selfId: string): string[] {
  return memberIds.filter((id) => id !== selfId);
}

export interface ReadBreakdown {
  /** 其他成员中已读到该消息的 id */
  read: string[];
  /** 其他成员中未读到该消息的 id */
  unread: string[];
}

/**
 * 对一条自己发出的消息，按其他成员的已读游标划分已读/未读。
 * cursors 为 roomId 作用域内 participantId → lastReadAt（null 表示从未读过）；
 * 游标缺失的成员按未读处理。
 */
export function readBreakdown(
  messageTs: string,
  others: string[],
  cursors: Record<string, string | null>,
): ReadBreakdown {
  const read: string[] = [];
  const unread: string[] = [];
  for (const id of others) {
    const cursor = cursors[id];
    if (cursor != null && cursor >= messageTs) {
      read.push(id);
    } else {
      unread.push(id);
    }
  }
  return { read, unread };
}
