import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Local-only registry of remote agent metadata (endpoint/protocol/capabilities).
 * These fields are not part of the wire protocol — on the server an agent is
 * just a participant with kind 'agent' — so they live on-device here. Unlike
 * credentials (authStorage, EncryptedStorage), this data is not secret, so it
 * uses plain AsyncStorage.
 */

const AGENTS_KEY = 'opc_agents';

export type AgentProtocol = 'A2A' | 'ACP' | 'WebSocket';

export interface AgentMeta {
  id: string;
  name: string;
  endpoint: string;
  protocol: AgentProtocol;
  capabilities: string[];
}

async function readAll(): Promise<AgentMeta[]> {
  try {
    const raw = await AsyncStorage.getItem(AGENTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    // Corrupted storage may hold syntactically valid non-array JSON (e.g.
    // '{}'); only accept an array so consumers can iterate safely.
    return Array.isArray(parsed) ? (parsed as AgentMeta[]) : [];
  } catch {
    return [];
  }
}

export async function getAgents(): Promise<AgentMeta[]> {
  return readAll();
}

export async function getAgent(id: string): Promise<AgentMeta | null> {
  const agents = await readAll();
  return agents.find((a) => a.id === id) ?? null;
}

export async function saveAgent(agent: AgentMeta): Promise<void> {
  const agents = await readAll();
  const next = [...agents.filter((a) => a.id !== agent.id), agent];
  await AsyncStorage.setItem(AGENTS_KEY, JSON.stringify(next));
}
