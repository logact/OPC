/**
 * PiThread — one IThread execution context backed by a single pi-agent-core run.
 *
 * Single-run lifecycle: start() issues the thread's only prompt() call and the
 * run then lives for the thread's whole lifetime — one task, one run, one
 * growing transcript. pi's loop awaits `prepareNextTurnWithContext` after
 * every `turn_end`, including the final text-only turn, before deciding
 * whether to exit (verified in pi-agent-core dist/agent-loop.js runLoop).
 * The gate below holds the run there:
 *
 * - mid-task turn (tool results present): holds only while paused;
 * - final reply turn (no tool results): holds until new inbound arrives —
 *   this is the "waiting" status.
 *
 * Inbound is delivered with agent.steer() and injected by the loop itself
 * right after the gate, so a waiting thread never restarts: it resumes the
 * same run with the same context. pi's "one-at-a-time" steering mode (its
 * default, pinned here explicitly) gives each queued inbound its own turn
 * and reply, preserving FIFO conversational granularity.
 *
 * The run ends exactly once — model/tool failure (stopReason "error" or
 * "aborted"), the complete_task tool (terminate: true), or external
 * complete()/terminate() releasing the gate — so `agent_end` fires once per
 * thread and is the single settlement point. pi never rejects prompt() for
 * run failures; the loop stores errorMessage on `agent.state` at turn_end
 * before emitting agent_end, so onRunEnd judges the outcome synchronously.
 *
 * Settle contract: start(), notify() from "waiting", resume() and complete()
 * resolve only after the thread reaches a non-running status, so callers
 * always observe a settled status when the promise settles.
 */

import { Agent } from '@earendil-works/pi-agent-core';
import type {
  AgentEvent,
  AgentTool,
  PrepareNextTurnContext,
  StreamFn,
} from '@earendil-works/pi-agent-core';
import type { Api, Model } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import {
  AgentStateError,
  type AgentId,
  type AgentLogger,
  type AgentMessage,
  type IThread,
  type ThreadId,
  type ThreadInfo,
  type ThreadStatus,
} from './IAgent.js';
import { fromPiTranscript, piMessageToAgentMessage, toPiUserMessage } from './mapping.js';

export interface PiThreadHooks {
  /** Outbound fan-out for assistant text produced by this thread. */
  emitOutbound(message: AgentMessage): void;
  /** Status-change fan-out. */
  emitStatus(
    threadId: ThreadId,
    status: ThreadStatus,
    detail?: { summary?: string; diagnostics?: string },
  ): void;
}

function createConsoleLogger(agentId: AgentId, threadId: ThreadId): AgentLogger {
  const prefix = `[agent:${agentId} thread:${threadId}]`;
  const format = (extra?: Record<string, unknown>): string =>
    extra && Object.keys(extra).length > 0
      ? ' ' + Object.entries(extra).map(([k, v]) => `${k}=${String(v)}`).join(' ')
      : '';
  return {
    info: (message, extra) => console.log(`${prefix} ${message}${format(extra)}`),
    warn: (message, extra) => console.warn(`${prefix} ${message}${format(extra)}`),
    error: (message, extra) => console.error(`${prefix} ${message}${format(extra)}`),
  };
}

export interface PiThreadDeps {
  threadId: ThreadId;
  goal: string;
  title?: string;
  /**
   * Thread mode (issue #104); see ThreadOptions.mode. Defaults to "goal".
   */
  mode?: 'goal' | 'chat';
  agentId: AgentId;
  model: Model<Api>;
  streamFn: StreamFn;
  systemPrompt?: string;
  /**
   * Real execution tools (issue #136, see tools.ts) injected in goal mode
   * alongside the completion tool. Chat mode always stays tool-less.
   */
  executionTools?: AgentTool[];
  /**
   * Working directory the execution tools are rooted at; surfaced in the
   * goal-mode system prompt so the model resolves relative paths there.
   */
  workspaceDir?: string;
  hooks: PiThreadHooks;
  /** Injected logger; defaults to console with an `[agent:<id> thread:<id>]` prefix. */
  logger?: AgentLogger;
}

/** Name of the built-in completion tool injected into every thread. */
export const COMPLETE_TASK_TOOL = 'complete_task';

export class PiThread implements IThread {
  readonly threadId: ThreadId;

  private readonly goal: string;
  private readonly title?: string;
  private readonly mode: 'goal' | 'chat';
  private readonly agentId: AgentId;
  private readonly model: Model<Api>;
  private readonly streamFn: StreamFn;
  private readonly systemPrompt?: string;
  private readonly executionTools: AgentTool[];
  private readonly workspaceDir?: string;
  private readonly hooks: PiThreadHooks;
  private readonly logger: AgentLogger;

  private status: ThreadStatus = 'initialized';
  private agent?: Agent;
  /** Inbound messages held while paused, FIFO. */
  private readonly inboundQueue: AgentMessage[] = [];
  /** Set by pause(); the gate holds at the next turn boundary until cleared. */
  private pauseRequested = false;
  /** Resolves the gate's current hold, if one is active. */
  private holdRelease: (() => void) | null = null;
  private terminating = false;
  /** Set when the model calls the complete_task tool or complete() is invoked. */
  private completionRequested = false;
  /** Optional outcome supplied by the model's completion tool call. */
  private completionSummary?: string;
  /** One-shot waiters resolved on the next transition out of "running". */
  private readonly settleWaiters = new Set<() => void>();

  /**
   * Built-in completion signal: the model calls this when it judges the goal
   * accomplished. terminate: true stops the loop without a follow-up call.
   */
  private readonly completionTool: AgentTool = {
    name: COMPLETE_TASK_TOOL,
    label: 'Complete task',
    description:
      'Mark the thread goal as fully accomplished. Call this only when the goal is achieved and no further work or answer is needed.',
    parameters: Type.Object({
      summary: Type.Optional(Type.String({ description: 'Short summary of the outcome.' })),
    }),
    execute: (_toolCallId, args) => {
      this.logger.info('[tool call]completion tool called', { threadId: this.threadId });
      this.completionRequested = true;
      const summary =
        typeof args === 'object' &&
        args !== null &&
        'summary' in args &&
        typeof args.summary === 'string'
          ? args.summary.trim()
          : '';
      this.completionSummary = summary.length > 0 ? summary : undefined;
      return Promise.resolve({
        content: [{ type: 'text' as const, text: 'Goal marked as accomplished.' }],
        details: {},
        terminate: true,
      });
    },
  };

  constructor(deps: PiThreadDeps) {
    this.threadId = deps.threadId;
    this.goal = deps.goal;
    this.title = deps.title;
    this.mode = deps.mode ?? 'goal';
    this.agentId = deps.agentId;
    this.model = deps.model;
    this.streamFn = deps.streamFn;
    this.systemPrompt = deps.systemPrompt;
    this.executionTools = deps.executionTools ?? [];
    this.workspaceDir = deps.workspaceDir;
    this.hooks = deps.hooks;
    this.logger = deps.logger ?? createConsoleLogger(this.agentId, this.threadId);
  }

  /** Synchronous status peek for the owning runtime (IThread exposes only async snapshots). */
  get currentStatus(): ThreadStatus {
    return this.status;
  }

  async start(): Promise<void> {
    this.logger.info('thread starting', { threadId: this.threadId, goal: this.goal });
    if (this.status !== 'initialized') {
      throw new AgentStateError(
        'invalid_transition',
        `thread ${this.threadId} cannot start from "${this.status}"`,
      );
    }
    const agent = new Agent({
      initialState: {
        systemPrompt: this.buildSystemPrompt(),
        model: this.model,
        // Goal mode gives the run the completion tool plus any real execution
        // tools (issue #136); chat mode is a plain assistant with no tools.
        tools: this.mode === 'goal' ? [this.completionTool, ...this.executionTools] : [],
      },
      streamFn: this.streamFn,
      steeringMode: 'one-at-a-time',
      prepareNextTurnWithContext: this.gateNextTurn,
    });
    this.agent = agent;
    agent.subscribe((event) => {
      this.onThreadEvent(event);
    });
    this.setStatus('running');
    const settled = this.waitForSettle();
    // The thread's only prompt: this run lives until done/error/terminated.
    // Failures surface via agent_end + state.errorMessage (see onRunEnd),
    // never as a rejection, so the promise is deliberately left unhandled.
    void agent.prompt(this.goal);
    // Resolve on the first idle/terminal transition, not at run end — the run
    // spans the thread's whole life.
    await settled;
  }

  pause(): Promise<void> {
    if (this.status !== 'running' && this.status !== 'waiting') {
      return Promise.reject(
        new AgentStateError(
          'invalid_transition',
          `thread ${this.threadId} cannot pause from "${this.status}"`,
        ),
      );
    }
    // From "running": the gate holds at the next turn boundary. From
    // "waiting": the gate is already held; the flag just reroutes the wake-up.
    // Either way the status flips now so inbound starts queueing immediately.
    this.pauseRequested = true;
    this.logger.info('thread pausing', { threadId: this.threadId });
    this.setStatus('paused');
    return Promise.resolve();
  }

  async resume(): Promise<void> {
    if (this.status !== 'paused') {
      throw new AgentStateError(
        'invalid_transition',
        `thread ${this.threadId} cannot resume from "${this.status}"`,
      );
    }
    this.pauseRequested = false;
    this.logger.info('thread resuming', { threadId: this.threadId });
    const agent = this.agent;
    if (agent) {
      for (const message of this.inboundQueue.splice(0)) {
        agent.steer(toPiUserMessage(message));
      }
    }
    const settled = this.waitForSettle();
    if (this.holdRelease) {
      // The gate re-evaluates: queued inbound or a mid-task turn continues the
      // run ("running"); an idle final-reply turn holds again ("waiting").
      this.releaseHold();
    } else {
      // Paused before the run reached the gate; it just continues.
      this.setStatus('running');
    }
    await settled;
  }

  async complete(): Promise<void> {
    if (this.status !== 'waiting') {
      throw new AgentStateError(
        'invalid_transition',
        `thread ${this.threadId} cannot complete from "${this.status}"`,
      );
    }
    this.completionRequested = true;
    this.logger.info('thread completing', { threadId: this.threadId });
    // Releasing the gate lets the loop exit; onRunEnd settles to "done".
    this.releaseHold();
    await this.agent?.waitForIdle();
  }

  async terminate(): Promise<void> {
    if (this.status === 'terminated') return;
    this.terminating = true;
    this.logger.info('thread terminating', { threadId: this.threadId });
    this.inboundQueue.length = 0;
    this.releaseHold();
    const agent = this.agent;
    if (agent) {
      agent.abort();
      agent.clearAllQueues();
      await agent.waitForIdle();
    }
    this.setStatus('terminated');
  }

  async notify(message: AgentMessage): Promise<void> {
    this.logger.info('message received', {
      threadId: this.threadId,
      messageId: message.id,
      from: message.from,
      status: this.status,
    });
    switch (this.status) {
      case 'terminated':
        throw new AgentStateError(
          'terminated',
          `thread ${this.threadId} is terminated and cannot accept messages`,
        );
      case 'paused':
        this.inboundQueue.push(message);
        return;
      case 'waiting': {
        const agent = this.agent;
        if (!agent) {
          throw new AgentStateError(
            'invalid_transition',
            `thread ${this.threadId} has no active run`,
          );
        }
        // Continuing an idle thread: the message is steered into the same run,
        // which is held at the turn boundary — not a restart.
        const settled = this.waitForSettle();
        agent.steer(toPiUserMessage(message));
        this.setStatus('running');
        this.releaseHold();
        await settled;
        return;
      }
      case 'running': {
        const agent = this.agent;
        if (!agent) {
          throw new AgentStateError(
            'invalid_transition',
            `thread ${this.threadId} has no active run`,
          );
        }
        // Injected after the current assistant turn finishes.
        agent.steer(toPiUserMessage(message));
        return;
      }
      default:
        // initialized (no run yet), done and error (finished threads never
        // restart) all reject the same way.
        throw new AgentStateError(
          'invalid_transition',
          `thread ${this.threadId} is "${this.status}" and cannot accept messages`,
        );
    }
  }

  getInfo(): Promise<ThreadInfo> {
    return Promise.resolve({
      threadId: this.threadId,
      status: this.status,
      goal: this.goal,
      title: this.title,
    });
  }

  getMessages(): Promise<AgentMessage[]> {
    return Promise.resolve(
      fromPiTranscript(this.agent?.state.messages ?? [], {
        agentId: this.agentId,
        threadId: this.threadId,
      }),
    );
  }

  //-- internals ---------------------------------------------------------------

  private buildSystemPrompt(): string {
    if (this.mode === 'chat') {
      // Plain assistant: no goal, no completion tool — reply, then wait.
      return [
        this.systemPrompt,
        'You are a helpful assistant. Answer the user concisely and conversationally.',
      ]
        .filter((part) => part != null && part.length > 0)
        .join('\n\n');
    }
    return [
      this.systemPrompt,
      `Your assigned goal: ${this.goal}`,
      `When this goal is fully accomplished, call the ${COMPLETE_TASK_TOOL} tool instead of replying with text.`,
      ...this.buildToolGuidance(),
    ]
      .filter((part) => part != null && part.length > 0)
      .join('\n\n');
  }

  /**
   * Goal-mode tool guidance: without it the model answers from its bare-LLM
   * self-image ("I have no tools / no filesystem access") even though the
   * tools are wired into the run.
   */
  private buildToolGuidance(): string[] {
    if (this.executionTools.length === 0) return [];
    const lines = [
      'You have access to the following tools to accomplish the goal:',
      ...this.executionTools.map((tool) => `- ${tool.name}: ${tool.description}`),
    ];
    if (this.workspaceDir) {
      lines.push(
        `Your working directory is ${this.workspaceDir}. Relative paths in tool calls resolve there; prefer it for any files you read or create.`,
      );
    }
    return [lines.join('\n')];
  }

  private setStatus(
    status: ThreadStatus,
    detail?: { summary?: string; diagnostics?: string },
  ): void {
    if (this.status === status) return;
    const from = this.status;
    this.status = status;
    this.logger.info('status transition', { from, to: status });
    if (status !== 'running') {
      for (const resolve of this.settleWaiters) resolve();
      this.settleWaiters.clear();
    }
    this.hooks.emitStatus(this.threadId, status, detail);
  }

  /** Resolves on the next transition out of "running" (waiting/done/error/paused/terminated). */
  private waitForSettle(): Promise<void> {
    return new Promise((resolve) => {
      this.settleWaiters.add(resolve);
    });
  }

  private releaseHold(): void {
    const release = this.holdRelease;
    this.holdRelease = null;
    release?.();
  }

  /**
   * Turn-boundary gate handed to pi as `prepareNextTurnWithContext`. pi awaits
   * it after every turn_end — including the final text-only turn, before the
   * loop would exit — and drains the steering queue right after it returns,
   * which is what makes the single-run lifecycle work:
   *
   * - paused: hold until resume() (or terminate()).
   * - steered inbound pending: return so the loop injects it ("running").
   * - final reply turn with nothing pending: hold until inbound arrives —
   *   this is "waiting". complete() and terminate() also release the hold,
   *   letting the loop exit for good.
   *
   * Abort releases the gate too, so terminate() can always settle the run.
   */
  private readonly gateNextTurn = async (
    context: PrepareNextTurnContext,
    signal?: AbortSignal,
  ): Promise<undefined> => {
    const finalReplyTurn = context.toolResults.length === 0;
    while (true) {
      // Never hold once the run is winding down.
      if (this.terminating || signal?.aborted || this.completionRequested) return undefined;
      if (this.pauseRequested) {
        this.setStatus('paused');
        await this.waitForRelease(signal);
        continue;
      }
      if (this.agent?.hasQueuedMessages()) {
        // Inbound was steered in; let the loop inject it instead of idling.
        if (this.status !== 'running') this.setStatus('running');
        return undefined;
      }
      if (!finalReplyTurn) {
        // Mid-task turn (tool results present): no reason to idle.
        if (this.status !== 'running') this.setStatus('running');
        return undefined;
      }
      this.setStatus('waiting');
      await this.waitForRelease(signal);
    }
  };

  private waitForRelease(signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const onAbort = (): void => resolve();
      this.holdRelease = () => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      };
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  private onThreadEvent(event: AgentEvent): void {
    this.logger.info('thread event', event);
    if (event.type === 'message_end' && event.message.role === 'assistant') {
      const outbound = piMessageToAgentMessage(event.message, {
        agentId: this.agentId,
        threadId: this.threadId,
      });
      this.logger.info('outbound', {"outbound":outbound});
      if (outbound) this.hooks.emitOutbound(outbound);
      return;
    }
    if (event.type === 'agent_end') {
      this.onRunEnd();
    }
  }

  /**
   * The thread's single run has emitted agent_end; judge the outcome
   * synchronously (state.errorMessage is final once turn_end has fired).
   * A clean exit without a completion signal is impossible in this design —
   * the gate only releases for inbound, completion, or termination — so it
   * is treated as an error defensively.
   */
  private onRunEnd(): void {
    if (this.terminating) return;
    if (this.agent?.state.errorMessage) {
      this.logger.error('run failed', {
        threadId: this.threadId,
        error: this.agent.state.errorMessage,
      });
      this.setStatus('error', { diagnostics: this.agent.state.errorMessage });
      return;
    }
    if (this.completionRequested) {
      this.setStatus(
        'done',
        this.completionSummary ? { summary: this.completionSummary } : undefined,
      );
      return;
    }
    this.logger.error('run ended without completion signal', { threadId: this.threadId });
    this.setStatus('error', { diagnostics: 'run ended without completion signal' });
  }
}
