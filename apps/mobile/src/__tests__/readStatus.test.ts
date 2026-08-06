import type { Message } from '@opc/api-client';
import { messageTimestamp, otherMemberIds, readBreakdown } from '../utils/readStatus';

function msg(timestamp: string): Message {
  return {
    id: 'm-1',
    roomId: 'room-1',
    from: 'me',
    content: { type: 'text', body: 'hi' },
    timestamp,
  };
}

describe('messageTimestamp', () => {
  it('returns the wire timestamp field', () => {
    expect(messageTimestamp(msg('2026-08-05T12:00:00.000Z'))).toBe('2026-08-05T12:00:00.000Z');
  });
});

describe('otherMemberIds', () => {
  it('excludes self and keeps order', () => {
    expect(otherMemberIds(['a', 'me', 'b'], 'me')).toEqual(['a', 'b']);
  });
});

describe('readBreakdown (issue #108)', () => {
  const others = ['a', 'b', 'c'];

  it('counts members whose cursor >= message timestamp as read', () => {
    const result = readBreakdown('2026-08-05T12:00:00.000Z', others, {
      a: '2026-08-05T12:00:00.000Z', // 等于消息时间戳 → 已读
      b: '2026-08-05T11:59:00.000Z', // 早于消息 → 未读
      c: '2026-08-05T12:01:00.000Z', // 晚于消息 → 已读
    });
    expect(result.read).toEqual(['a', 'c']);
    expect(result.unread).toEqual(['b']);
  });

  it('treats null cursors (never read) and missing members as unread', () => {
    const result = readBreakdown('2026-08-05T12:00:00.000Z', others, {
      a: null,
      b: '2026-08-05T13:00:00.000Z',
      // c 不在 read-state 返回中
    });
    expect(result.read).toEqual(['b']);
    expect(result.unread).toEqual(['a', 'c']);
  });

  it('returns all unread when there are no cursors at all', () => {
    const result = readBreakdown('2026-08-05T12:00:00.000Z', others, {});
    expect(result.read).toEqual([]);
    expect(result.unread).toEqual(others);
  });
});
