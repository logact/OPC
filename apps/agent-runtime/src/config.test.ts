import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const baseEnv = {
  OPC_BASE_URL: 'http://localhost:3000',
  OPC_BROKER_URL: 'mqtt://localhost:1883',
  OPC_ROOM_ID: 'room-1',
  OPC_AGENTS: '[{"id":"agent1","engine":"kimi"},{"id":"agent2","engine":"shell"}]',
};

describe('loadConfig', () => {
  it('parses a valid env', () => {
    const config = loadConfig(baseEnv);
    expect(config.agents).toEqual([
      { id: 'agent1', name: 'agent1', engine: 'kimi' },
      { id: 'agent2', name: 'agent2', engine: 'shell' },
    ]);
    expect(config.defaultAgentId).toBe('agent1');
    expect(config.reconnectPeriodMs).toBe(5000);
  });

  it('honors OPC_DEFAULT_AGENT and overrides', () => {
    const config = loadConfig({ ...baseEnv, OPC_DEFAULT_AGENT: 'agent2', OPC_RECONNECT_PERIOD_MS: '1000' });
    expect(config.defaultAgentId).toBe('agent2');
    expect(config.reconnectPeriodMs).toBe(1000);
  });

  it('rejects missing required env', () => {
    expect(() => loadConfig({})).toThrow('missing required env');
  });

  it('rejects unknown engine', () => {
    expect(() =>
      loadConfig({ ...baseEnv, OPC_AGENTS: '[{"id":"a","engine":"gpt"}]' }),
    ).toThrow('engine');
  });

  it('rejects default agent not in list', () => {
    expect(() => loadConfig({ ...baseEnv, OPC_DEFAULT_AGENT: 'ghost' })).toThrow('OPC_DEFAULT_AGENT');
  });

  it('rejects duplicate agent ids', () => {
    expect(() =>
      loadConfig({ ...baseEnv, OPC_AGENTS: '[{"id":"a","engine":"kimi"},{"id":"a","engine":"shell"}]' }),
    ).toThrow('duplicate');
  });
});
