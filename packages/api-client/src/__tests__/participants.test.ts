import { describe, expect, it, vi } from 'vitest';
import { createParticipantsApi } from '../participants.js';
import type { OpcHttpClient } from '../http.js';

function createMockClient(): OpcHttpClient {
  return {
    axios: {} as unknown as OpcHttpClient['axios'],
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  };
}

describe('createParticipantsApi', () => {
  it('registers a participant', async () => {
    const client = createMockClient();
    vi.mocked(client.post).mockResolvedValue({
      participantId: 'alice',
      token: 'secret-token',
    });

    const api = createParticipantsApi(client);
    const result = await api.register('alice', 'Alice');

    expect(client.post).toHaveBeenCalledWith('/participants', { id: 'alice', name: 'Alice' });
    expect(result).toEqual({ participantId: 'alice', token: 'secret-token' });
  });

  it('fetches a participant', async () => {
    const client = createMockClient();
    const participant = {
      id: 'alice',
      name: 'Alice',
      kind: 'human',
      metadata: null,
      createdAt: '2026-07-15T00:00:00.000Z',
      updatedAt: '2026-07-15T00:00:00.000Z',
    } as const;
    vi.mocked(client.get).mockResolvedValue({ participant });

    const api = createParticipantsApi(client);
    const result = await api.get('alice');

    expect(client.get).toHaveBeenCalledWith('/participants/alice');
    expect(result.participant).toEqual(participant);
  });
});
