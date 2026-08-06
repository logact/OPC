import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentMessage, ThreadStatus } from './IAgent.js';
import { AgentRuntime } from './agent.js';
import { COMPLETE_TASK_TOOL, PiThread } from './thread.js';
import { EXECUTION_TOOL_NAMES, createExecutionTools } from './tools.js';
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
