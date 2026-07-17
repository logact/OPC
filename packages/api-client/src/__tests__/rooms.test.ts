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
});
