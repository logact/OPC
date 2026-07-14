import type { Server } from 'node:http';
import {
  createDbClient,
  createMessageRepository,
  createParticipantRepository,
  createRoomRepository,
  runMigrations,
} from '@opc/database';
import { API_ROUTES, type RegisterParticipantResponse } from '@opc/protocol';
import { createServer } from '../src/server.js';
import { createMqttBridge, type MqttBridge } from '../src/mqtt-bridge.js';

/**
 * E2E 固定 HTTP 端口 3000：mosquitto.conf 中 go-auth 回调地址是静态配置的。
 * 测试串行执行（vitest.e2e.config.ts fileParallelism: false），端口不冲突。
 */
export const TEST_HTTP_PORT = 3000;

export const TEST_MQTT = {
  brokerUrl: process.env.MQTT_BROKER_URL ?? 'mqtt://localhost:1883',
  username: process.env.MQTT_SERVER_USERNAME ?? '__server__',
  password: process.env.MQTT_SERVER_PASSWORD ?? 'e2e-superuser-secret',
} as const;

export interface TestServer {
  baseUrl: string;
  server: Server;
  bridge: MqttBridge;
  cleanup: () => Promise<void>;
}

export async function startTestServer(): Promise<TestServer> {
  const databaseUrl = process.env.DATABASE_URL ?? 'postgres://opc:opc@localhost:5432/opc';
  const db = createDbClient(databaseUrl);
  await runMigrations(db);

  const server = createServer({
    db,
    mqttSuperuser: { username: TEST_MQTT.username, password: TEST_MQTT.password },
  });
  await new Promise<void>((resolve, reject) => {
    server.listen(TEST_HTTP_PORT, () => resolve()).on('error', reject);
  });

  const bridge = createMqttBridge({
    brokerUrl: TEST_MQTT.brokerUrl,
    username: TEST_MQTT.username,
    password: TEST_MQTT.password,
    participantRepo: createParticipantRepository(db),
    roomRepo: createRoomRepository(db),
    messageRepo: createMessageRepository(db),
  });
  await bridge.ready;

  return {
    baseUrl: `http://localhost:${TEST_HTTP_PORT}`,
    server,
    bridge,
    cleanup: async () => {
      await bridge.close();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      await db.$client.end();
    },
  };
}

/** 注册参与者并返回 MQTT 登录 token */
export async function registerParticipant(id: string): Promise<string> {
  const res = await fetch(`http://localhost:${TEST_HTTP_PORT}${API_ROUTES.participants}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  if (!res.ok) throw new Error(`registerParticipant(${id}) failed: ${res.status}`);
  const { token } = (await res.json()) as RegisterParticipantResponse;
  return token;
}
