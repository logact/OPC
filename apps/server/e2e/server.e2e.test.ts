import { describe, expect, it } from 'vitest';
import {
  createDbClient,
  createMessageRepository,
  createParticipantRepository,
  createRoomRepository,
} from '@opc/database';
import { OpcClient } from '@logact-pub/opc-sdk';
import {
  connectSdkClient,
  createAuthenticatedHttpClient,
  createHttpClient,
  registerParticipant,
  startTestServer,
  TEST_BASE_URL,
  TEST_MQTT,
  waitForEvent,
} from './helpers.js';

/**
 * 功能测试全部以 @logact-pub/opc-sdk 为入口：管理面走 OpcHttpClient,
 * 实时面走 OpcClient（MQTT）。wire 级 schema 校验见 contract.test.ts。
 */
describe('OPC Server E2E (via @logact-pub/opc-sdk)', () => {
  describe('Participants', () => {
    it('registers participant and returns token', async () => {
      const { cleanup } = await startTestServer();

      try {
        const http = createHttpClient();
        const { token } = await http.registerParticipant('user-1');
        expect(token).toMatch(/^[0-9a-f]{64}$/);

        const authHttp = await createAuthenticatedHttpClient();
        const { participant } = await authHttp.getParticipant('user-1');
        expect(participant.id).toBe('user-1');
      } finally {
        await cleanup();
      }
    });

    it('lists all participants', async () => {
      const { cleanup } = await startTestServer();

      try {
        const http = await createAuthenticatedHttpClient();
        await http.registerParticipant('alice');
        await http.registerParticipant('bob');

        const { participants: list } = await http.listParticipants();
        expect(list.map((p) => p.id)).toEqual(expect.arrayContaining(['alice', 'bob']));
      } finally {
        await cleanup();
      }
    });

    it('fails for unknown participant', async () => {
      const { cleanup } = await startTestServer();

      try {
        const http = await createAuthenticatedHttpClient();
        await expect(http.getParticipant('nobody')).rejects.toThrow(
          'getParticipant failed: 404'
        );
      } finally {
        await cleanup();
      }
    });
  });

  describe('Rooms', () => {
    it('creates and retrieves a room', async () => {
      const { cleanup } = await startTestServer();

      try {
        const http = await createAuthenticatedHttpClient();
        const { roomId } = await http.createRoom({
          name: 'e2e-room',
          participantIds: ['user-1'],
        });

        const { room } = await http.getRoom(roomId);
        expect(room.id).toBe(roomId);
        expect(room.name).toBe('e2e-room');
        expect(room.participantIds).toContain('user-1');
      } finally {
        await cleanup();
      }
    });

    it('lists all rooms with member info', async () => {
      const { cleanup } = await startTestServer();

      try {
        const http = await createAuthenticatedHttpClient();
        const { roomId } = await http.createRoom({
          name: 'list-room',
          participantIds: ['alice'],
        });

        const { rooms: list } = await http.listRooms();
        const room = list.find((r) => r.id === roomId);
        expect(room).toBeDefined();
        expect(room?.participantIds).toContain('alice');
      } finally {
        await cleanup();
      }
    });

    it('creates an empty room', async () => {
      const { cleanup } = await startTestServer();

      try {
        const http = await createAuthenticatedHttpClient();
        const { roomId } = await http.createRoom({ name: 'empty-room', participantIds: [] });

        const { room } = await http.getRoom(roomId);
        expect(room.participantIds).toEqual([]);
      } finally {
        await cleanup();
      }
    });

    it('fails for unknown room', async () => {
      const { cleanup } = await startTestServer();

      try {
        const http = await createAuthenticatedHttpClient();
        await expect(http.getRoom('unknown')).rejects.toThrow('getRoom failed: 404');
      } finally {
        await cleanup();
      }
    });
  });

  describe('Room members', () => {
    it('adds members to a room', async () => {
      const { cleanup } = await startTestServer();

      try {
        const http = await createAuthenticatedHttpClient();
        const { roomId } = await http.createRoom({
          name: 'invite-room',
          participantIds: ['alice'],
        });

        const { room } = await http.addRoomMembers(roomId, { participantIds: ['bob'] });
        expect(room.participantIds).toEqual(expect.arrayContaining(['alice', 'bob']));
      } finally {
        await cleanup();
      }
    });

    it('fails when adding members to unknown room', async () => {
      const { cleanup } = await startTestServer();

      try {
        const http = await createAuthenticatedHttpClient();
        await expect(http.addRoomMembers('unknown', { participantIds: ['bob'] })).rejects.toThrow(
          'addRoomMembers failed: 404'
        );
      } finally {
        await cleanup();
      }
    });

    it('emits participant.joined only for new members', async () => {
      const { cleanup } = await startTestServer();
      let aliceClient: OpcClient | undefined;

      try {
        const http = await createAuthenticatedHttpClient();
        const aliceToken = await registerParticipant('alice');
        await registerParticipant('bob');
        const { roomId } = await http.createRoom({
          name: 'join-event-room',
          participantIds: ['alice'],
        });

        aliceClient = await connectSdkClient('alice', aliceToken);
        await aliceClient.subscribeRoom(roomId);

        // 重复添加已存在成员，不应收到 joined 事件
        await http.addRoomMembers(roomId, { participantIds: ['alice'] });

        const joinEventPromise = waitForEvent(aliceClient, 'participant.joined');
        await http.addRoomMembers(roomId, { participantIds: ['bob'] });

        const event = await joinEventPromise;
        expect(event.participant.id).toBe('bob');
      } finally {
        if (aliceClient) await aliceClient.disconnect();
        await cleanup();
      }
    });

    it('invited member can subscribe and receive messages', async () => {
      const { cleanup } = await startTestServer();
      let aliceClient: OpcClient | undefined;
      let bobClient: OpcClient | undefined;

      try {
        const http = await createAuthenticatedHttpClient();
        const aliceToken = await registerParticipant('alice');
        const bobToken = await registerParticipant('bob');
        const { roomId } = await http.createRoom({
          name: 'invite-msg-room',
          participantIds: ['alice'],
        });

        aliceClient = await connectSdkClient('alice', aliceToken);
        bobClient = await connectSdkClient('bob', bobToken);

        await http.addRoomMembers(roomId, { participantIds: ['bob'] });

        await aliceClient.subscribeRoom(roomId);
        await bobClient.subscribeRoom(roomId);
        const bobMessage = waitForEvent(bobClient, 'message.delivered');

        await aliceClient.sendText(roomId, 'welcome bob');

        const delivered = await bobMessage;
        expect(delivered.message.content.body).toBe('welcome bob');
      } finally {
        if (aliceClient) await aliceClient.disconnect();
        if (bobClient) await bobClient.disconnect();
        await cleanup();
      }
    });
  });

  describe('Direct messages', () => {
    it('creates a direct room', async () => {
      const { cleanup } = await startTestServer();

      try {
        const http = await createAuthenticatedHttpClient();
        await http.registerParticipant('alice');
        await http.registerParticipant('bob');

        const { roomId } = await http.createDirectRoom({
          participantIds: ['alice', 'bob'],
        });
        expect(roomId).toBeDefined();

        const { room } = await http.getRoom(roomId);
        expect(room.participantIds).toEqual(expect.arrayContaining(['alice', 'bob']));
        expect(room.metadata?.type).toBe('direct');
      } finally {
        await cleanup();
      }
    });

    it('reuses existing direct room regardless of participant order', async () => {
      const { cleanup } = await startTestServer();

      try {
        const http = await createAuthenticatedHttpClient();
        await http.registerParticipant('alice');
        await http.registerParticipant('bob');

        const { roomId: firstRoomId } = await http.createDirectRoom({
          participantIds: ['alice', 'bob'],
        });
        const { roomId: secondRoomId } = await http.createDirectRoom({
          participantIds: ['bob', 'alice'],
        });

        expect(secondRoomId).toBe(firstRoomId);
      } finally {
        await cleanup();
      }
    });

    it('auto-creates missing participants when creating direct room', async () => {
      const { cleanup } = await startTestServer();

      try {
        const http = await createAuthenticatedHttpClient();
        await http.createDirectRoom({ participantIds: ['new-user-a', 'new-user-b'] });

        await expect(http.getParticipant('new-user-a')).resolves.toBeDefined();
        await expect(http.getParticipant('new-user-b')).resolves.toBeDefined();
      } finally {
        await cleanup();
      }
    });

    it('exchanges direct messages via sendDirectMessage', async () => {
      const { cleanup } = await startTestServer();
      let aliceClient: OpcClient | undefined;
      let bobClient: OpcClient | undefined;

      try {
        const http = await createAuthenticatedHttpClient();
        const aliceToken = await registerParticipant('alice');
        const bobToken = await registerParticipant('bob');

        // bob 先建好单聊房间并订阅事件；alice 的 sendDirectMessage 会复用该房间
        const { roomId } = await http.createDirectRoom({
          participantIds: ['bob', 'alice'],
        });

        bobClient = await connectSdkClient('bob', bobToken);
        await bobClient.subscribeRoom(roomId);
        aliceClient = await connectSdkClient('alice', aliceToken);
        const bobMessage = waitForEvent(bobClient, 'message.delivered');

        await aliceClient.sendDirectMessage('bob', 'direct hello');

        const event = await bobMessage;
        expect(event.message.roomId).toBe(roomId);
        expect(event.message.from).toBe('alice');
        expect(event.message.content.body).toBe('direct hello');
      } finally {
        if (aliceClient) await aliceClient.disconnect();
        if (bobClient) await bobClient.disconnect();
        await cleanup();
      }
    });
  });

  describe('Messaging and broadcast', () => {
    it('exchanges room messages via MQTT', async () => {
      const { cleanup } = await startTestServer();
      let client: OpcClient | undefined;

      try {
        const http = await createAuthenticatedHttpClient();
        const token = await registerParticipant('alice');
        const { roomId } = await http.createRoom({
          name: 'mqtt-room',
          participantIds: ['alice'],
        });

        client = await connectSdkClient('alice', token);
        await client.subscribeRoom(roomId);
        const delivered = waitForEvent(client, 'message.delivered');

        await client.sendText(roomId, 'hello e2e');

        const event = await delivered;
        expect(event.message.content.body).toBe('hello e2e');
      } finally {
        if (client) await client.disconnect();
        await cleanup();
      }
    });

    it('persists messages in room history', async () => {
      const { cleanup } = await startTestServer();
      let client: OpcClient | undefined;

      try {
        const http = await createAuthenticatedHttpClient();
        const token = await registerParticipant('alice');
        const { roomId } = await http.createRoom({
          name: 'history-room',
          participantIds: ['alice'],
        });

        client = await connectSdkClient('alice', token);
        await client.subscribeRoom(roomId);
        const delivered = waitForEvent(client, 'message.delivered');

        await client.sendText(roomId, 'history hello');

        // mqtt-bridge 先落库再发布事件，收到 delivered 即保证已入库
        await delivered;

        const { messages: list } = await http.getHistory(roomId);
        expect(list.some((m) => m.content.body === 'history hello')).toBe(true);
      } finally {
        if (client) await client.disconnect();
        await cleanup();
      }
    });

    it('broadcasts messages via HTTP', async () => {
      const { cleanup } = await startTestServer();
      let client: OpcClient | undefined;

      try {
        const http = await createAuthenticatedHttpClient();
        const token = await registerParticipant('alice');
        const { roomId } = await http.createRoom({
          name: 'broadcast-room',
          participantIds: ['alice'],
        });

        client = await connectSdkClient('alice', token);
        await client.subscribeRoom(roomId);
        const delivered = waitForEvent(client, 'message.delivered');

        await http.broadcastMessage(roomId, {
          content: { type: 'text', body: 'broadcast hello' },
        });

        const event = await delivered;
        expect(event.message.from).toBe('system');
        expect(event.message.content.body).toBe('broadcast hello');
      } finally {
        if (client) await client.disconnect();
        await cleanup();
      }
    });

    it('fails when broadcasting to unknown room', async () => {
      const { cleanup } = await startTestServer();

      try {
        const http = await createAuthenticatedHttpClient();
        await expect(
          http.broadcastMessage('unknown', {
            content: { type: 'text', body: 'nobody home' },
          })
        ).rejects.toThrow('broadcastMessage failed: 404');
      } finally {
        await cleanup();
      }
    });
  });

  describe('Security and ACL', () => {
    it('rejects invalid credentials at connect', async () => {
      const { cleanup } = await startTestServer();

      const client = new OpcClient({
        baseUrl: TEST_BASE_URL,
        brokerUrl: TEST_MQTT.brokerUrl,
        participantId: 'alice',
        token: 'wrong-token',
      });

      try {
        await expect(client.connect()).rejects.toThrow();
      } finally {
        await client.disconnect();
        await cleanup();
      }
    });

    it('rejects non-member subscription at the broker', async () => {
      const { cleanup } = await startTestServer();
      let eveClient: OpcClient | undefined;

      try {
        const http = await createAuthenticatedHttpClient();
        await registerParticipant('alice');
        const eveToken = await registerParticipant('eve');
        const { roomId } = await http.createRoom({
          name: 'private-room',
          participantIds: ['alice'],
        });

        eveClient = await connectSdkClient('eve', eveToken);
        await expect(eveClient.subscribeRoom(roomId)).rejects.toThrow();
      } finally {
        if (eveClient) await eveClient.disconnect();
        await cleanup();
      }
    });

    it('rejects non-member uplink publish at the broker', async () => {
      const { cleanup } = await startTestServer();
      let aliceClient: OpcClient | undefined;
      let eveClient: OpcClient | undefined;

      try {
        const http = await createAuthenticatedHttpClient();
        const aliceToken = await registerParticipant('alice');
        const eveToken = await registerParticipant('eve');
        const { roomId } = await http.createRoom({
          name: 'write-private-room',
          participantIds: ['alice'],
        });

        aliceClient = await connectSdkClient('alice', aliceToken);
        await aliceClient.subscribeRoom(roomId);
        let received = false;
        aliceClient.events.on('message.delivered', () => {
          received = true;
        });

        eveClient = await connectSdkClient('eve', eveToken);
        // 部分 broker 对 PUBLISH ACL 的拒绝表现为断开连接而非回调报错；
        // SDK 层以“消息确实没有被投递/落库”作为最终安全断言。
        await eveClient.sendText(roomId, 'should not deliver').catch(() => {});

        // 给 server 端桥接处理留一段窗口期
        await new Promise((resolve) => setTimeout(resolve, 500));
        expect(received).toBe(false);

        const { messages: list } = await http.getHistory(roomId);
        expect(list.some((m) => m.content.body === 'should not deliver')).toBe(false);
      } finally {
        if (aliceClient) await aliceClient.disconnect();
        if (eveClient) await eveClient.disconnect();
        await cleanup();
      }
    });
  });

  describe('Persistence', () => {
    it('persists participants, rooms, members and messages to PostgreSQL', async () => {
      const { cleanup } = await startTestServer();
      const databaseUrl = process.env.DATABASE_URL ?? 'postgres://opc:opc@localhost:5432/opc';
      const db = createDbClient(databaseUrl);

      try {
        const http = await createAuthenticatedHttpClient();
        const participantRepo = createParticipantRepository(db);
        const roomRepo = createRoomRepository(db);
        const messageRepo = createMessageRepository(db);

        await http.registerParticipant('persist-user');
        const { roomId } = await http.createRoom({
          name: 'persist-room',
          participantIds: ['persist-user'],
        });

        const participant = await participantRepo.findById('persist-user');
        expect(participant).toBeDefined();
        expect(participant?.name).toBe('persist-user');

        const room = await roomRepo.findById(roomId);
        expect(room).toBeDefined();
        expect(room?.name).toBe('persist-room');
        expect(room?.participantIds).toContain('persist-user');

        // 通过 HTTP 广播写入一条消息
        await http.broadcastMessage(roomId, {
          content: { type: 'text', body: 'persist message' },
        });

        const messageList = await messageRepo.findByRoomId(roomId);
        expect(messageList.some((m) => m.content.body === 'persist message')).toBe(true);
      } finally {
        await db.$client.end();
        await cleanup();
      }
    });
  });
});
