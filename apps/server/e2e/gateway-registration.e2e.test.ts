import { describe, expect, it } from 'vitest';
import {
  GatewayCommandSchema,
  MQTT_TOPICS,
  type AgentModelConfig,
} from '@logact-pub/opc-protocol';
import { connect as mqttConnect, type MqttClient } from 'mqtt';
import { createHttpClient, startTestServer, TEST_MQTT } from './helpers.js';

/**
 * Issue #64：gateway 注册与 agent.spawn 配置转发。
 *
 * 覆盖的契约：
 * 1. ParticipantKind 新增 'gateway'，GET /api/v1/participants 支持 ?kind= 过滤
 *    （SDK: listParticipants(kind?: ParticipantKind)）。
 * 2. 注册 agent（kind: 'agent' + gatewayId + name + model）时，server 将 name/model
 *    转发进发布到 opc/gateways/{gatewayId}/control 的 agent.spawn 命令
 *    （SDK: registerParticipant(id, name?, password?, kind?, gatewayId?, model?)）。
 * 3. 不带 model 注册 agent 的向后兼容行为与 issue #60 一致。
 *
 * 管理面通过 @logact-pub/opc-sdk 驱动；控制 topic 只有 gateway 自身可订阅（ACL），
 * 因此这里以 gateway 身份（username = gatewayId, password = token）建立原始 MQTT
 * 连接来捕获 spawn 命令，与 contract.test.ts 的原始 MQTT 用法一致。
 */

/** 以 gateway 身份建立原始 MQTT 连接（控制 topic 仅 gateway 自身可订阅） */
function connectAsGateway(gatewayId: string, token: string): Promise<MqttClient> {
  return new Promise((resolve, reject) => {
    const client = mqttConnect(TEST_MQTT.brokerUrl, { username: gatewayId, password: token });
    const onError = (err: Error) => {
      client.end(true);
      reject(err);
    };
    client.once('connect', () => {
      client.removeListener('error', onError);
      resolve(client);
    });
    client.once('error', onError);
  });
}

function subscribe(client: MqttClient, topic: string): Promise<void> {
  return new Promise((resolve, reject) => {
    client.subscribe(topic, { qos: 1 }, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

function nextMessage(client: MqttClient): Promise<unknown> {
  return new Promise((resolve) => {
    client.once('message', (_topic, payload) => {
      resolve(JSON.parse(payload.toString('utf8')));
    });
  });
}

function endClient(client: MqttClient): Promise<void> {
  return new Promise((resolve) => client.end(false, {}, () => resolve()));
}

describe('Gateway registration & spawn config (issue #64)', () => {
  it('discovers gateways via the kind filter on listParticipants', async () => {
    const { cleanup } = await startTestServer();

    try {
      const http = createHttpClient();
      const suffix = Date.now();
      const gatewayId = `gw-disc-${suffix}`;
      const humanId = `human-disc-${suffix}`;

      // ParticipantKind 新增 'gateway'
      await http.registerParticipant(gatewayId, undefined, undefined, 'gateway');
      await http.registerParticipant(humanId);

      // 未过滤列表同时包含 gateway 与 human
      const all = await http.listParticipants();
      expect(all.participants.some((p) => p.id === gatewayId && p.kind === 'gateway')).toBe(true);
      expect(all.participants.some((p) => p.id === humanId)).toBe(true);

      // ?kind=gateway 只返回 gateway
      const gateways = await http.listParticipants('gateway');
      expect(gateways.participants.some((p) => p.id === gatewayId)).toBe(true);
      expect(gateways.participants.every((p) => p.kind === 'gateway')).toBe(true);
      expect(gateways.participants.some((p) => p.id === humanId)).toBe(false);

      // ?kind=human 不返回 gateway
      const humans = await http.listParticipants('human');
      expect(humans.participants.some((p) => p.id === humanId)).toBe(true);
      expect(humans.participants.every((p) => p.kind === 'human')).toBe(true);
      expect(humans.participants.some((p) => p.id === gatewayId)).toBe(false);
    } finally {
      await cleanup();
    }
  });

  it('forwards name and model into the agent.spawn command on the control topic', async () => {
    const { cleanup } = await startTestServer();
    let client: MqttClient | undefined;

    try {
      const http = createHttpClient();
      const suffix = Date.now();
      const gatewayId = `gw-fwd-${suffix}`;
      const agentId = `agent-fwd-${suffix}`;
      const agentName = `Forward Agent ${suffix}`;
      const model: AgentModelConfig = {
        provider: 'anthropic',
        modelId: 'claude-sonnet-4-5-20250929',
        apiKey: 'test-key',
      };

      const { token: gatewayToken } = await http.registerParticipant(gatewayId);

      // 先订阅控制 topic，再注册 agent（spawn 命令在注册时发布）
      client = await connectAsGateway(gatewayId, gatewayToken);
      await subscribe(client, MQTT_TOPICS.gatewayControl(gatewayId));
      const commandReceived = nextMessage(client);

      const { token: agentToken } = await http.registerParticipant(
        agentId,
        agentName,
        undefined,
        'agent',
        gatewayId,
        model
      );

      const command = GatewayCommandSchema.parse(await commandReceived);
      if (command.type !== 'agent.spawn') {
        throw new Error(`expected agent.spawn command, got ${command.type}`);
      }
      expect(command.participantId).toBe(agentId);
      expect(command.token).toBe(agentToken);
      // server 必须把注册请求中的 name / model 原样转发进 spawn 命令
      expect(command.name).toBe(agentName);
      expect(command.model).toEqual(model);
    } finally {
      if (client) await endClient(client);
      await cleanup();
    }
  });

  it('publishes a valid agent.spawn command without name/model (issue #60 backward compat)', async () => {
    const { cleanup } = await startTestServer();
    let client: MqttClient | undefined;

    try {
      const http = createHttpClient();
      const suffix = Date.now();
      const gatewayId = `gw-compat-${suffix}`;
      const agentId = `agent-compat-${suffix}`;

      const { token: gatewayToken } = await http.registerParticipant(gatewayId);

      client = await connectAsGateway(gatewayId, gatewayToken);
      await subscribe(client, MQTT_TOPICS.gatewayControl(gatewayId));
      const commandReceived = nextMessage(client);

      // 与 issue #60 相同的注册方式：不提供 name / model
      const { token: agentToken } = await http.registerParticipant(
        agentId,
        undefined,
        undefined,
        'agent',
        gatewayId
      );

      const command = GatewayCommandSchema.parse(await commandReceived);
      if (command.type !== 'agent.spawn') {
        throw new Error(`expected agent.spawn command, got ${command.type}`);
      }
      expect(command.participantId).toBe(agentId);
      expect(command.token).toBe(agentToken);
      expect(command.name).toBeUndefined();
      expect(command.model).toBeUndefined();
    } finally {
      if (client) await endClient(client);
      await cleanup();
    }
  });
});
