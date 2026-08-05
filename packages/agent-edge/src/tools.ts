/**
 * Execution tools (issue #136) — real bash/read/write/edit for goal-mode
 * threads, built on pi-agent-core's own harness tools.
 *
 * The harness factories return `AgentHarnessTool`, whose `execute` takes a
 * trailing `ExecutionToolContext` argument (the harness resolves it per turn).
 * PiThread drives a bare `Agent`, so the context is bound once here: a single
 * `NodeExecutionEnv` rooted at the agent's workspace directory, shared by all
 * tools of one agent. Relative paths in tool calls resolve against that
 * workspace; the workspace anchors cwd only — it is not a sandbox.
 */

import {
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
  type AgentHarnessTool,
  type AgentTool,
  type ExecutionToolContext,
} from '@earendil-works/pi-agent-core';
import { NodeExecutionEnv } from '@earendil-works/pi-agent-core/node';
import type { TSchema } from 'typebox';

/** Names of the execution tools an agent can be equipped with. */
export type ExecutionToolName = 'bash' | 'read' | 'write' | 'edit';

export const EXECUTION_TOOL_NAMES: readonly ExecutionToolName[] = [
  'bash',
  'read',
  'write',
  'edit',
];

/** Drops the harness tool's trailing context parameter by closing over it. */
function bindToolContext<TParameters extends TSchema, TDetails>(
  tool: AgentHarnessTool<ExecutionToolContext, TParameters, TDetails>,
  context: ExecutionToolContext,
): AgentTool<TParameters, TDetails> {
  return {
    ...tool,
    execute: (toolCallId, params, signal, onUpdate) =>
      tool.execute(toolCallId, params, signal, onUpdate, context),
  };
}

const TOOL_FACTORIES: Record<
  ExecutionToolName,
  () => AgentHarnessTool<ExecutionToolContext, TSchema, unknown>
> = {
  bash: () => createBashTool(),
  read: () => createReadTool(),
  write: () => createWriteTool(),
  edit: () => createEditTool(),
};

/**
 * Creates the execution tool set for one agent, rooted at `workspaceDir`.
 * `names` trims the set (e.g. `['read']` for a read-only agent); defaults to
 * the full bash/read/write/edit set. Unknown names are ignored.
 */
export function createExecutionTools(
  workspaceDir: string,
  names: readonly ExecutionToolName[] = EXECUTION_TOOL_NAMES,
): AgentTool[] {
  const context: ExecutionToolContext = {
    env: new NodeExecutionEnv({ cwd: workspaceDir }),
  };
  return names.map((name) => bindToolContext(TOOL_FACTORIES[name](), context));
}
