import { describe, expect, it, vi } from 'vitest';
import { OpcHttpClient } from './http.js';

describe('OpcHttpClient', () => {
  const baseUrl = 'http://localhost:3000';

  it('creates a room via POST', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ roomId: 'room-1' }),
    });
    globalThis.fetch = fetchMock;

    const client = new OpcHttpClient(baseUrl);
    const result = await client.createRoom({ name: 'general' });

    expect(fetchMock).toHaveBeenCalledWith(
      `${baseUrl}/api/v1/rooms`,
      expect.objectContaining({ method: 'POST' }),
    );
    expect(result).toEqual({ roomId: 'room-1' });
  });

  it('throws when createRoom fails', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });

    const client = new OpcHttpClient(baseUrl);
    await expect(client.createRoom({ name: 'general' })).rejects.toThrow('createRoom failed: 500');
  });

  it('fetches a room by id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ room: { id: 'room-1', name: 'general', participantIds: [] } }),
    });
    globalThis.fetch = fetchMock;

    const client = new OpcHttpClient(baseUrl);
    const result = await client.getRoom('room-1');

    expect(fetchMock).toHaveBeenCalledWith(`${baseUrl}/api/v1/rooms/room-1`);
    expect(result.room.id).toBe('room-1');
  });

  it('updates a room', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ room: { id: 'room-1', name: 'updated' } }),
    });
    globalThis.fetch = fetchMock;

    const client = new OpcHttpClient(baseUrl);
    const result = await client.updateRoom('room-1', { name: 'updated' });

    expect(fetchMock).toHaveBeenCalledWith(
      `${baseUrl}/api/v1/rooms/room-1`,
      expect.objectContaining({ method: 'PATCH' })
    );
    expect(result.room.name).toBe('updated');
  });

  it('fetches a participant by id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ participant: { id: 'alice', kind: 'human', name: 'Alice' } }),
    });
    globalThis.fetch = fetchMock;

    const client = new OpcHttpClient(baseUrl);
    const result = await client.getParticipant('alice');

    expect(fetchMock).toHaveBeenCalledWith(`${baseUrl}/api/v1/participants/alice`);
    expect(result.participant.id).toBe('alice');
  });

  it('updates a participant', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ participant: { id: 'alice', kind: 'agent', name: 'Alice' } }),
    });
    globalThis.fetch = fetchMock;

    const client = new OpcHttpClient(baseUrl);
    const result = await client.updateParticipant('alice', { kind: 'agent' });

    expect(fetchMock).toHaveBeenCalledWith(
      `${baseUrl}/api/v1/participants/alice`,
      expect.objectContaining({ method: 'PATCH' })
    );
    expect(result.participant.kind).toBe('agent');
  });

  it('fetches a message by id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          message: {
            id: 'msg-1',
            roomId: 'room-1',
            from: 'alice',
            content: { type: 'text', body: 'hi' },
            timestamp: new Date().toISOString(),
          },
        }),
    });
    globalThis.fetch = fetchMock;

    const client = new OpcHttpClient(baseUrl);
    const result = await client.getMessage('msg-1');

    expect(fetchMock).toHaveBeenCalledWith(`${baseUrl}/api/v1/messages/msg-1`);
    expect(result.message.id).toBe('msg-1');
  });
});
