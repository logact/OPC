/* eslint-disable @typescript-eslint/unbound-method */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpcHttpClient } from '@logact-pub/opc-sdk';
import { bootstrapAgents, loadCredentialsStore } from './bootstrap.js';
import type { AgentConfig } from './config.js';

const agents: AgentConfig[] = [
  { id: 'agent1', name: 'Agent 1', engine: 'kimi' },
  { id: 'agent2', name: 'Agent 2', engine: 'shell' },
];

function mockHttp(): OpcHttpClient {
  return {
    registerParticipant: vi.fn((id: string) => Promise.resolve({ participantId: id, token: `token-${id}` })),
    login: vi.fn((id: string) => Promise.resolve({ accessToken: `jwt-${id}`, participant: { id } })),
    setAccessToken: vi.fn(),
    updateParticipant: vi.fn(() => Promise.resolve({})),
    addRoomMembers: vi.fn(() => Promise.resolve({})),
  } as unknown as OpcHttpClient;
}

describe('bootstrapAgents', () => {
  let dir: string;
  let storePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'agent-runtime-'));
    storePath = join(dir, '.agents.json');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('registers new agents, sets kind, joins room, persists credentials', async () => {
    const http = mockHttp();
    const store = await bootstrapAgents(http, agents, 'room-1', storePath);

    expect(http.registerParticipant).toHaveBeenCalledTimes(2);
    expect(http.updateParticipant).toHaveBeenCalledWith('agent1', { kind: 'agent' });
    expect(http.addRoomMembers).toHaveBeenCalledWith('room-1', { participantIds: ['agent1', 'agent2'] });
    expect(store.agent1.token).toBe('token-agent1');
    expect(store.agent1.accessToken).toBe('jwt-agent1');

    const persisted = await loadCredentialsStore(storePath);
    expect(persisted.agent2.token).toBe('token-agent2');
  });

  it('is idempotent: reuses persisted credentials on second run', async () => {
    await bootstrapAgents(mockHttp(), agents, 'room-1', storePath);

    const http = mockHttp();
    const store = await bootstrapAgents(http, agents, 'room-1', storePath);

    expect(http.registerParticipant).not.toHaveBeenCalled();
    expect(store.agent1.token).toBe('token-agent1');
    expect(http.login).toHaveBeenCalledTimes(2);
    expect(http.addRoomMembers).toHaveBeenCalledTimes(1);
  });
});
