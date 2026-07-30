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
import { createLogger } from './logger.js';

const logger = createLogger('edge-app');

const mode = process.argv[2] ?? process.env.EDGE_MODE;
logger.info('starting opc edge app', { mode });
if (mode === 'gateway') {
  startGateway()
    .then((gateway) => {
      logger.info('gateway started, registering signal handlers');
      process.on('SIGINT', () => {
        logger.info('received SIGINT, stopping gateway');
        void gateway.stop().then(() => process.exit(0));
      });
    })
    .catch((err: unknown) => {
      logger.error('gateway fatal error', { error: err instanceof Error ? err.message : String(err) });
      process.exit(1);
    });
} else {
  const config = loadConfig();
  logger.info('starting legacy edge runtime', { nodeId: config.nodeId, serverUrl: config.serverUrl });
  startEdgeRuntime(config)
    .then(async (agent) => {
      if (agent && process.stdin.isTTY) {
        logger.info('agent runtime ready, starting repl');
        await startRepl(agent, process.argv[2]);
      }
    })
    .catch((err: unknown) => {
      logger.error('edge runtime fatal error', { error: err instanceof Error ? err.message : String(err) });
      process.exit(1);
    });
}
