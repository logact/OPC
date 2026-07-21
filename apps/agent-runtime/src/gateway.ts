import type { Message } from '@logact-pub/opc-protocol';
import type { Agent } from './agent.js';

/**
 * Gateway：图中 device 上的 "NAT" 角色。持有本机全部 agent 的连接，
 * 监听房间事件并按 @提及 分派给对应 agent（无提及 → default agent）。
 */
export class Gateway {
  private readonly agents = new Map<string, Agent>();
  private readonly seenMessageIds = new Set<string>();

  constructor(
    agents: Agent[],
    private readonly defaultAgentId: string,
  ) {
    for (const agent of agents) this.agents.set(agent.config.id, agent);
    if (!this.agents.has(defaultAgentId)) {
      throw new Error(`default agent "${defaultAgentId}" not found`);
    }
  }

  async start(): Promise<void> {
    for (const agent of this.agents.values()) {
      await agent.start();
      // 每个 agent 的连接都会收到全部房间事件，这里统一入口 + 按消息 id 去重
      agent.client.events.on('message.delivered', (event: { message: Message }) => {
        void this.route(event.message);
      });
    }
    console.log(`[gateway] started, agents: ${[...this.agents.keys()].join(', ')}`);
  }

  /** 分派规则：忽略 agent 自己的消息（防循环）；`@agentId ...` 定向分派；否则给 default */
  private async route(message: Message): Promise<void> {
    if (this.agents.has(message.from)) return;
    if (this.seenMessageIds.has(message.id)) return;
    this.seenMessageIds.add(message.id);
    // 防止无界增长
    if (this.seenMessageIds.size > 10000) {
      this.seenMessageIds.delete(this.seenMessageIds.values().next().value as string);
    }

    const text = message.content.body.trim();
    const mention = /^@([\w-]+)\s*([\s\S]*)$/.exec(text);
    const targetId = mention && this.agents.has(mention[1]) ? mention[1] : this.defaultAgentId;
    const task = mention && this.agents.has(mention[1]) ? mention[2].trim() : text;
    if (!task) return;

    const agent = this.agents.get(targetId);
    if (!agent) return;
    try {
      await agent.handleTask(task);
    } catch (err) {
      console.error(`[gateway] task dispatch to ${targetId} failed:`, err);
    }
  }

  async stop(): Promise<void> {
    for (const agent of this.agents.values()) await agent.stop();
  }
}
