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
 *
 * CLI delegate tools (issue #144) — `codex` / `kimi` / `claude` spawn the
 * local coding-agent CLIs in non-interactive, full-access mode so a goal-mode
 * agent can delegate work to them. Child processes inherit the gateway
 * process environment (API keys live in the gateway `.env`) and run with
 * cwd = the agent workspace. The workspace anchors cwd only — it is NOT a
 * sandbox, and the CLIs run with their full-access flags.
 */

import { spawn } from 'node:child_process';
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
import { Type, type TSchema } from 'typebox';

/** CLI delegate tool names (issue #144). */
export const CLI_TOOL_NAMES = ['codex', 'kimi', 'claude'] as const;
export type CliToolName = (typeof CLI_TOOL_NAMES)[number];

/** Names of the execution tools an agent can be equipped with. */
export type ExecutionToolName = 'bash' | 'read' | 'write' | 'edit' | CliToolName;

export const EXECUTION_TOOL_NAMES: readonly ExecutionToolName[] = [
  'bash',
  'read',
  'write',
  'edit',
  ...CLI_TOOL_NAMES,
];

export function isCliToolName(name: ExecutionToolName): name is CliToolName {
  return (CLI_TOOL_NAMES as readonly string[]).includes(name);
}

/** Binary spawned (and availability-probed) for each CLI delegate tool. */
export const CLI_TOOL_COMMANDS: Record<CliToolName, string> = {
  codex: 'codex',
  kimi: 'kimi',
  claude: 'claude',
};

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
  Exclude<ExecutionToolName, CliToolName>,
  () => AgentHarnessTool<ExecutionToolContext, TSchema, unknown>
> = {
  bash: () => createBashTool(),
  read: () => createReadTool(),
  write: () => createWriteTool(),
  edit: () => createEditTool(),
};

// ---------------------------------------------------------------------------
// CLI delegate tools (issue #144)
// ---------------------------------------------------------------------------

/** Upper bound for a CLI run's combined output, to protect model context. */
export const CLI_MAX_OUTPUT_CHARS = 50_000;

/** Default max run time of one CLI invocation, in seconds. */
export const CLI_DEFAULT_TIMEOUT_S = 600;

const CLI_PARAMETERS = Type.Object({
  prompt: Type.String({
    description: 'The task the CLI coding agent should accomplish autonomously.',
  }),
  model: Type.Optional(
    Type.String({ description: 'Override the model the CLI uses for this run.' }),
  ),
  timeout: Type.Optional(
    Type.Number({
      description: `Max run time in seconds before the CLI process is killed. Defaults to ${CLI_DEFAULT_TIMEOUT_S}.`,
    }),
  ),
});

interface CliParams {
  prompt: string;
  model?: string;
  timeout?: number;
}

/**
 * Minimal child-process shape used by the CLI tools — injectable so tests can
 * mock spawn. The real adapter wraps `node:child_process` spawn; the child
 * inherits the gateway process environment.
 */
export interface CliProcess {
  stdout: NodeJS.EventEmitter;
  stderr: NodeJS.EventEmitter;
  kill(signal?: NodeJS.Signals): void;
  once(event: 'error', listener: (err: Error) => void): void;
  once(
    event: 'close',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): void;
}

export type CliSpawnFn = (
  command: string,
  args: string[],
  options: { cwd: string },
) => CliProcess;

const defaultSpawn: CliSpawnFn = (command, args, options) =>
  spawn(command, args, { cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'] });

interface CliToolSpec {
  name: CliToolName;
  label: string;
  description: string;
  buildArgs: (params: CliParams) => string[];
}

const FULL_ACCESS_NOTE =
  'The CLI runs non-interactively with FULL access (permission checks disabled), rooted at your working directory — which anchors cwd only and is NOT a sandbox. Auth comes from the gateway process environment (e.g. API keys in the gateway .env).';

const CLI_TOOL_SPECS: Record<CliToolName, CliToolSpec> = {
  codex: {
    name: 'codex',
    label: 'Codex CLI',
    description: `Delegate a task to the local Codex coding agent (codex CLI). ${FULL_ACCESS_NOTE}`,
    buildArgs: ({ prompt, model }) => [
      'exec',
      '--dangerously-bypass-approvals-and-sandbox',
      '--skip-git-repo-check',
      ...(model ? ['--model', model] : []),
      prompt,
    ],
  },
  kimi: {
    name: 'kimi',
    label: 'Kimi CLI',
    description: `Delegate a task to the local Kimi coding agent (kimi CLI). ${FULL_ACCESS_NOTE}`,
    buildArgs: ({ prompt, model }) => [
      '--prompt',
      prompt,
      '--auto',
      ...(model ? ['--model', model] : []),
    ],
  },
  claude: {
    name: 'claude',
    label: 'Claude Code CLI',
    description: `Delegate a task to the local Claude Code coding agent (claude CLI). ${FULL_ACCESS_NOTE}`,
    buildArgs: ({ prompt, model }) => [
      '--print',
      '--dangerously-skip-permissions',
      ...(model ? ['--model', model] : []),
      prompt,
    ],
  },
};

interface CliRunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  spawnError?: string;
  timedOut: boolean;
  aborted: boolean;
}

function runCli(
  spawnFn: CliSpawnFn,
  command: string,
  args: string[],
  cwd: string,
  timeoutS: number,
  signal?: AbortSignal,
): Promise<CliRunResult> {
  return new Promise((resolve) => {
    let child: CliProcess;
    try {
      child = spawnFn(command, args, { cwd });
    } catch (err) {
      resolve({
        stdout: '',
        stderr: '',
        exitCode: null,
        spawnError: err instanceof Error ? err.message : String(err),
        timedOut: false,
        aborted: false,
      });
      return;
    }

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;
    let aborted = false;
    let settled = false;

    const finish = (result: Omit<CliRunResult, 'stdout' | 'stderr'>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve({
        ...result,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
      });
    };

    const onAbort = () => {
      aborted = true;
      child.kill('SIGTERM');
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutS * 1000);
    // A CLI timeout must not keep the gateway process alive on its own.
    timer.unref?.();

    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
    child.once('error', (err) =>
      finish({ exitCode: null, spawnError: err.message, timedOut, aborted }),
    );
    child.once('close', (code) => finish({ exitCode: code, timedOut, aborted }));

    if (signal?.aborted) {
      onAbort();
    } else {
      signal?.addEventListener('abort', onAbort, { once: true });
    }
  });
}

function truncateOutput(text: string): string {
  if (text.length <= CLI_MAX_OUTPUT_CHARS) return text;
  const dropped = text.length - CLI_MAX_OUTPUT_CHARS;
  return `[... ${dropped} leading chars truncated ...]\n${text.slice(dropped)}`;
}

function formatCliResult(spec: CliToolSpec, result: CliRunResult): string {
  if (result.spawnError !== undefined) {
    return `Failed to start "${CLI_TOOL_COMMANDS[spec.name]}": ${result.spawnError}. Is the CLI installed and on PATH?`;
  }
  const parts: string[] = [];
  if (result.stdout.length > 0) parts.push(result.stdout.trimEnd());
  if (result.stderr.length > 0) parts.push(`[stderr]\n${result.stderr.trimEnd()}`);
  if (result.timedOut) parts.push('[killed: timed out]');
  if (result.aborted) parts.push('[killed: aborted]');
  parts.push(`[exit code: ${result.exitCode ?? 'none'}]`);
  return truncateOutput(parts.join('\n\n'));
}

function createCliTool(
  spec: CliToolSpec,
  workspaceDir: string,
  spawnFn: CliSpawnFn,
): AgentTool {
  return {
    name: spec.name,
    label: spec.label,
    description: spec.description,
    parameters: CLI_PARAMETERS,
    execute: async (_toolCallId, params, signal) => {
      const { prompt, model, timeout } = params as CliParams;
      const result = await runCli(
        spawnFn,
        CLI_TOOL_COMMANDS[spec.name],
        spec.buildArgs({ prompt, model }),
        workspaceDir,
        timeout ?? CLI_DEFAULT_TIMEOUT_S,
        signal,
      );
      return {
        content: [{ type: 'text' as const, text: formatCliResult(spec, result) }],
        details: {
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          aborted: result.aborted,
          spawnError: result.spawnError,
        },
      };
    },
  };
}

export interface ExecutionToolsDeps {
  /** Test hook: override the child-process spawner used by the CLI tools. */
  spawn?: CliSpawnFn;
}

/**
 * Creates the execution tool set for one agent, rooted at `workspaceDir`.
 * `names` trims the set (e.g. `['read']` for a read-only agent); defaults to
 * the full set (bash/read/write/edit + the codex/kimi/claude CLI delegates).
 * Unknown names are ignored.
 */
export function createExecutionTools(
  workspaceDir: string,
  names: readonly ExecutionToolName[] = EXECUTION_TOOL_NAMES,
  deps: ExecutionToolsDeps = {},
): AgentTool[] {
  const context: ExecutionToolContext = {
    env: new NodeExecutionEnv({ cwd: workspaceDir }),
  };
  return names.map((name) =>
    isCliToolName(name)
      ? createCliTool(CLI_TOOL_SPECS[name], workspaceDir, deps.spawn ?? defaultSpawn)
      : bindToolContext(TOOL_FACTORIES[name](), context),
  );
}
