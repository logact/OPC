import type { Server } from 'node:http';
import type { ServerEvent } from '@logact-pub/opc-protocol';
import {
  createDbClient,
  createMessageRepository,
  createParticipantRepository,
  createRoomRepository,
  runMigrations,
} from '@opc/database';
import { OpcClient, OpcHttpClient } from '@logact-pub/opc-sdk';
import { createServer } from '../src/server.js';
import { createMqttBridge, type MqttBridge } from '../src/mqtt-bridge.js';

/**
 * E2E 固定 HTTP 端口 3000：mosquitto.conf 中 go-auth 回调地址是静态配置的。
 * 测试串行执行（vitest.e2e.config.ts fileParallelism: false），端口不冲突。
 */
export const TEST_HTTP_PORT = 3000;
export const TEST_BASE_URL = `http://localhost:${TEST_HTTP_PORT}`;

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

  const eventPublisher: { publish?: (roomId: string, event: ServerEvent) => void } = {};
  let server: Server | undefined;
  let bridge: MqttBridge | undefined;

  try {
    server = createServer({
      db,
      mqttSuperuser: { username: TEST_MQTT.username, password: TEST_MQTT.password },
      eventPublisher: {
        publish: (roomId, event) => eventPublisher.publish?.(roomId, event),
      },
    });
    await new Promise<void>((resolve, reject) => {
      server!.listen(TEST_HTTP_PORT, () => resolve()).on('error', reject);
    });

    bridge = createMqttBridge({
      brokerUrl: TEST_MQTT.brokerUrl,
      username: TEST_MQTT.username,
      password: TEST_MQTT.password,
      participantRepo: createParticipantRepository(db),
      roomRepo: createRoomRepository(db),
      messageRepo: createMessageRepository(db),
    });
    await Promise.race([
      bridge.ready,
      new Promise<void>((_, reject) => {
        setTimeout(
          () => reject(new Error('MQTT bridge did not become ready within 10s')),
          10000
        );
      }),
    ]);
    eventPublisher.publish = (roomId, event) => bridge.publish(roomId, event);
  } catch (err) {
    // broker 不可用时 bridge.ready 会 reject；避免测试进程残留 HTTP server/端口
    await bridge?.close().catch(() => {});
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await db.$client.end();
    throw err;
  }

  return {
    baseUrl: TEST_BASE_URL,
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

/**
 * 以下辅助函数全部通过 @logact-pub/opc-sdk 驱动被测 server,
 * 保证 e2e 覆盖的路径与 mobile 实际消费 SDK 的路径一致。
 */

/** 管理面操作走 SDK 的 HTTP 客户端 */
export function createHttpClient(): OpcHttpClient {
  return new OpcHttpClient(TEST_BASE_URL);
}

/** 注册参与者并返回 MQTT 登录 token */
export async function registerParticipant(id: string, name?: string): Promise<string> {
  const { token } = await createHttpClient().registerParticipant(id, name);
  return token;
}

/** 建立 SDK 实时连接，等待 broker 认证通过 */
export async function connectSdkClient(participantId: string, token: string): Promise<OpcClient> {
  const client = new OpcClient({
    baseUrl: TEST_BASE_URL,
    brokerUrl: TEST_MQTT.brokerUrl,
    participantId,
    token,
  });
  await client.connect();
  return client;
}

/** 等待 SDK 事件总线上的下一个指定类型事件 */
export function waitForEvent<T extends ServerEvent['type']>(
  client: OpcClient,
  type: T
): Promise<Extract<ServerEvent, { type: T }>> {
  return new Promise((resolve) => {
    client.events.once(type, (event) => resolve(event as Extract<ServerEvent, { type: T }>));
  });
}
