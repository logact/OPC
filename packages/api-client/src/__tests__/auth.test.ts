import { describe, expect, it, vi } from 'vitest';
import { createAuthApi } from '../auth.js';
import type { OpcHttpClient } from '../http.js';

function createMockClient(): OpcHttpClient {
  return {
    axios: {} as unknown as OpcHttpClient['axios'],
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  };
}

describe('createAuthApi', () => {
  it('logs in and validates the response', async () => {
    const client = createMockClient();
    const participant = { id: 'alice', kind: 'human', name: 'Alice' } as const;
    vi.mocked(client.post).mockResolvedValue({
      accessToken: 'jwt-token',
      participant,
    });

    const api = createAuthApi(client);
    const result = await api.login('alice', 'secret-password');

    expect(client.post).toHaveBeenCalledWith('/auth/login', {
      username: 'alice',
      password: 'secret-password',
    });
    expect(result).toEqual({ accessToken: 'jwt-token', participant });
  });

  it('rejects an invalid login response', async () => {
    const client = createMockClient();
    vi.mocked(client.post).mockResolvedValue({ participant: { id: 'alice' } });

    const api = createAuthApi(client);
    await expect(api.login('alice', 'secret-password')).rejects.toThrow();
  });
});
