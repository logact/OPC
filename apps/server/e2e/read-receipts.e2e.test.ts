import { describe, expect, it } from 'vitest';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  connectSdkClient,
  createHttpClient,
  registerParticipant,
  startTestServer,
  waitForEvent,
} from './helpers.js';

/**
 * 消息已读/未读状态（issue #108）e2e。
 * 全部通过 @logact-pub/opc-sdk 驱动：OpcClient.markRoomRead 向 reads topic
 * 发布回执，OpcHttpClient.getRoomReadState 读取已读游标。
 *
 * 语义：per-room 已读游标，消息 timestamp <= lastReadAt 即视为已读；
 * 游标单调递增、更新幂等，未推进的回执不广播 read.updated。
 */

const POLL_TIMEOUT_MS = 10000;
const POLL_INTERVAL_MS = 200;

/** 轮询直到条件满足（PUBACK 只代表 broker 收到，server bridge 落库有额外延迟） */
async function waitFor(condition: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  for (;;) {
    if (await condition()) return;
    if (Date.now() > deadline) throw new Error('waitFor: condition not met before timeout');
    await sleep(POLL_INTERVAL_MS);
  }
}
describe('Read receipts E2E (issue #108)', () => {
  it('persists a read receipt and fans out read.updated to room members', async () => {
    const { cleanup } = await startTestServer();

    const alice = 'rr-alice';
    const bob = 'rr-bob';
    try {
      const tokenA = await registerParticipant(alice);
      const tokenB = await registerParticipant(bob);
      const http = createHttpClient();
      http.setAccessToken(tokenA);
      const { roomId } = await http.createRoom({
        name: 'read-receipts',
        participantIds: [alice, bob],
      });

      const clientA = await connectSdkClient(alice, tokenA);
      const clientB = await connectSdkClient(bob, tokenB);
      try {
        await clientA.subscribeRoom(roomId);

        const readUpdated = waitForEvent(clientA, 'read.updated');
        // lastReadAt 取服务端消息时间戳；e2e 中用一个合法 ISO 时间戳即可
        const lastReadAt = new Date().toISOString();
        await clientB.markRoomRead(roomId, lastReadAt);

        const event = await readUpdated;
        expect(event).toEqual({
          type: 'read.updated',
          roomId,
          participantId: bob,
          lastReadAt,
        });
      } finally {
        await clientA.disconnect();
        await clientB.disconnect();
      }
    } finally {
      await cleanup();
    }
  });

  it('GET read-state returns cursors for all members, null for those who never read', async () => {
    const { cleanup } = await startTestServer();

    const alice = 'rs-alice';
    const bob = 'rs-bob';
    try {
      const tokenA = await registerParticipant(alice);
      const tokenB = await registerParticipant(bob);
      const http = createHttpClient();
      http.setAccessToken(tokenA);
      const { roomId } = await http.createRoom({
        name: 'read-state',
        participantIds: [alice, bob],
      });

      // 初始：两位成员都从未读过
      const initial = await http.getRoomReadState(roomId);
      expect(initial.reads).toHaveLength(2);
      expect(initial.reads).toContainEqual({ participantId: alice, lastReadAt: null });
      expect(initial.reads).toContainEqual({ participantId: bob, lastReadAt: null });

      const clientB = await connectSdkClient(bob, tokenB);
      try {
        const lastReadAt = new Date().toISOString();
        await clientB.markRoomRead(roomId, lastReadAt);

        await waitFor(async () => {
          const state = await http.getRoomReadState(roomId);
          return state.reads.some((r) => r.participantId === bob && r.lastReadAt === lastReadAt);
        });

        const state = await http.getRoomReadState(roomId);
        expect(state.reads).toContainEqual({ participantId: bob, lastReadAt });
        expect(state.reads).toContainEqual({ participantId: alice, lastReadAt: null });
      } finally {
        await clientB.disconnect();
      }
    } finally {
      await cleanup();
    }
  });

  it('keeps the cursor monotonic: an older receipt does not regress the cursor', async () => {
    const { cleanup } = await startTestServer();

    const alice = 'mono-alice';
    const bob = 'mono-bob';
    try {
      const tokenA = await registerParticipant(alice);
      const tokenB = await registerParticipant(bob);
      const http = createHttpClient();
      http.setAccessToken(tokenA);
      const { roomId } = await http.createRoom({
        name: 'read-monotonic',
        participantIds: [alice, bob],
      });

      const clientB = await connectSdkClient(bob, tokenB);
      try {
        const newer = new Date().toISOString();
        const older = new Date(Date.now() - 60_000).toISOString();
        await clientB.markRoomRead(roomId, newer);
        await clientB.markRoomRead(roomId, older);

        await waitFor(async () => {
          const state = await http.getRoomReadState(roomId);
          return state.reads.some((r) => r.participantId === bob && r.lastReadAt === newer);
        });

        const state = await http.getRoomReadState(roomId);
        expect(state.reads).toContainEqual({ participantId: bob, lastReadAt: newer });
      } finally {
        await clientB.disconnect();
      }
    } finally {
      await cleanup();
    }
  });
});
