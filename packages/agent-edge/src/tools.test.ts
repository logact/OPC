import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { AgentMessage, ThreadStatus } from './IAgent.js';
import { AgentRuntime } from './agent.js';
import { COMPLETE_TASK_TOOL, PiThread } from './thread.js';
import {
  CLI_MAX_OUTPUT_CHARS,
  EXECUTION_TOOL_NAMES,
  createExecutionTools,
  type CliProcess,
  type CliSpawnFn,
} from './tools.js';
import { createFakeStreamFn, fakeModel, type FakeReply, type FakeStream } from './testing.js';

describe('createExecutionTools', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'opc-agent-tools-'));
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it('builds the full bash/read/write/edit set by default', () => {
    const tools = createExecutionTools(workspace);
    expect(tools.map((tool) => tool.name)).toEqual([...EXECUTION_TOOL_NAMES]);
  });

  it('trims the set to the requested names', () => {
    const tools = createExecutionTools(workspace, ['read']);
    expect(tools.map((tool) => tool.name)).toEqual(['read']);
  });

  it('executes bash for real, rooted at the workspace directory', async () => {
    const [bash] = createExecutionTools(workspace, ['bash']);
    const result = await bash.execute('call-1', {
      command: "printf 'hello-opc' > greeting.txt",
    });
    expect(JSON.stringify(result.content)).not.toContain('error');
    expect(readFileSync(join(workspace, 'greeting.txt'), 'utf8')).toBe('hello-opc');
  });

  it('reads files relative to the workspace directory', async () => {
    const [bash, read] = createExecutionTools(workspace, ['bash', 'read']);
    await bash.execute('call-1', { command: "printf 'from-workspace' > note.txt" });
    const result = await read.execute('call-2', { path: 'note.txt' });
    expect(JSON.stringify(result.content)).toContain('from-workspace');
  });
});

describe('PiThread execution tools (issue #136)', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'opc-agent-thread-tools-'));
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  function setup(
    script: FakeReply[],
    options?: { mode?: 'goal' | 'chat'; withTools?: boolean },
  ) {
    const outbound: AgentMessage[] = [];
    const statuses: { status: ThreadStatus; summary?: string }[] = [];
    const fake: FakeStream = createFakeStreamFn(script);
    const thread = new PiThread({
      threadId: 't1',
      goal: 'write a greeting file and read it back',
      agentId: 'a1',
      model: fakeModel(),
      streamFn: fake.streamFn,
      mode: options?.mode,
      executionTools:
        options?.withTools === false ? undefined : createExecutionTools(workspace),
      workspaceDir: workspace,
      hooks: {
        emitOutbound: (message) => outbound.push(message),
        emitStatus: (_threadId, status, detail) =>
          statuses.push({ status, summary: detail?.summary }),
      },
    });
    return { thread, outbound, statuses, fake };
  }

  it('goal mode runs the model-scripted bash/read calls for real, inside the workspace', async () => {
    const { thread, statuses, fake } = setup([
      { kind: 'toolCall', name: 'bash', args: { command: "printf 'hello-opc' > greeting.txt" } },
      { kind: 'toolCall', name: 'read', args: { path: 'greeting.txt' } },
      { kind: 'toolCall', name: COMPLETE_TASK_TOOL, args: { summary: 'file written and read' } },
    ]);

    await thread.start();

    expect((await thread.getInfo()).status).toBe('done');
    expect(statuses.at(-1)).toMatchObject({ status: 'done', summary: 'file written and read' });
    // The bash command really executed, relative to the per-agent workspace.
    expect(readFileSync(join(workspace, 'greeting.txt'), 'utf8')).toBe('hello-opc');
    // The read result reached the model on the follow-up call.
    expect(fake.callCount()).toBe(3);
    expect(JSON.stringify(fake.contexts[2]?.messages)).toContain('hello-opc');
  });

  it('goal mode exposes the execution tools and workspace in the system prompt', async () => {
    const { thread, fake } = setup([
      { kind: 'toolCall', name: COMPLETE_TASK_TOOL, args: {} },
    ]);

    await thread.start();

    const context = fake.contexts[0];
    expect(context.tools?.map((tool) => tool.name)).toEqual([
      COMPLETE_TASK_TOOL,
      'bash',
      'read',
      'write',
      'edit',
      'codex',
      'kimi',
      'claude',
    ]);
    expect(context.systemPrompt).toContain('- bash');
    expect(context.systemPrompt).toContain(workspace);
  });

  it('goal mode without execution tools keeps only the completion tool', async () => {
    const { thread, fake } = setup(
      [{ kind: 'toolCall', name: COMPLETE_TASK_TOOL, args: {} }],
      { withTools: false },
    );

    await thread.start();

    expect(fake.contexts[0]?.tools?.map((tool) => tool.name)).toEqual([COMPLETE_TASK_TOOL]);
  });

  it('chat mode stays tool-less even when execution tools are provided', async () => {
    const { thread, outbound, fake } = setup([{ kind: 'text', text: 'hi there' }], {
      mode: 'chat',
    });

    await thread.start();

    expect((await thread.getInfo()).status).toBe('waiting');
    expect(outbound.map((m) => m.content.body)).toEqual(['hi there']);
    expect(fake.contexts[0]?.tools ?? []).toEqual([]);
    await thread.terminate();
  });

  it('AgentRuntime passes execution tools through to goal-mode threads', async () => {
    const fake = createFakeStreamFn([
      { kind: 'toolCall', name: 'bash', args: { command: "printf 'via-runtime' > runtime.txt" } },
      { kind: 'toolCall', name: COMPLETE_TASK_TOOL, args: {} },
    ]);
    const agent = new AgentRuntime({
      agentId: 'a1',
      model: fakeModel(),
      streamFn: fake.streamFn,
      executionTools: createExecutionTools(workspace),
      workspaceDir: workspace,
    });
    await agent.start();
    const threadId = await agent.createThread({ goal: 'write runtime.txt' });

    await agent.startThread(threadId);

    expect((await agent.getThread(threadId)).status).toBe('done');
    expect(readFileSync(join(workspace, 'runtime.txt'), 'utf8')).toBe('via-runtime');
    await agent.destroy();
  });
});


describe('CLI delegate tools (issue #144)', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'opc-agent-cli-tools-'));
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  interface FakeCliProc extends EventEmitter {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: MockInstance<() => void>;
  }

  function fakeSpawn(behavior?: (proc: FakeCliProc) => void) {
    const calls: {
      command: string;
      args: string[];
      options: { cwd: string };
      proc: FakeCliProc;
    }[] = [];
    const spawnFn: CliSpawnFn = (command, args, options) => {
      const proc = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        kill: vi.fn(() => {
          queueMicrotask(() => proc.emit('close', null, 'SIGTERM'));
        }),
      }) as FakeCliProc;
      calls.push({ command, args, options, proc });
      // Defer so runCli's listeners are attached before any output/close.
      queueMicrotask(() => behavior?.(proc));
      return proc as unknown as CliProcess;
    };
    return { spawnFn, calls };
  }

  function succeed(text: string) {
    return (proc: FakeCliProc) => {
      proc.stdout.emit('data', Buffer.from(text));
      proc.emit('close', 0, null);
    };
  }

  interface CliDetails {
    exitCode: number | null;
    timedOut: boolean;
    aborted: boolean;
    spawnError?: string;
  }

  async function runTool(name: 'codex' | 'kimi' | 'claude', spawnFn: CliSpawnFn, args: object) {
    const [tool] = createExecutionTools(workspace, [name], { spawn: spawnFn });
    const result = await tool.execute('call-1', args);
    return {
      tool,
      text: (result.content[0] as { text: string }).text,
      details: result.details as CliDetails,
    };
  }

  it('joins the default execution tool set', () => {
    const tools = createExecutionTools(workspace);
    expect(tools.map((tool) => tool.name)).toContain('codex');
    expect(tools.map((tool) => tool.name)).toContain('kimi');
    expect(tools.map((tool) => tool.name)).toContain('claude');
  });

  it('codex: spawns `codex exec` with full-access flags, cwd = workspace', async () => {
    const { spawnFn, calls } = fakeSpawn(succeed('codex says hi'));
    const { text, details } = await runTool('codex', spawnFn, {
      prompt: 'fix the bug',
      model: 'gpt-5',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe('codex');
    expect(calls[0].args).toEqual([
      'exec',
      '--dangerously-bypass-approvals-and-sandbox',
      '--skip-git-repo-check',
      '--model',
      'gpt-5',
      'fix the bug',
    ]);
    expect(calls[0].options.cwd).toBe(workspace);
    expect(text).toContain('codex says hi');
    expect(text).toContain('[exit code: 0]');
    expect(details).toMatchObject({ exitCode: 0, timedOut: false, aborted: false });
  });

  it('kimi: spawns `kimi --prompt <prompt> --auto`', async () => {
    const { spawnFn, calls } = fakeSpawn(succeed('kimi done'));
    await runTool('kimi', spawnFn, { prompt: 'write tests' });
    expect(calls[0].command).toBe('kimi');
    expect(calls[0].args).toEqual(['--prompt', 'write tests', '--auto']);
  });

  it('claude: spawns `claude --print --dangerously-skip-permissions`', async () => {
    const { spawnFn, calls } = fakeSpawn(succeed('claude done'));
    await runTool('claude', spawnFn, { prompt: 'refactor module', model: 'sonnet' });
    expect(calls[0].command).toBe('claude');
    expect(calls[0].args).toEqual([
      '--print',
      '--dangerously-skip-permissions',
      '--model',
      'sonnet',
      'refactor module',
    ]);
  });

  it('surfaces stderr and a non-zero exit code in the result text', async () => {
    const { spawnFn } = fakeSpawn((proc) => {
      proc.stderr.emit('data', Buffer.from('boom'));
      proc.emit('close', 2, null);
    });
    const { text, details } = await runTool('codex', spawnFn, { prompt: 'x' });
    expect(text).toContain('[stderr]');
    expect(text).toContain('boom');
    expect(text).toContain('[exit code: 2]');
    expect(details).toMatchObject({ exitCode: 2 });
  });

  it('kills the child when the abort signal fires (thread pause/terminate)', async () => {
    const { spawnFn, calls } = fakeSpawn();
    const controller = new AbortController();
    const [tool] = createExecutionTools(workspace, ['codex'], { spawn: spawnFn });
    const pending = tool.execute('call-1', { prompt: 'x' }, controller.signal);
    await new Promise((resolve) => setImmediate(resolve));
    controller.abort();
    const result = await pending;
    expect(calls[0].proc.kill).toHaveBeenCalledWith('SIGTERM');
    expect((result.content[0] as { text: string }).text).toContain('[killed: aborted]');
    expect(result.details).toMatchObject({ aborted: true });
  });

  it('kills the child on timeout', async () => {
    const { spawnFn } = fakeSpawn(); // never closes on its own; kill() closes
    const { text, details } = await runTool('codex', spawnFn, { prompt: 'x', timeout: 0.05 });
    expect(text).toContain('[killed: timed out]');
    expect(details).toMatchObject({ timedOut: true });
  });

  it('truncates oversized output to protect model context', async () => {
    const big = 'y'.repeat(CLI_MAX_OUTPUT_CHARS + 10_000);
    const { spawnFn } = fakeSpawn(succeed(big));
    const { text } = await runTool('claude', spawnFn, { prompt: 'x' });
    expect(text).toContain('leading chars truncated');
    expect(text.length).toBeLessThan(CLI_MAX_OUTPUT_CHARS + 1_000);
  });

  it('reports a missing CLI binary instead of throwing', async () => {
    const { spawnFn } = fakeSpawn((proc) => {
      proc.emit('error', new Error('spawn codex ENOENT'));
    });
    const { text, details } = await runTool('codex', spawnFn, { prompt: 'x' });
    expect(text).toContain('Failed to start "codex"');
    expect(text).toContain('ENOENT');
    expect(details).toMatchObject({ spawnError: 'spawn codex ENOENT' });
  });
});
