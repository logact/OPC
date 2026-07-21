import { OpcHttpClient } from '@logact-pub/opc-sdk';
import { Agent } from './agent.js';
import { bootstrapAgents, credentialsPath } from './bootstrap.js';
import { loadConfig } from './config.js';
import { Gateway } from './gateway.js';
import { createEngine } from './tools/index.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const http = new OpcHttpClient(config.baseUrl);
  const credentials = await bootstrapAgents(http, config.agents, config.roomId, credentialsPath(config.dataDir));

  const agents = config.agents.map(
    (agentConfig) => new Agent(agentConfig, createEngine(agentConfig.engine), config, credentials[agentConfig.id]),
  );
  const gateway = new Gateway(agents, config.defaultAgentId);
  await gateway.start();

  const shutdown = () => {
    void gateway.stop().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[agent-runtime] fatal:', err);
  process.exit(1);
});
