import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { OpcHttpClient } from '@logact-pub/opc-sdk';
import type { AgentConfig } from './config.js';

/** 单个 agent 的接入凭据；token 仅注册时返回一次，必须落盘复用 */
export interface AgentCredentials {
  id: string;
  token: string;
  password: string;
  accessToken?: string;
}

export type CredentialsStore = Record<string, AgentCredentials>;

export async function loadCredentialsStore(path: string): Promise<CredentialsStore> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as CredentialsStore;
  } catch {
    return {};
  }
}

export async function saveCredentialsStore(path: string, store: CredentialsStore): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(store, null, 2), { mode: 0o600 });
}

export function credentialsPath(dataDir: string): string {
  return join(dataDir, '.agents.json');
}

/**
 * 幂等 bootstrap：为每个 agent 确保 participant 已注册（kind=agent）且已加入房间。
 * 已有本地凭据则复用；否则注册新 participant 并落盘。
 * 返回 agentId → credentials（含管理面 accessToken）。
 */
export async function bootstrapAgents(
  http: OpcHttpClient,
  agents: AgentConfig[],
  roomId: string,
  storePath: string,
): Promise<CredentialsStore> {
  const store = await loadCredentialsStore(storePath);

  for (const agent of agents) {
    if (!store[agent.id]) {
      const password = randomBytes(16).toString('hex');
      const { participantId, token } = await http.registerParticipant(agent.id, agent.name, password);
      store[agent.id] = { id: participantId, token, password };
      await saveCredentialsStore(storePath, store);
    }
    const creds = store[agent.id];
    const { accessToken } = await http.login(creds.id, creds.password);
    creds.accessToken = accessToken;
    http.setAccessToken(accessToken);
    await http.updateParticipant(creds.id, { kind: 'agent' });
  }

  // 任一有权限的账号即可把全部成员拉进房间（房间创建者之外需由创建者先加一人，
  // 这里假设第一个 agent 即房间管理方，或房间已包含其中任一成员）
  await http.addRoomMembers(roomId, { participantIds: agents.map((a) => a.id) });
  await saveCredentialsStore(storePath, store);
  return store;
}
