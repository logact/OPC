#!/usr/bin/env node
/**
 * `opc-gateway` global CLI entry point.
 *
 * Usage:
 *   opc-gateway              # same as opc-gateway start
 *   opc-gateway start        # start the agent gateway
 *   opc-gateway status       # show running gateway info and status
 *   opc-gateway agents ...   # manage agents on the running gateway
 *   opc-gateway threads ...  # inspect agent threads
 *   opc-gateway repl         # interactive shell for the commands above
 *   opc-gateway --help       # show usage
 */

import { createInterface } from 'node:readline/promises';
import { OpcHttpClient } from '@logact-pub/opc-sdk';
import { AdminClient } from './admin-client.js';
import { startGateway } from './gateway.js';

function showHelp(): void {
  console.log(`opc-gateway v${process.env.npm_package_version ?? 'dev'}

Usage:
  opc-gateway [start]                Start the agent gateway
  opc-gateway status                 Show gateway info and runtime status
  opc-gateway agents list            List agents running on the gateway
  opc-gateway agents info <id>       Show one agent's details
  opc-gateway agents spawn <id>      Register an agent participant; the server
                                     instructs this gateway to spawn it
  opc-gateway agents stop <id>       Stop an agent on the gateway
  opc-gateway threads list [--agent <id>]
                                     List threads (one agent, or all)
  opc-gateway threads history <agentId> <threadId>
                                     Show a thread's message history
  opc-gateway repl                   Interactive shell for the commands above
  opc-gateway --help                 Show this help

Environment variables:
  EDGE_GATEWAY_ID         Gateway participant id (default: gw-<hostname>-<pid>)
  EDGE_GATEWAY_TOKEN      MQTT/HTTP token (optional; auto-registered if empty)
  OPC_SERVER_URL          OPC HTTP server URL (default: http://localhost:3000)
  OPC_BROKER_URL          MQTT broker URL (default: mqtt://localhost:1883)
  EDGE_MODEL_PROVIDER     LLM provider (default: anthropic)
  EDGE_MODEL_ID           LLM model id
  EDGE_MODEL_API_KEY      LLM API key
  EDGE_MODEL_BASE_URL     Override the provider catalog base URL (optional)
  EDGE_ADMIN_HOST         Admin server bind host (default: 127.0.0.1)
  EDGE_ADMIN_PORT         Admin server port (default: 4646)
`);
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

function printTable(headers: string[], rows: string[][]): void {
  const widths = headers.map((header, i) =>
    Math.max(header.length, ...rows.map((row) => (row[i] ?? '').length))
  );
  console.log(headers.map((header, i) => pad(header, widths[i])).join('  '));
  for (const row of rows) {
    console.log(row.map((cell, i) => pad(cell ?? '', widths[i])).join('  '));
  }
}

async function cmdStatus(client: AdminClient): Promise<void> {
  const status = await client.getStatus();
  console.log(`gateway:  ${status.gatewayId}`);
  console.log(`server:   ${status.serverUrl}`);
  console.log(`broker:   ${status.brokerUrl} (${status.mqttConnected ? 'connected' : 'disconnected'})`);
  console.log(`started:  ${status.startedAt} (uptime ${status.uptimeSec}s)`);
  console.log(`agents:   ${status.agentCount}${status.agentIds.length ? ` — ${status.agentIds.join(', ')}` : ''}`);
}

async function cmdAgents(args: string[], client: AdminClient): Promise<void> {
  const action = args[0] ?? 'list';

  if (action === 'list') {
    const agents = await client.listAgents();
    if (agents.length === 0) {
      console.log('no agents running');
      return;
    }
    printTable(
      ['AGENT', 'STATUS', 'ACTIVITY', 'THREADS'],
      agents.map((entry) => [
        entry.participantId,
        entry.info.status,
        entry.info.activity,
        String(entry.info.threadIds.length),
      ])
    );
    return;
  }

  const id = args[1];
  if (!id) {
    throw new Error(`missing agent id: opc-gateway agents ${action} <id>`);
  }

  if (action === 'info') {
    const entry = await client.getAgent(id);
    console.log(`agent:    ${entry.participantId}`);
    console.log(`status:   ${entry.info.status}`);
    console.log(`activity: ${entry.info.activity}`);
    if (entry.info.role) console.log(`role:     ${entry.info.role}`);
    console.log(`threads:  ${entry.info.threadIds.length ? entry.info.threadIds.join(', ') : '(none)'}`);
    return;
  }

  if (action === 'stop') {
    await client.stopAgent(id);
    console.log(`stopped agent ${id}`);
    return;
  }

  if (action === 'spawn') {
    // 走 server 管理面：注册 kind=agent 的 participant 后，
    // server 会向 gateway 控制 topic 下发 agent.spawn。
    const serverUrl = process.env.OPC_SERVER_URL ?? 'http://localhost:3000';
    const gatewayId = process.env.EDGE_GATEWAY_ID;
    if (!gatewayId) {
      throw new Error('EDGE_GATEWAY_ID is required for spawn (must match the running gateway)');
    }
    const http = new OpcHttpClient(serverUrl);
    await http.registerParticipant(id, undefined, undefined, 'agent', gatewayId);
    console.log(`registered agent ${id}; gateway ${gatewayId} will spawn it shortly`);
    return;
  }

  throw new Error(`unknown agents action: ${action}`);
}

async function cmdThreads(args: string[], client: AdminClient): Promise<void> {
  const action = args[0] ?? 'list';

  if (action === 'list') {
    const agentFlagIndex = args.indexOf('--agent');
    const agentFilter = agentFlagIndex >= 0 ? args[agentFlagIndex + 1] : undefined;

    const agentIds = agentFilter ? [agentFilter] : (await client.listAgents()).map((entry) => entry.participantId);
    if (agentIds.length === 0) {
      console.log('no agents running');
      return;
    }

    const rows: string[][] = [];
    for (const agentId of agentIds) {
      const threads = await client.listThreads(agentId);
      for (const thread of threads) {
        rows.push([agentId, thread.threadId, thread.status, thread.roomId ?? '-', thread.goal]);
      }
    }
    if (rows.length === 0) {
      console.log('no threads');
      return;
    }
    printTable(['AGENT', 'THREAD', 'STATUS', 'ROOM', 'GOAL'], rows);
    return;
  }

  if (action === 'history') {
    const [agentId, threadId] = [args[1], args[2]];
    if (!agentId || !threadId) {
      throw new Error('usage: opc-gateway threads history <agentId> <threadId>');
    }
    const messages = await client.getThreadMessages(agentId, threadId);
    if (messages.length === 0) {
      console.log('(no messages)');
      return;
    }
    for (const message of messages) {
      const time = new Date(message.timestamp).toISOString();
      console.log(`[${time}] ${message.from}: ${message.content.body}`);
    }
    return;
  }

  throw new Error(`unknown threads action: ${action}`);
}

/** 执行一条管理命令（单发模式与 repl 共用）。 */
async function dispatchCommand(args: string[], client: AdminClient): Promise<void> {
  const command = args[0];
  if (command === 'status') {
    await cmdStatus(client);
    return;
  }
  if (command === 'agents') {
    await cmdAgents(args.slice(1), client);
    return;
  }
  if (command === 'threads') {
    await cmdThreads(args.slice(1), client);
    return;
  }
  if (command === 'help') {
    showHelp();
    return;
  }
  throw new Error(`unknown command: ${command ?? ''} (try "help")`);
}

/** 交互式 shell：逐行读取管理命令并执行，exit/quit 或 Ctrl-D 退出。 */
async function startCliRepl(client: AdminClient): Promise<void> {
  console.log('opc-gateway interactive shell — commands: status, agents ..., threads ..., help, exit');
  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: 'opc-gateway> ' });
  rl.prompt();
  for await (const line of rl) {
    const input = line.trim();
    if (input === 'exit' || input === 'quit') break;
    if (input.length > 0) {
      if (input === 'start' || input.startsWith('start ')) {
        console.log("[repl] 'start' is not available here; run `opc-gateway start` in a separate terminal");
      } else {
        try {
          await dispatchCommand(input.split(/\s+/), client);
        } catch (err) {
          console.error(`[opc-gateway] ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
    rl.prompt();
  }
  rl.close();
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === '--help' || command === '-h') {
    showHelp();
    return;
  }

  if (command === undefined || command === 'start') {
    const gateway = await startGateway();
    process.on('SIGINT', () => {
      void gateway.stop().then(() => process.exit(0));
    });
    process.on('SIGTERM', () => {
      void gateway.stop().then(() => process.exit(0));
    });
    return;
  }

  const client = new AdminClient();
  if (command === 'repl') {
    await startCliRepl(client);
    return;
  }
  if (command === 'status' || command === 'agents' || command === 'threads') {
    await dispatchCommand(args, client);
    return;
  }

  console.error(`[opc-gateway] unknown command: ${command}`);
  showHelp();
  process.exit(1);
}

main().catch((err: unknown) => {
  console.error('[opc-gateway]', err instanceof Error ? err.message : err);
  process.exit(1);
});
