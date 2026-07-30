import type { AdminAgentEntry, AdminStatus, AdminThreadEntry } from '@opc/agent-gateway';
import type { AgentMessage } from '@opc/agent-edge';
import { DEFAULT_ADMIN_HOST, DEFAULT_ADMIN_PORT } from './gateway.js';
import { createLogger } from './logger.js';

export interface AdminClientEnv {
  EDGE_ADMIN_HOST?: string;
  EDGE_ADMIN_PORT?: string;
}

export class AdminUnreachableError extends Error {
  constructor(readonly baseUrl: string) {
    super(`gateway admin server unreachable at ${baseUrl} — is 'opc-gateway start' running?`);
    this.name = 'AdminUnreachableError';
  }
}

const logger = createLogger('admin-client');

/** `opc-gateway` CLI 访问本机 gateway admin server 的客户端。 */
export class AdminClient {
  readonly baseUrl: string;

  constructor(env: AdminClientEnv = process.env) {
    const host = env.EDGE_ADMIN_HOST ?? DEFAULT_ADMIN_HOST;
    const port = env.EDGE_ADMIN_PORT ? Number(env.EDGE_ADMIN_PORT) : DEFAULT_ADMIN_PORT;
    this.baseUrl = `http://${host}:${port}`;
  }

  private async request<T>(method: string, path: string): Promise<T> {
    logger.debug('admin request', { method, path, baseUrl: this.baseUrl });
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, { method });
    } catch (err) {
      logger.error('admin server unreachable', { baseUrl: this.baseUrl, error: err instanceof Error ? err.message : String(err) });
      throw new AdminUnreachableError(this.baseUrl);
    }
    if (res.status === 404) {
      const body = (await res.json().catch(() => undefined)) as { error?: string } | undefined;
      const message = body?.error ?? `not found: ${path}`;
      logger.warn('admin request returned 404', { method, path, error: message });
      throw new Error(message);
    }
    if (!res.ok) {
      logger.error('admin request failed', { method, path, status: res.status });
      throw new Error(`admin request failed: ${method} ${path} -> ${res.status}`);
    }
    return res.json() as Promise<T>;
  }

  getStatus(): Promise<AdminStatus> {
    return this.request('GET', '/status');
  }

  async listAgents(): Promise<AdminAgentEntry[]> {
    const body = await this.request<{ agents: AdminAgentEntry[] }>('GET', '/agents');
    return body.agents;
  }

  getAgent(participantId: string): Promise<AdminAgentEntry> {
    return this.request('GET', `/agents/${encodeURIComponent(participantId)}`);
  }

  stopAgent(participantId: string): Promise<void> {
    return this.request('DELETE', `/agents/${encodeURIComponent(participantId)}`);
  }

  async listThreads(participantId: string): Promise<AdminThreadEntry[]> {
    const body = await this.request<{ threads: AdminThreadEntry[] }>(
      'GET',
      `/agents/${encodeURIComponent(participantId)}/threads`
    );
    return body.threads;
  }

  async getThreadMessages(participantId: string, threadId: string): Promise<AgentMessage[]> {
    const body = await this.request<{ messages: AgentMessage[] }>(
      'GET',
      `/agents/${encodeURIComponent(participantId)}/threads/${encodeURIComponent(threadId)}/messages`
    );
    return body.messages;
  }
}
