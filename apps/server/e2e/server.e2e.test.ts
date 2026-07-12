import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { API_ROUTES } from '@opc/protocol';
import { startTestServer } from './helpers.js';

describe('OPC Server E2E', () => {
  it('creates and lists rooms via HTTP', async () => {
    const { baseUrl, cleanup } = await startTestServer();

    try {
      const createRes = await fetch(`${baseUrl}${API_ROUTES.rooms}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'e2e-room', participantIds: ['user-1'] }),
      });
      expect(createRes.ok).toBe(true);
      const { roomId } = (await createRes.json()) as { roomId: string };
      expect(roomId).toBeDefined();

      const listRes = await fetch(`${baseUrl}${API_ROUTES.rooms}`);
      expect(listRes.ok).toBe(true);
      const { rooms } = (await listRes.json()) as { rooms: { id: string; name: string }[] };
      expect(rooms.some((r) => r.id === roomId && r.name === 'e2e-room')).toBe(true);

      const historyRes = await fetch(`${baseUrl}${API_ROUTES.roomHistory(roomId)}`);
      expect(historyRes.ok).toBe(true);
      const { messages } = (await historyRes.json()) as { messages: unknown[] };
      expect(messages).toEqual([]);
    } finally {
      await cleanup();
    }
  });

  it('exchanges messages via WebSocket', async () => {
    const { baseUrl, cleanup } = await startTestServer();

    try {
      const createRes = await fetch(`${baseUrl}${API_ROUTES.rooms}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'ws-room', participantIds: ['user-1'] }),
      });
      const { roomId } = (await createRes.json()) as { roomId: string };

      const wsUrl = baseUrl.replace(/^http/, 'ws') + API_ROUTES.ws;
      const ws = new WebSocket(wsUrl);

      await new Promise<void>((resolve, reject) => {
        ws.once('open', resolve);
        ws.once('error', reject);
      });

      const authenticated = new Promise<string>((resolve) => {
        ws.once('message', (raw) => {
          const text = Array.isArray(raw)
            ? Buffer.concat(raw).toString('utf8')
            : Buffer.isBuffer(raw)
              ? raw.toString('utf8')
              : Buffer.from(raw).toString('utf8');
          const frame = JSON.parse(text) as { type: string; participantId?: string };
          if (frame.type === 'authenticated' && frame.participantId) {
            resolve(frame.participantId);
          }
        });
      });

      ws.send(JSON.stringify({ type: 'auth', token: 'user-1' }));
      const participantId = await authenticated;
      expect(participantId).toBe('user-1');

      ws.send(JSON.stringify({ type: 'room.subscribe', roomId }));

      const delivered = new Promise<unknown>((resolve) => {
        ws.on('message', (raw) => {
          const text = Array.isArray(raw)
            ? Buffer.concat(raw).toString('utf8')
            : Buffer.isBuffer(raw)
              ? raw.toString('utf8')
              : Buffer.from(raw).toString('utf8');
          const frame = JSON.parse(text) as { type: string; event?: { type: string; message?: { content: { body: string } } } };
          if (frame.type === 'event' && frame.event?.type === 'message.delivered') {
            resolve(frame.event.message);
          }
        });
      });

      ws.send(
        JSON.stringify({
          type: 'message.send',
          roomId,
          content: { type: 'text', body: 'hello e2e' },
        }),
      );

      const message = (await delivered) as { content: { body: string } };
      expect(message.content.body).toBe('hello e2e');

      ws.close();
    } finally {
      await cleanup();
    }
  });
});
