/**
 * AgentRuntime — IAgent implementation multiplexing PiThread instances.
 *
 * Status rules not spelled out by IAgent.ts, decided here:
 * - createThread requires the agent to be running or paused (creating starts
 *   no work, so pause does not block it); before start() and after
 *   terminate() it rejects with invalid_transition.
 * - startThread requires the agent to be running: starting a thread executes
 *   work, which a paused agent has frozen.
 * - receiveMessage requires running (routes immediately) or paused (queues);
 *   before start() it rejects with invalid_transition.
 * - destroyThread on an already-removed id is an idempotent no-op (terminal
 *   call), while every other lookup rejects with unknown_thread.
 */

import { randomUUID } from 'node:crypto';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import type { Api, Model } from '@earendil-works/pi-ai';
import {
  AgentStateError,
  type AgentId,
  type AgentInfo,
  type AgentMessage,
  type AgentOptions,
  type AgentStatus,
  type IAgent,
  type StatusChangeEvent,
  type ThreadId,
  type ThreadInfo,
  type ThreadOptions,
} from './IAgent.js';
import { PiThread, type PiThreadHooks } from './thread.js';

export interface AgentRuntimeDeps {
  agentId?: AgentId;
  model: Model<Api>;
  streamFn: StreamFn;
  systemPrompt?: string;
  /** Max simultaneously live threads; violations reject with thread_limit. */
  maxThreads?: number;
}

const DEFAULT_MAX_THREADS = 32;

export class AgentRuntime implements IAgent {
  readonly agentId: AgentId;

  private status: AgentStatus = 'initialized';
  private options: AgentOptions = {};
  private didInitialize = false;
  private readonly maxThreads: number;
  private readonly model: Model<Api>;
  private readonly streamFn: StreamFn;
  private readonly systemPrompt?: string;

  private readonly threads = new Map<ThreadId, PiThread>();
  private readonly messageHandlers = new Set<(message: AgentMessage) => void>();
  private readonly statusHandlers = new Set<(event: StatusChangeEvent) => void>();
  /** Inbound messages held while the agent is paused, FIFO. */
  private readonly inboundQueue: AgentMessage[] = [];

  private readonly threadHooks: PiThreadHooks = {
    emitOutbound: (message) => {
      for (const handler of this.messageHandlers) handler(message);
    },
    emitStatus: (threadId, status) => {
      this.emitStatus({ threadId, status });
    },
  };

  constructor(deps: AgentRuntimeDeps) {
    this.agentId = deps.agentId ?? randomUUID();
    this.model = deps.model;
    this.streamFn = deps.streamFn;
    this.systemPrompt = deps.systemPrompt;
    this.maxThreads = deps.maxThreads ?? DEFAULT_MAX_THREADS;
  }

  initialize(options: AgentOptions): Promise<void> {
    const destroyed = this.destroyedError();
    if (destroyed) return Promise.reject(destroyed);
    if (this.didInitialize || this.status !== 'initialized') {
      return Promise.reject(
        new AgentStateError('invalid_transition', 'agent is already initialized'),
      );
    }
    this.options = { ...options };
    this.didInitialize = true;
    return Promise.resolve();
  }

  start(): Promise<void> {
    const destroyed = this.destroyedError();
    if (destroyed) return Promise.reject(destroyed);
    if (this.status !== 'initialized') {
      return Promise.reject(
        new AgentStateError(
          'invalid_transition',
          `agent cannot start from "${this.status}"`,
        ),
      );
    }
    this.setAgentStatus('running');
    return Promise.resolve();
  }

  async pause(): Promise<void> {
    this.assertAlive();
    if (this.status !== 'running') {
      throw new AgentStateError(
        'invalid_transition',
        `agent cannot pause from "${this.status}"`,
      );
    }
    this.setAgentStatus('paused');
    await Promise.all(
      [...this.threads.values()]
        .filter(
          (thread) => thread.currentStatus === 'running' || thread.currentStatus === 'waiting',
        )
        .map((thread) => thread.pause()),
    );
  }

  async resume(): Promise<void> {
    this.assertAlive();
    if (this.status !== 'paused') {
      throw new AgentStateError(
        'invalid_transition',
        `agent cannot resume from "${this.status}"`,
      );
    }
    this.setAgentStatus('running');
    // Deliver queued inbound through the normal routing path first: paused
    // threads queue it internally, then flush it in FIFO order on resume.
    const queued = this.inboundQueue.splice(0);
    for (const message of queued) {
      await this.receiveMessage(message);
    }
    await Promise.all(
      [...this.threads.values()]
        .filter((thread) => thread.currentStatus === 'paused')
        .map((thread) => thread.resume()),
    );
  }

  async terminate(): Promise<void> {
    if (this.status === 'terminated' || this.status === 'destroyed') return;
    await Promise.all([...this.threads.values()].map((thread) => thread.terminate()));
    this.inboundQueue.length = 0;
    this.setAgentStatus('terminated');
  }

  async destroy(): Promise<void> {
    if (this.status === 'destroyed') return;
    await this.terminate();
    this.threads.clear();
    this.inboundQueue.length = 0;
    this.setAgentStatus('destroyed');
  }

  getInfo(): Promise<AgentInfo> {
    const destroyed = this.destroyedError();
    if (destroyed) return Promise.reject(destroyed);
    return Promise.resolve({
      agentId: this.agentId,
      status: this.status,
      ...this.options,
      threadIds: [...this.threads.keys()],
    });
  }

  onMessage(handler: (message: AgentMessage) => void): () => void {
    this.assertAlive();
    this.messageHandlers.add(handler);
    return () => {
      this.messageHandlers.delete(handler);
    };
  }

  onStatusChange(handler: (event: StatusChangeEvent) => void): () => void {
    this.assertAlive();
    this.statusHandlers.add(handler);
    return () => {
      this.statusHandlers.delete(handler);
    };
  }

  async receiveMessage(message: AgentMessage): Promise<void> {
    this.assertAlive();
    if (this.status === 'terminated') {
      throw new AgentStateError('terminated', 'agent is terminated');
    }
    if (this.status !== 'running' && this.status !== 'paused') {
      throw new AgentStateError(
        'invalid_transition',
        `agent cannot receive messages while "${this.status}"`,
      );
    }
    const thread = this.threads.get(message.threadId);
    if (!thread) {
      throw new AgentStateError('unknown_thread', `unknown thread ${message.threadId}`);
    }
    if (this.status === 'paused') {
      this.inboundQueue.push(message);
      return;
    }
    await thread.notify(message);
  }

  createThread(options: ThreadOptions): Promise<ThreadId> {
    const destroyed = this.destroyedError();
    if (destroyed) return Promise.reject(destroyed);
    if (this.status !== 'running' && this.status !== 'paused') {
      return Promise.reject(
        new AgentStateError(
          'invalid_transition',
          `agent cannot create threads while "${this.status}"`,
        ),
      );
    }
    if (this.threads.size >= this.maxThreads) {
      return Promise.reject(
        new AgentStateError(
          'thread_limit',
          `agent already runs ${this.maxThreads} threads`,
        ),
      );
    }
    const threadId = randomUUID();
    this.threads.set(
      threadId,
      new PiThread({
        threadId,
        goal: options.goal,
        title: options.title,
        agentId: this.agentId,
        model: this.model,
        streamFn: this.streamFn,
        systemPrompt: this.systemPrompt,
        hooks: this.threadHooks,
      }),
    );
    return Promise.resolve(threadId);
  }

  async getThread(threadId: ThreadId): Promise<ThreadInfo> {
    this.assertAlive();
    return this.requireThread(threadId).getInfo();
  }

  getThreads(): Promise<ThreadInfo[]> {
    const destroyed = this.destroyedError();
    if (destroyed) return Promise.reject(destroyed);
    return Promise.all([...this.threads.values()].map((thread) => thread.getInfo()));
  }

  async startThread(threadId: ThreadId): Promise<void> {
    this.assertAlive();
    const thread = this.requireThread(threadId);
    if (this.status !== 'running') {
      throw new AgentStateError(
        'invalid_transition',
        `agent cannot start threads while "${this.status}"`,
      );
    }
    await thread.start();
  }

  async pauseThread(threadId: ThreadId): Promise<void> {
    this.assertAlive();
    await this.requireThread(threadId).pause();
  }

  async completeThread(threadId: ThreadId): Promise<void> {
    this.assertAlive();
    await this.requireThread(threadId).complete();
  }

  async resumeThread(threadId: ThreadId): Promise<void> {
    this.assertAlive();
    await this.requireThread(threadId).resume();
  }

  async terminateThread(threadId: ThreadId): Promise<void> {
    this.assertAlive();
    await this.requireThread(threadId).terminate();
  }

  async destroyThread(threadId: ThreadId): Promise<void> {
    this.assertAlive();
    const thread = this.threads.get(threadId);
    if (!thread) return; // already gone: terminal calls are idempotent no-ops
    await thread.terminate();
    this.threads.delete(threadId);
  }

  async getMessages(threadId: ThreadId): Promise<AgentMessage[]> {
    this.assertAlive();
    return this.requireThread(threadId).getMessages();
  }

  //-- internals ---------------------------------------------------------------

  private assertAlive(): void {
    if (this.status === 'destroyed') {
      throw new AgentStateError('destroyed', 'agent is destroyed');
    }
  }

  /** destroyed-error variant for non-async methods, which must reject rather than throw. */
  private destroyedError(): AgentStateError | null {
    return this.status === 'destroyed'
      ? new AgentStateError('destroyed', 'agent is destroyed')
      : null;
  }

  private requireThread(threadId: ThreadId): PiThread {
    const thread = this.threads.get(threadId);
    if (!thread) {
      throw new AgentStateError('unknown_thread', `unknown thread ${threadId}`);
    }
    return thread;
  }

  private setAgentStatus(status: AgentStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.emitStatus({ status });
  }

  private emitStatus(event: StatusChangeEvent): void {
    for (const handler of this.statusHandlers) handler(event);
  }
}
