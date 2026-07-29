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
    const result = await api.register('alice', { name: 'Alice' });

    expect(client.post).toHaveBeenCalledWith('/participants', { id: 'alice', name: 'Alice' });
    expect(result).toEqual({ participantId: 'alice', token: 'secret-token' });
  });

  it('registers an agent with kind, gatewayId and model', async () => {
    const client = createMockClient();
    vi.mocked(client.post).mockResolvedValue({
      participantId: 'review-bot',
      token: 'agent-token',
    });

    const api = createParticipantsApi(client);
    await api.register('review-bot', {
      name: 'Review Bot',
      kind: 'agent',
      gatewayId: 'gw-1',
      model: { provider: 'anthropic', modelId: 'claude-sonnet-4-5', apiKey: 'sk-test' },
    });

    expect(client.post).toHaveBeenCalledWith('/participants', {
      id: 'review-bot',
      name: 'Review Bot',
      kind: 'agent',
      gatewayId: 'gw-1',
      model: { provider: 'anthropic', modelId: 'claude-sonnet-4-5', apiKey: 'sk-test' },
    });
  });

  it('rejects an invalid register response', async () => {
    const client = createMockClient();
    vi.mocked(client.post).mockResolvedValue({ participantId: 'alice' });

    const api = createParticipantsApi(client);
    await expect(api.register('alice')).rejects.toThrow();
  });

  it('lists participants and validates the response', async () => {
    const client = createMockClient();
    vi.mocked(client.get).mockResolvedValue({
      participants: [{ id: 'alice', kind: 'human', name: 'Alice' }],
    });

    const api = createParticipantsApi(client);
    const result = await api.list();

    expect(client.get).toHaveBeenCalledWith('/participants');
    expect(result.participants).toHaveLength(1);
  });

  it('appends the kind query filter when listing', async () => {
    const client = createMockClient();
    vi.mocked(client.get).mockResolvedValue({
      participants: [{ id: 'gw-1', kind: 'gateway', name: 'Edge Gateway' }],
    });

    const api = createParticipantsApi(client);
    const result = await api.list({ kind: 'gateway' });

    expect(client.get).toHaveBeenCalledWith('/participants?kind=gateway');
    expect(result.participants[0]?.kind).toBe('gateway');
  });

  it('rejects an invalid list response', async () => {
    const client = createMockClient();
    vi.mocked(client.get).mockResolvedValue({ participants: [{ id: 'alice' }] });

    const api = createParticipantsApi(client);
    await expect(api.list()).rejects.toThrow();
  });

  it('fetches a participant', async () => {
    const client = createMockClient();
    // server 返回 protocol Participant 形状（无 createdAt/updatedAt）
    const participant = { id: 'alice', kind: 'human', name: 'Alice' } as const;
    vi.mocked(client.get).mockResolvedValue({ participant });

    const api = createParticipantsApi(client);
    const result = await api.get('alice');

    expect(client.get).toHaveBeenCalledWith('/participants/alice');
    expect(result.participant).toEqual(participant);
  });

  it('updates a participant with a model catalog and validates the response', async () => {
    const client = createMockClient();
    const modelCatalog = {
      providers: [
        { provider: 'moonshotai', models: [{ id: 'kimi-coding', name: 'Kimi for Coding' }] },
      ],
      updatedAt: '2026-07-29T00:00:00.000Z',
    };
    const participant = {
      id: 'gw-1',
      kind: 'gateway',
      name: 'Edge Gateway',
      metadata: { modelCatalog },
    };
    vi.mocked(client.patch).mockResolvedValue({ participant });

    const api = createParticipantsApi(client);
    const result = await api.update('gw-1', { modelCatalog });

    expect(client.patch).toHaveBeenCalledWith('/participants/gw-1', { modelCatalog });
    expect(result.participant.metadata?.modelCatalog).toEqual(modelCatalog);
  });

  it('rejects an invalid update response', async () => {
    const client = createMockClient();
    vi.mocked(client.patch).mockResolvedValue({ participant: { id: 'gw-1' } });

    const api = createParticipantsApi(client);
    await expect(api.update('gw-1', { name: 'x' })).rejects.toThrow();
  });
});
