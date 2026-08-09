import { describe, expect, it } from 'vitest';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  connectSdkClient,
  createHttpClient,
  createAuthenticatedHttpClient,
  registerParticipant,
  startTestServer,
  waitForEvent,
} from './helpers.js';

const POLL_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 200;

async function waitFor(condition: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  for (;;) {
    if (await condition()) return;
    if (Date.now() > deadline) throw new Error('waitFor: condition not met before timeout');
    await sleep(POLL_INTERVAL_MS);
  }
}

/**
 * Issue #96: member-scoped conversation state is the source for mobile list
 * previews and unread badges. The test drives writes and reads through the
 * public SDK, matching the actual mobile/server contract.
 */
describe('Conversation state E2E (issue #96)', () => {
  it('reports the latest message and unread count, then clears after the member read receipt', async () => {
    const { cleanup } = await startTestServer();
    const alice = 'conversation-alice';
    const bob = 'conversation-bob';
    try {
      const aliceToken = await registerParticipant(alice);
      const bobToken = await registerParticipant(bob);
      const ownerHttp = await createAuthenticatedHttpClient();
      const { roomId } = await ownerHttp.createRoom({
        name: 'conversation-state',
        participantIds: [alice, bob],
      });

      const bobHttp = createHttpClient();
      bobHttp.setAccessToken((await bobHttp.login(bob, 'e2e-password')).accessToken);
      const aliceClient = await connectSdkClient(alice, aliceToken);
      const bobClient = await connectSdkClient(bob, bobToken);
      try {
        await bobClient.subscribeRoom(roomId);
        const delivered = waitForEvent(bobClient, 'message.delivered');
        await aliceClient.sendText(roomId, 'Unread for Bob');
        const event = await delivered;

        const beforeRead = await bobHttp.getParticipantRooms(bob);
        expect(beforeRead.rooms).toHaveLength(1);
        expect(beforeRead.rooms[0]).toMatchObject({
          id: roomId,
          unreadCount: 1,
          lastMessage: {
            id: event.message.id,
            from: alice,
            content: { type: 'text', body: 'Unread for Bob' },
            timestamp: event.message.timestamp,
          },
        });

        await bobClient.markRoomRead(roomId, event.message.timestamp);
        await waitFor(async () => {
          const afterRead = await bobHttp.getParticipantRooms(bob);
          return afterRead.rooms[0]?.unreadCount === 0;
        });

        const afterRead = await bobHttp.getParticipantRooms(bob);
        expect(afterRead.rooms[0]).toMatchObject({
          id: roomId,
          unreadCount: 0,
          lastMessage: { id: event.message.id },
        });
      } finally {
        await aliceClient.disconnect();
        await bobClient.disconnect();
      }
    } finally {
      await cleanup();
    }
  });
});
