/**
 * @opc/agent-edge-app — CLI entry for the @opc/agent-edge runtime.
 *
 * Boots the edge runtime from env config; argv[2], when given, is the thread
 * goal, otherwise the REPL chats.
 */

import { loadConfig, startEdgeRuntime } from '@opc/agent-edge';
import { startRepl } from './repl.js';

startEdgeRuntime(loadConfig())
  .then(async (agent) => {
    if (agent && process.stdin.isTTY) await startRepl(agent, process.argv[2]);
  })
  .catch((err: unknown) => {
    console.error('[edge] fatal:', err);
    process.exit(1);
  });
