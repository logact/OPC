import { describe, expect, it } from 'vitest';
import type { OpcClient } from '@logact-pub/opc-sdk';
import {
  connectSdkClient,
  createAuthenticatedHttpClient,
  registerParticipant,
  startTestServer,
  waitForEvent,
} from './helpers.js';

/**
 * Issue #104：消息 intent（'task' | 'question'）端到端测试。
 *
 * 覆盖 protocol → server 链路：
 * - MQTT uplink 携带 intent 时，message.delivered 事件与房间历史保留 intent；
 * - uplink 不带 intent 时行为不变（向后兼容）；
 * - HTTP broadcast（BroadcastMessageRequest.intent）落库后 history 可见 intent。
 *
 * 与仓库其他 e2e 一致，全部通过 @logact-pub/opc-sdk 驱动被测 server。
 * 假设的 SDK 形态（与 mobile useRoom 契约一致）：
 *   client.sendText(roomId, text, intent?)
 *   http.broadcastMessage(roomId, { content, intent? })
 */
describe('Message intent E2E (issue #104, via @logact-pub/opc-sdk)', () => {
  it('delivers uplink message with intent "task" to room subscribers', async () => {
    const { cleanup } = await startTestServer();
    let aliceClient: OpcClient | undefined;
    let bobClient: OpcClient | undefined;

    try {
      const http = await createAuthenticatedHttpClient();
      const aliceToken = await registerParticipant('intent-alice');
      const bobToken = await registerParticipant('intent-bob');
      const { roomId } = await http.createRoom({
        name: 'intent-task-room',
        participantIds: ['intent-alice', 'intent-bob'],
      });

      aliceClient = await connectSdkClient('intent-alice', aliceToken);
      bobClient = await connectSdkClient('intent-bob', bobToken);
      await bobClient.subscribeRoom(roomId);
      const delivered = waitForEvent(bobClient, 'message.delivered');

      await aliceClient.sendText(roomId, 'refactor the login flow', 'task');

      const event = await delivered;
      expect(event.message.from).toBe('intent-alice');
      expect(event.message.content.body).toBe('refactor the login flow');
      expect(event.message.intent).toBe('task');
    } finally {
      if (aliceClient) await aliceClient.disconnect();
      if (bobClient) await bobClient.disconnect();
      await cleanup();
    }
  });

  it('delivers uplink message with intent "question" to room subscribers', async () => {
    const { cleanup } = await startTestServer();
    let aliceClient: OpcClient | undefined;
    let bobClient: OpcClient | undefined;

    try {
      const http = await createAuthenticatedHttpClient();
      const aliceToken = await registerParticipant('intent-alice');
      const bobToken = await registerParticipant('intent-bob');
      const { roomId } = await http.createRoom({
        name: 'intent-question-room',
        participantIds: ['intent-alice', 'intent-bob'],
      });

      aliceClient = await connectSdkClient('intent-alice', aliceToken);
      bobClient = await connectSdkClient('intent-bob', bobToken);
      await bobClient.subscribeRoom(roomId);
      const delivered = waitForEvent(bobClient, 'message.delivered');

      await aliceClient.sendText(roomId, 'how does auth work?', 'question');

      const event = await delivered;
      expect(event.message.from).toBe('intent-alice');
      expect(event.message.content.body).toBe('how does auth work?');
      expect(event.message.intent).toBe('question');
    } finally {
      if (aliceClient) await aliceClient.disconnect();
      if (bobClient) await bobClient.disconnect();
      await cleanup();
    }
  });

  it('delivers uplink message without intent unchanged (backward compat)', async () => {
    const { cleanup } = await startTestServer();
    let aliceClient: OpcClient | undefined;
    let bobClient: OpcClient | undefined;

    try {
      const http = await createAuthenticatedHttpClient();
      const aliceToken = await registerParticipant('intent-alice');
      const bobToken = await registerParticipant('intent-bob');
      const { roomId } = await http.createRoom({
        name: 'intent-compat-room',
        participantIds: ['intent-alice', 'intent-bob'],
      });

      aliceClient = await connectSdkClient('intent-alice', aliceToken);
      bobClient = await connectSdkClient('intent-bob', bobToken);
      await bobClient.subscribeRoom(roomId);
      const delivered = waitForEvent(bobClient, 'message.delivered');

      await aliceClient.sendText(roomId, 'plain message');

      const event = await delivered;
      expect(event.message.content.body).toBe('plain message');
      expect(event.message.intent).toBeUndefined();
    } finally {
      if (aliceClient) await aliceClient.disconnect();
      if (bobClient) await bobClient.disconnect();
      await cleanup();
    }
  });

  it('persists HTTP broadcast with intent "task" and exposes it in room history', async () => {
    const { cleanup } = await startTestServer();

    try {
      const http = await createAuthenticatedHttpClient();
      await registerParticipant('intent-alice');
      const { roomId } = await http.createRoom({
        name: 'intent-broadcast-room',
        participantIds: ['intent-alice'],
      });

      await http.broadcastMessage(roomId, {
        content: { type: 'text', body: 'broadcast task' },
        intent: 'task',
      });

      // broadcast 由 server 同步落库（见 server.e2e.test.ts 的 Persistence 用例）
      const { messages: list } = await http.getHistory(roomId);
      const message = list.find((m) => m.content.body === 'broadcast task');
      expect(message).toBeDefined();
      expect(message?.intent).toBe('task');
    } finally {
      await cleanup();
    }
  });
});
