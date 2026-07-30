import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import { AgentGateway } from '@opc/agent-gateway';
import { OpcHttpClient } from '@logact-pub/opc-sdk';
import { createLogger } from './logger.js';

export interface GatewayEnv {
  EDGE_GATEWAY_ID?: string;
  EDGE_GATEWAY_TOKEN?: string;
  OPC_SERVER_URL?: string;
  OPC_BROKER_URL?: string;
  EDGE_MODEL_PROVIDER?: string;
  EDGE_MODEL_ID?: string;
  EDGE_MODEL_API_KEY?: string;
  EDGE_MODEL_BASE_URL?: string;
  EDGE_ADMIN_HOST?: string;
  EDGE_ADMIN_PORT?: string;
  /** SQLite 状态库路径（离线补投水位持久化），默认 ~/.opc-gateway/state.db */
  EDGE_STATE_DB?: string;
}

export const DEFAULT_ADMIN_HOST = '127.0.0.1';
export const DEFAULT_ADMIN_PORT = 4646;

const logger = createLogger('gateway');

export async function startGateway(env: GatewayEnv = process.env): Promise<AgentGateway> {
  logger.debug('starting gateway', { env: Object.keys(env) });
  const gatewayId = env.EDGE_GATEWAY_ID ?? `gw-${hostname()}-${process.pid}`;
  const serverUrl = env.OPC_SERVER_URL ?? 'http://localhost:3000';
  const brokerUrl = env.OPC_BROKER_URL ?? 'mqtt://localhost:1883';
  const adminHost = env.EDGE_ADMIN_HOST ?? DEFAULT_ADMIN_HOST;
  const adminPort = env.EDGE_ADMIN_PORT ? Number(env.EDGE_ADMIN_PORT) : DEFAULT_ADMIN_PORT;

  const token = env.EDGE_GATEWAY_TOKEN
    ? env.EDGE_GATEWAY_TOKEN
    : await (async () => {
        logger.info('registering gateway with server', { gatewayId, serverUrl });
        const http = new OpcHttpClient(serverUrl);
        const response = await http.registerParticipant(gatewayId, undefined, undefined, 'gateway');
        logger.info('gateway self-registered, token acquired', { gatewayId });
        return response.token;
      })();

  const modelConfig = env.EDGE_MODEL_ID
    ? {
        provider: env.EDGE_MODEL_PROVIDER ?? 'anthropic',
        modelId: env.EDGE_MODEL_ID,
        ...(env.EDGE_MODEL_API_KEY ? { apiKey: env.EDGE_MODEL_API_KEY } : {}),
        ...(env.EDGE_MODEL_BASE_URL ? { baseUrl: env.EDGE_MODEL_BASE_URL } : {}),
      }
    : undefined;

  if (modelConfig) {
    logger.info('using configured edge model', { provider: modelConfig.provider, modelId: modelConfig.modelId });
  } else {
    logger.info('no edge model configured; agents must be spawned with a model');
  }

  const gateway = new AgentGateway({
    gatewayId,
    serverUrl,
    brokerUrl,
    token,
    ...(modelConfig && { modelOptions: modelConfig }),
    admin: {
      host: adminHost,
      port: adminPort,
    },
    stateDbPath: env.EDGE_STATE_DB ?? join(homedir(), '.opc-gateway', 'state.db'),
  });

  logger.info('starting agent gateway runtime', { gatewayId, serverUrl, brokerUrl, adminHost, adminPort });
  await gateway.start();
  logger.info('agent gateway running', { gatewayId, serverUrl, brokerUrl });
  return gateway;
}
