/**
 * Agent runtime contracts for @opc/agent-edge.
 *
 * Design decisions (aligned 2026-07-28):
 * - A Thread is a task/conversation context: it owns its message history and
 *   execution loop; the agent multiplexes many threads.
 * - Messaging is layered: AgentMessage is transport-agnostic; an MQTT gateway
 *   adapter (mapping to @logact-pub/opc-protocol types) plugs in separately.
 * - Thread control is id-only: IAgent never hands out live IThread handles.
 *   IThread below is an internal contract between the agent and its runtime,
 *   not a public API.
 * - Control plane and data plane are separate: lifecycle methods
 *   (start/pause/resume/terminate) carry no message payloads; all input flows
 *   through receiveMessage, all output through the onMessage handler.
 *
 * Error model (uniform across all methods):
 * - Unknown ids reject with AgentStateError("unknown_thread").
 * - Invalid state transitions reject with AgentStateError("invalid_transition"),
 *   except terminal calls: terminate/destroy are idempotent no-ops when the
 *   target is already terminated/destroyed.
 * - After destroy, every method rejects with AgentStateError("destroyed").
 * - Resource limits (e.g. max threads) are construction-time configuration of
 *   the implementation; violations reject with AgentStateError("thread_limit").
 */

// ---------------------------------------------------------------------------
// Identities & statuses
// ---------------------------------------------------------------------------

export type AgentId = string;
export type ThreadId = string;

export type AgentStatus = "initialized" | "running" | "paused" | "terminated" | "destroyed";

/**
 * Thread lifecycle: initialized -> running -> (waiting <-> running)* ->
 * done / error / terminated (terminal).
 *
 * A thread executes a single continuous run for its goal: "waiting" and
 * "paused" suspend that run at a turn boundary rather than ending it. A
 * thread never starts over — it only ever works on the goal it was created
 * with, in one growing transcript.
 *
 * - "running": the run is actively progressing (model call or tool execution).
 * - "waiting": the run is alive but suspended after a reply, awaiting input
 *   (a user answer, another agent's reply). Inbound messages resume the same
 *   run — this is not a restart.
 * - "done": the goal is accomplished. Reached only by an explicit completion
 *   signal: the thread's built-in complete_task tool, or IAgent.completeThread.
 * - "error": the run failed. Terminal; create a new thread for new work.
 * - "destroyed" is not a thread status: destroyThread removes the thread
 *   outright, after which lookups reject as unknown ids.
 */
export type ThreadStatus =
  | "initialized"
  | "running"
  | "waiting"
  | "paused"
  | "done"
  | "error"
  | "terminated";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type AgentErrorCode =
  | "unknown_thread"
  | "invalid_transition"
  | "terminated"
  | "destroyed"
  | "thread_limit";

/** Structured rejection reason for all IAgent/IThread methods. */
export class AgentStateError extends Error {
  constructor(
    readonly code: AgentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AgentStateError";
  }
}

// ---------------------------------------------------------------------------
// Messages (transport-agnostic layer)
// ---------------------------------------------------------------------------

/**
 * Transport-agnostic message unit inside the agent runtime.
 *
 * The MQTT gateway adapter maps this to/from the protocol wire types
 * (`UplinkPayload` / `ServerEvent` in `@logact-pub/opc-protocol`); the runtime
 * itself never sees MQTT topics.
 */
export interface AgentMessage {
  /** Unique message id; carried through to the protocol wire types. */
  id: string;
  /** Unix epoch milliseconds. */
  timestamp: number;
  /**
   * Sender identity, by convention: the literal "user", an AgentId, or a
   * protocol participant id. The gateway owns the mapping to protocol
   * participant ids.
   */
  from: string;
  /**
   * Target thread. Required in both directions: inbound routing rejects
   * unknown ids, and outbound messages must be attributable to a thread.
   * There is no implicit "main thread".
   */
  threadId: ThreadId;
  /** Id of the message this replies to, when applicable. */
  inReplyTo?: string;
  /** Mirrors the protocol content union so gateway mapping stays 1:1. */
  content: { type: "text" | "markdown" | "json" | "system"; body: string };
}

// ---------------------------------------------------------------------------
// Options & info snapshots
// ---------------------------------------------------------------------------

export type AgentOptions = {
  role?: string;
  position?: string;
  department?: string;
};

export type ThreadOptions = {
  /**
   * The task this thread exists to accomplish. Fixed at creation; a finished
   * thread is never restarted — create a new thread for new work.
   */
  goal: string;
  title?: string;
};

/** Immutable snapshot of agent state (no live methods). */
export interface AgentInfo {
  agentId: AgentId;
  status: AgentStatus;
  role?: string;
  position?: string;
  department?: string;
  threadIds: ThreadId[];
}

/** Immutable snapshot of thread state (no live methods). */
export interface ThreadInfo {
  threadId: ThreadId;
  status: ThreadStatus;
  goal: string;
  title?: string;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface StatusChangeEvent {
  /** Omitted when the change concerns the agent itself. */
  threadId?: ThreadId;
  status: AgentStatus | ThreadStatus;
}

// ---------------------------------------------------------------------------
// Agent — the single public API surface
// ---------------------------------------------------------------------------

/**
 * Multi-threaded agent runtime interface.
 *
 * Lifecycle: initialize -> start -> (pause/resume)* -> terminate -> destroy.
 * terminate stops execution and cascades to all threads (terminal);
 * destroy implies terminate, releases resources, and removes the agent from
 * the runtime — terminated agents remain inspectable, destroyed agents are
 * gone and every method rejects with AgentStateError("destroyed").
 *
 * Pause convention (holds for the agent and every thread): takes effect after
 * the current execution step completes — an in-flight model call cannot be
 * suspended mid-flight.
 */
export interface IAgent {
  /** Assigned at construction; never changes. */
  readonly agentId: AgentId;

  /**
   * Sets org metadata; must be called before start(). Calling it again after
   * initialization rejects with AgentStateError("invalid_transition").
   */
  initialize(options: AgentOptions): Promise<void>;

  /**
   * Starts the agent's runtime loop. Valid only from "initialized";
   * starting a running agent rejects. Threads are started individually via
   * startThread — no work begins implicitly here.
   */
  start(): Promise<void>;

  /**
   * Pauses the agent: all running and waiting threads pause (running ones
   * after their current step), and inbound messages queue until resume.
   */
  pause(): Promise<void>;

  /** Resumes from paused; queued inbound messages are delivered in order. */
  resume(): Promise<void>;

  /**
   * Stops execution permanently; cascades — all threads transition to
   * "terminated". Idempotent.
   */
  terminate(): Promise<void>;

  /**
   * Implies terminate, then releases resources and removes the agent from the
   * runtime. Idempotent.
   */
  destroy(): Promise<void>;

  /** Immutable snapshot of current state. */
  getInfo(): Promise<AgentInfo>;

  /**
   * Outbound subscription: the runtime invokes handler for every message the
   * agent (or one of its threads) emits toward the outside. The gateway
   * registers here and owns delivery. Returns an unsubscribe function.
   */
  onMessage(handler: (message: AgentMessage) => void): () => void;

  /** Status-change subscription for the agent and all its threads. */
  onStatusChange(handler: (event: StatusChangeEvent) => void): () => void;

  /**
   * Inbound: external caller/gateway delivers a message into the agent.
   * Routes to the thread named by message.threadId; unknown ids reject.
   * While the agent or target thread is paused the message is queued; on a
   * terminated target it rejects with AgentStateError("terminated"). A
   * "waiting" thread accepts the message and continues (back to "running");
   * done/error targets reject with AgentStateError("invalid_transition").
   */
  receiveMessage(message: AgentMessage): Promise<void>;

  //-- Thread management (id-only; IThread handles never escape) -------------

  /** Creates a thread in "initialized" status. Does not start work. */
  createThread(options: ThreadOptions): Promise<ThreadId>;

  /** Snapshot of one thread; unknown ids reject. */
  getThread(threadId: ThreadId): Promise<ThreadInfo>;

  /** Snapshots of all live threads. */
  getThreads(): Promise<ThreadInfo[]>;

  /**
   * Starts the thread's execution loop on its goal. Valid only from
   * "initialized"; threads that reached done/error/terminated are never
   * restarted — create a new thread instead.
   */
  startThread(threadId: ThreadId): Promise<void>;

  /**
   * Marks a "waiting" thread's goal as accomplished: the thread transitions
   * to "done" (terminal). This is the external counterpart of the thread's
   * built-in complete_task tool. Valid only from "waiting"; from any other
   * status it rejects with AgentStateError("invalid_transition").
   */
  completeThread(threadId: ThreadId): Promise<void>;

  /**
   * Pauses a thread. Valid from "running" (takes effect after the current
   * step) and from "waiting" (immediate — no run to wait for). Same "after
   * current step" convention as agent pause.
   */
  pauseThread(threadId: ThreadId): Promise<void>;

  /**
   * Resumes a paused thread; its queued inbound messages are delivered.
   * Returns to "waiting" when no queued work starts a run, else "running".
   */
  resumeThread(threadId: ThreadId): Promise<void>;

  /** Terminates one thread; the agent and other threads keep running. Idempotent. */
  terminateThread(threadId: ThreadId): Promise<void>;

  /** Implies terminateThread, then drops the thread's handle and history. Idempotent. */
  destroyThread(threadId: ThreadId): Promise<void>;

  /** Full message history of a thread, oldest first; unknown ids reject. */
  getMessages(threadId: ThreadId): Promise<AgentMessage[]>;
}

// ---------------------------------------------------------------------------
// Thread — internal execution-context handle
// ---------------------------------------------------------------------------

/**
 * Internal contract between an agent implementation and its runtime.
 * Controlled exclusively through IAgent's thread-level methods; handles never
 * leave the runtime, so this interface is a guide for implementers, not a
 * public API.
 */
export interface IThread {
  readonly threadId: ThreadId;

  /** Starts the execution loop on the thread's goal. Valid from "initialized" only. */
  start(): Promise<void>;

  /** Valid from "running" and "waiting". Same "after current step" convention as IAgent.pause. */
  pause(): Promise<void>;

  /**
   * Resumes from paused; queued inbound messages are delivered. Returns to
   * "waiting" when nothing starts a run, else "running".
   */
  resume(): Promise<void>;

  /**
   * Marks the goal accomplished ("done", terminal). Valid from "waiting"
   * only — the external counterpart of the built-in complete_task tool.
   */
  complete(): Promise<void>;

  /** Terminal stop for this thread only. Idempotent. */
  terminate(): Promise<void>;

  /**
   * Delivers an inbound message into this thread's context.
   * Queued while paused; a "waiting" thread continues (back to "running");
   * rejected with AgentStateError("terminated") when terminated, and with
   * AgentStateError("invalid_transition") when done/error/initialized.
   */
  notify(message: AgentMessage): Promise<void>;

  /** Immutable snapshot of current state. */
  getInfo(): Promise<ThreadInfo>;

  /** Full message history, oldest first. */
  getMessages(): Promise<AgentMessage[]>;
}
