#!/usr/bin/env node
/**
 * `opc-gateway` global CLI entry point.
 *
 * Usage:
 *   opc-gateway              # same as opc-gateway start
 *   opc-gateway start        # start the agent gateway
 *   opc-gateway --help       # show usage
 */

import { startGateway } from './gateway.js';

function showHelp(): void {
  console.log(`opc-gateway v${process.env.npm_package_version ?? 'dev'}

Usage:
  opc-gateway [start]     Start the agent gateway
  opc-gateway --help      Show this help

Environment variables:
  EDGE_GATEWAY_ID         Gateway participant id (default: gw-<hostname>-<pid>)
  EDGE_GATEWAY_TOKEN      MQTT/HTTP token (optional; auto-registered if empty)
  OPC_SERVER_URL          OPC HTTP server URL (default: http://localhost:3000)
  OPC_BROKER_URL          MQTT broker URL (default: mqtt://localhost:1883)
  EDGE_MODEL_PROVIDER     LLM provider (default: anthropic)
  EDGE_MODEL_ID           LLM model id
  EDGE_MODEL_API_KEY      LLM API key
`);
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

  console.error(`[opc-gateway] unknown command: ${command}`);
  showHelp();
  process.exit(1);
}

main().catch((err: unknown) => {
  console.error('[opc-gateway] fatal:', err);
  process.exit(1);
});
