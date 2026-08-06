/**
 * @opc/agent-edge — lightweight agent runtime for edge devices.
 *
 * The agent runtime (IAgent contract) is implemented on
 * @earendil-works/pi-agent-core; the MQTT gateway adapter and tool engine
 * plug in on top in later iterations.
 */

export * from './IAgent.js';
export * from './agent.js';
export * from './thread.js';
export * from './mapping.js';
export * from './model.js';
export * from './tools.js';

import { AgentRuntime } from './agent.js';
import { createModelConfig, createModelConfigFromEnv, type EdgeModelOptions } from './model.js';

export interface EdgeConfig {
  /** Unique identifier of this edge node. */
  nodeId: string;
  /** OPC server base URL the edge node connects to. */
  serverUrl: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): EdgeConfig {
  return {
    nodeId: env.EDGE_NODE_ID ?? `edge-${process.pid}`,
    serverUrl: env.OPC_SERVER_URL ?? 'http://localhost:3000',
  };
}

export async function startEdgeRuntime(
  config: EdgeConfig,
  modelOptions?: EdgeModelOptions,
): Promise<AgentRuntime | undefined> {
  console.log(`[edge] node ${config.nodeId} starting, server: ${config.serverUrl}`);
  const modelConfig = modelOptions
    ? createModelConfig(modelOptions)
    : process.env.EDGE_MODEL_ID
      ? createModelConfigFromEnv()
      : undefined;
  if (!modelConfig) {
    console.log('[edge] no model config given and EDGE_MODEL_ID not set; agent runtime not started');
    return undefined;
  }
  const { model, streamFn } = modelConfig;
  const agent = new AgentRuntime({ model, streamFn });
  await agent.start();
  console.log(`[edge] agent runtime ${agent.agentId} running (model ${model.provider}/${model.id})`);
  // TODO: connect gateway, register tool engine.
  return agent;
}
