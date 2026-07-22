import { describe, expect, it, vi } from 'vitest';
import { createRoomsApi } from '../rooms.js';
import type { OpcHttpClient } from '../http.js';

function createMockClient(): OpcHttpClient {
  return {
    axios: {} as unknown as OpcHttpClient['axios'],
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  };
}

describe('createRoomsApi', () => {
  it('creates a room', async () => {
    const client = createMockClient();
    vi.mocked(client.post).mockResolvedValue({ roomId: 'room-1' });

    const api = createRoomsApi(client);
    const result = await api.create('General', ['alice', 'bob']);

    expect(client.post).toHaveBeenCalledWith('/rooms', {
      name: 'General',
      participantIds: ['alice', 'bob'],
    });
    expect(result).toEqual({ roomId: 'room-1' });
  });

  it('lists rooms', async () => {
    const client = createMockClient();
    vi.mocked(client.get).mockResolvedValue({ rooms: [{ id: 'room-1', name: 'General' }] });

    const api = createRoomsApi(client);
    const result = await api.list();

    expect(client.get).toHaveBeenCalledWith('/rooms');
    expect(result.rooms).toHaveLength(1);
  });

  it('fetches room history', async () => {
    const client = createMockClient();
    vi.mocked(client.get).mockResolvedValue({ messages: [] });

    const api = createRoomsApi(client);
    const result = await api.history('room-1');

    expect(client.get).toHaveBeenCalledWith('/rooms/room-1/history');
    expect(result.messages).toEqual([]);
  });

  it('broadcasts a message and validates the response', async () => {
    const client = createMockClient();
    const message = {
      id: 'msg-1',
      roomId: 'room-1',
      from: 'system',
      content: { type: 'system', body: 'Group created' },
      timestamp: '2026-07-15T00:00:00.000Z',
    };
    vi.mocked(client.post).mockResolvedValue({ message });

    const api = createRoomsApi(client);
    const result = await api.broadcast('room-1', {
      content: { type: 'system', body: 'Group created' },
    });

    expect(client.post).toHaveBeenCalledWith('/rooms/room-1/broadcast', {
      content: { type: 'system', body: 'Group created' },
    });
    expect(result.message.content.type).toBe('system');
  });

  it('rejects an invalid broadcast response', async () => {
    const client = createMockClient();
    vi.mocked(client.post).mockResolvedValue({ message: { id: 'msg-1' } });

    const api = createRoomsApi(client);
    await expect(
      api.broadcast('room-1', { content: { type: 'text', body: 'hi' } }),
    ).rejects.toThrow();
  });

  it('creates a direct room and validates the response', async () => {
    const client = createMockClient();
    vi.mocked(client.post).mockResolvedValue({ roomId: 'dm-1' });

    const api = createRoomsApi(client);
    const result = await api.createDirect(['alice', 'bob']);

    expect(client.post).toHaveBeenCalledWith('/rooms/direct', {
      participantIds: ['alice', 'bob'],
    });
    expect(result).toEqual({ roomId: 'dm-1' });
  });

  it('rejects an invalid createDirect response', async () => {
    const client = createMockClient();
    vi.mocked(client.post).mockResolvedValue({ roomId: 123 });

    const api = createRoomsApi(client);
    await expect(api.createDirect(['alice', 'bob'])).rejects.toThrow();
  });
});
