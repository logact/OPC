import { hostname } from 'node:os';
import { AgentGateway } from '@opc/agent-gateway';
import { OpcHttpClient } from '@logact-pub/opc-sdk';

export interface GatewayEnv {
  EDGE_GATEWAY_ID?: string;
  EDGE_GATEWAY_TOKEN?: string;
  OPC_SERVER_URL?: string;
  OPC_BROKER_URL?: string;
  EDGE_MODEL_PROVIDER?: string;
  EDGE_MODEL_ID?: string;
  EDGE_MODEL_API_KEY?: string;
}

export async function startGateway(env: GatewayEnv = process.env): Promise<AgentGateway> {
  const gatewayId = env.EDGE_GATEWAY_ID ?? `gw-${hostname()}-${process.pid}`;
  const serverUrl = env.OPC_SERVER_URL ?? 'http://localhost:3000';
  const brokerUrl = env.OPC_BROKER_URL ?? 'mqtt://localhost:1883';

  const token = env.EDGE_GATEWAY_TOKEN
    ? env.EDGE_GATEWAY_TOKEN
    : await (async () => {
        const http = new OpcHttpClient(serverUrl);
        const response = await http.registerParticipant(gatewayId, undefined, undefined, 'gateway');
        console.log(`[gateway ${gatewayId}] self-registered, token acquired`);
        return response.token;
      })();

  const modelConfig = env.EDGE_MODEL_ID
    ? {
        provider: env.EDGE_MODEL_PROVIDER ?? 'anthropic',
        modelId: env.EDGE_MODEL_ID,
        ...(env.EDGE_MODEL_API_KEY ? { apiKey: env.EDGE_MODEL_API_KEY } : {}),
      }
    : undefined;

  const gateway = new AgentGateway({
    gatewayId,
    serverUrl,
    brokerUrl,
    token,
    ...(modelConfig && { modelOptions: modelConfig }),
  });

  await gateway.start();
  console.log(`[gateway ${gatewayId}] running, server: ${serverUrl}, broker: ${brokerUrl}`);
  return gateway;
}
