import { join } from 'node:path';
import { OpcClient } from '@logact-pub/opc-sdk';
import type { AgentCredentials } from './bootstrap.js';
import type { AgentConfig, RuntimeConfig } from './config.js';
import { FileMemoryStore } from './memory.js';
import type { ToolEngine } from './tools/index.js';

const MAX_REPLY_CHARS = 3500;

/**
 * 单个本地 agent：一条独立的 OpcClient MQTT 连接 + 一个 CLI engine + 本地 memory。
 * 路由决策在 Gateway；Agent 只负责执行被分派的任务并回帖。
 */
export class Agent {
  readonly client: OpcClient;
  private readonly memory: FileMemoryStore;

  constructor(
    readonly config: AgentConfig,
    private readonly engine: ToolEngine,
    private readonly runtimeConfig: RuntimeConfig,
    credentials: AgentCredentials,
  ) {
    this.client = new OpcClient({
      baseUrl: runtimeConfig.baseUrl,
      brokerUrl: runtimeConfig.brokerUrl,
      participantId: credentials.id,
      token: credentials.token,
      accessToken: credentials.accessToken,
      reconnectPeriod: runtimeConfig.reconnectPeriodMs,
    });
    this.memory = new FileMemoryStore(
      join(runtimeConfig.dataDir, 'agents', this.config.id, 'memory.json'),
    );
    this.client.events.on('error', (err: Error) => {
      console.error(`[${this.config.id}] client error:`, err.message);
    });
  }

  async start(): Promise<void> {
    await this.client.connect();
    await this.client.subscribeRoom(this.runtimeConfig.roomId);
    console.log(`[${this.config.id}] online (engine=${this.engine.name})`);
  }

  /** 执行一个任务：拼 memory 上下文 → 调 engine → 回帖 → 落 memory */
  async handleTask(task: string): Promise<void> {
    const roomId = this.runtimeConfig.roomId;
    await this.memory.append('task', task);
    let reply: string;
    try {
      const context = await this.memory.renderContext();
      const result = await this.engine.run(`${context}# Current task\n${task}`, {
        cwd: process.cwd(),
      });
      reply = result || '(no output)';
    } catch (err) {
      reply = `task failed: ${err instanceof Error ? err.message : String(err)}`;
    }
    await this.memory.append('result', reply);
    if (reply.length > MAX_REPLY_CHARS) {
      reply = `${reply.slice(0, MAX_REPLY_CHARS)}\n…(truncated, ${reply.length} chars total)`;
    }
    await this.client.sendText(roomId, `[${this.config.id}] ${reply}`);
  }

  async stop(): Promise<void> {
    await this.client.disconnect();
  }
}
