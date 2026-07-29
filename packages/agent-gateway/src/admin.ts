import { createServer, type Server } from 'node:http';
import type { AgentInfo, AgentMessage, ThreadInfo } from '@opc/agent-edge';

/** `GET /status` 的响应负载。 */
export interface AdminStatus {
  gatewayId: string;
  serverUrl: string;
  brokerUrl: string;
  /** ISO 时间戳。 */
  startedAt: string;
  uptimeSec: number;
  mqttConnected: boolean;
  agentCount: number;
  agentIds: string[];
}

/** `GET /agents` 列表项。 */
export interface AdminAgentEntry {
  participantId: string;
  info: AgentInfo;
  subscribedRooms: string[];
}

/** `GET /agents/:id/threads` 列表项：ThreadInfo 附带所属 room（若已知）。 */
export type AdminThreadEntry = ThreadInfo & { roomId?: string };

/**
 * admin server 的数据源，由 AgentGateway 以闭包形式注入，
 * 使本模块不依赖 gateway 内部结构。
 */
export interface AdminDataSource {
  getStatus(): AdminStatus;
  listAgents(): Promise<AdminAgentEntry[]>;
  /** agent 不存在时 resolve undefined。 */
  getAgent(participantId: string): Promise<AdminAgentEntry | undefined>;
  /** 返回是否实际停止了某个 agent。 */
  stopAgent(participantId: string): Promise<boolean>;
  /** agent 不存在时 resolve undefined。 */
  listThreads(participantId: string): Promise<AdminThreadEntry[] | undefined>;
  /** agent 不存在时 resolve undefined；thread 不存在时 reject。 */
  getThreadMessages(participantId: string, threadId: string): Promise<AgentMessage[] | undefined>;
}

export interface AdminServerOptions {
  host: string;
  port: number;
}

function sendJson(res: import('node:http').ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(payload);
}

function sendError(res: import('node:http').ServerResponse, status: number, message: string): void {
  sendJson(res, status, { error: message });
}

/**
 * 本机 loopback admin server：向 CLI 暴露 gateway 的实时状态、
 * agent 列表与 thread introspection 数据。无鉴权——只应绑定 127.0.0.1。
 */
export async function startAdminServer(
  source: AdminDataSource,
  options: AdminServerOptions
): Promise<Server> {
  const server = createServer((req, res) => {
    void route(req, res).catch((err: unknown) => {
      sendError(res, 500, err instanceof Error ? err.message : String(err));
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  return server;

  async function route(
    req: import('node:http').IncomingMessage,
    res: import('node:http').ServerResponse
  ): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const segments = url.pathname.split('/').filter(Boolean);
    const method = req.method ?? 'GET';

    if (method === 'GET' && url.pathname === '/status') {
      sendJson(res, 200, source.getStatus());
      return;
    }

    if (segments[0] === 'agents') {
      const agentId = segments[1] ? decodeURIComponent(segments[1]) : undefined;

      if (method === 'GET' && segments.length === 1) {
        sendJson(res, 200, { agents: await source.listAgents() });
        return;
      }

      if (!agentId) {
        sendError(res, 404, 'not found');
        return;
      }

      if (method === 'GET' && segments.length === 2) {
        const entry = await source.getAgent(agentId);
        if (!entry) {
          sendError(res, 404, `unknown agent: ${agentId}`);
          return;
        }
        sendJson(res, 200, entry);
        return;
      }

      if (method === 'DELETE' && segments.length === 2) {
        const stopped = await source.stopAgent(agentId);
        if (!stopped) {
          sendError(res, 404, `unknown agent: ${agentId}`);
          return;
        }
        sendJson(res, 200, { stopped: agentId });
        return;
      }

      if (method === 'GET' && segments.length === 3 && segments[2] === 'threads') {
        const threads = await source.listThreads(agentId);
        if (!threads) {
          sendError(res, 404, `unknown agent: ${agentId}`);
          return;
        }
        sendJson(res, 200, { threads });
        return;
      }

      if (method === 'GET' && segments.length === 5 && segments[2] === 'threads' && segments[4] === 'messages') {
        const threadId = decodeURIComponent(segments[3]);
        const messages = await source.getThreadMessages(agentId, threadId);
        if (!messages) {
          sendError(res, 404, `unknown agent: ${agentId}`);
          return;
        }
        sendJson(res, 200, { messages });
        return;
      }
    }

    sendError(res, 404, 'not found');
  }
}

export async function stopAdminServer(server: Server): Promise<void> {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}
