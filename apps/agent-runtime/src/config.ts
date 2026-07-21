export type EngineKind = 'shell' | 'kimi' | 'claude-code';

export interface AgentConfig {
  id: string;
  name: string;
  engine: EngineKind;
}

export interface RuntimeConfig {
  baseUrl: string;
  brokerUrl: string;
  roomId: string;
  agents: AgentConfig[];
  defaultAgentId: string;
  dataDir: string;
  reconnectPeriodMs: number;
}

const ENGINE_KINDS: readonly EngineKind[] = ['shell', 'kimi', 'claude-code'];

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) throw new Error(`missing required env: ${key}`);
  return value;
}

function parseAgents(raw: string): AgentConfig[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('OPC_AGENTS must be a non-empty JSON array');
  }
  return parsed.map((item, i): AgentConfig => {
    const a = item as { id?: unknown; name?: unknown; engine?: unknown };
    if (typeof a.id !== 'string' || !a.id) throw new Error(`OPC_AGENTS[${i}].id is required`);
    if (typeof a.engine !== 'string' || !ENGINE_KINDS.includes(a.engine as EngineKind)) {
      throw new Error(`OPC_AGENTS[${i}].engine must be one of ${ENGINE_KINDS.join('/')}`);
    }
    return { id: a.id, name: typeof a.name === 'string' && a.name ? a.name : a.id, engine: a.engine as EngineKind };
  });
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const agents = parseAgents(required(env, 'OPC_AGENTS'));
  const defaultAgentId = env.OPC_DEFAULT_AGENT ?? agents[0].id;
  if (!agents.some((a) => a.id === defaultAgentId)) {
    throw new Error(`OPC_DEFAULT_AGENT "${defaultAgentId}" is not in OPC_AGENTS`);
  }
  if (new Set(agents.map((a) => a.id)).size !== agents.length) {
    throw new Error('OPC_AGENTS contains duplicate agent ids');
  }
  return {
    baseUrl: required(env, 'OPC_BASE_URL'),
    brokerUrl: required(env, 'OPC_BROKER_URL'),
    roomId: required(env, 'OPC_ROOM_ID'),
    agents,
    defaultAgentId,
    dataDir: env.OPC_DATA_DIR ?? './data',
    reconnectPeriodMs: Number(env.OPC_RECONNECT_PERIOD_MS ?? 5000),
  };
}
