/**
 * Interactive terminal REPL for a running AgentRuntime — the interim
 * interaction surface until the MQTT gateway lands. One thread at a time:
 * the goal is fixed at thread creation (argv[2] or a chat default), each
 * input line is delivered via receiveMessage, and outbound text is printed
 * as it arrives.
 *
 * Commands:
 * - /new <goal>  start a fresh thread (threads are single-goal; a done/error
 *   thread never restarts)
 * - /quit        terminate the agent and exit
 */

import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import type { AgentMessage, IAgent, ThreadId } from '@opc/agent-edge';

const DEFAULT_GOAL =
  'Chat with the user in the terminal. Answer their questions helpfully and concisely.';

export async function startRepl(agent: IAgent, goal: string = DEFAULT_GOAL): Promise<void> {
  let threadId: ThreadId | null = null;

  agent.onMessage((message) => {
    if (message.threadId !== threadId) return;
    process.stdout.write(`\nagent> ${message.content.body}\n`);
  });
  agent.onStatusChange((event) => {
    if (event.threadId !== threadId) return;
    if (event.status === 'done' || event.status === 'error' || event.status === 'terminated') {
      console.log(`\n[repl] thread ${event.status}; start a fresh one with /new <goal>`);
    }
  });

  const newThread = async (threadGoal: string): Promise<void> => {
    threadId = await agent.createThread({ goal: threadGoal });
    console.log(`[repl] thread ${threadId} running; goal: ${threadGoal}`);
    // startThread resolves on the thread's first settle (waiting/done/error).
    await agent.startThread(threadId);
  };

  await newThread(goal);

  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: 'you> ' });
  rl.prompt();
  for await (const line of rl) {
    const input = line.trim();
    if (input.length === 0 || input === '/quit' || input === '/exit') {
      if (input !== '') break;
      rl.prompt();
      continue;
    }
    if (input.startsWith('/new ')) {
      await newThread(input.slice('/new '.length));
      rl.prompt();
      continue;
    }
    if (threadId == null) {
      rl.prompt();
      continue;
    }
    const message: AgentMessage = {
      id: randomUUID(),
      timestamp: Date.now(),
      from: 'user',
      threadId,
      content: { type: 'text', body: input },
    };
    try {
      // From "waiting" this resolves once the thread settles again, so the
      // reply has been printed by the time the prompt returns.
      await agent.receiveMessage(message);
    } catch (err) {
      console.log(`[repl] rejected: ${err instanceof Error ? err.message : String(err)}`);
    }
    rl.prompt();
  }
  rl.close();
  await agent.terminate();
}
