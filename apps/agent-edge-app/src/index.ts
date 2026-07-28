/**
 * @opc-pub/agent-edge-app — published CLI entry for edge agent runtimes.
 *
 * Mode dispatch:
 * - `gateway` (argv[2] or EDGE_MODE=gateway): runs @opc/agent-gateway.
 * - otherwise: legacy single-agent REPL via @opc/agent-edge.
 *
 * When installed globally, `opc-gateway` maps to ./dist/cli.js and always
 * starts the gateway.
 */

import { loadConfig, startEdgeRuntime } from '@opc/agent-edge';
import { startRepl } from './repl.js';
import { startGateway } from './gateway.js';

const mode = process.argv[2] ?? process.env.EDGE_MODE;

if (mode === 'gateway') {
  startGateway()
    .then((gateway) => {
      process.on('SIGINT', () => {
        void gateway.stop().then(() => process.exit(0));
      });
    })
    .catch((err: unknown) => {
      console.error('[gateway] fatal:', err);
      process.exit(1);
    });
} else {
  startEdgeRuntime(loadConfig())
    .then(async (agent) => {
      if (agent && process.stdin.isTTY) await startRepl(agent, process.argv[2]);
    })
    .catch((err: unknown) => {
      console.error('[edge] fatal:', err);
      process.exit(1);
    });
}
