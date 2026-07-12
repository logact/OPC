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
});
