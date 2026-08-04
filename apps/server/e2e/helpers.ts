import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { GatewayCommand, ServerEvent } from '@logact-pub/opc-protocol';
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

const TEST_JWT_SECRET = 'e2e-test-secret-must-be-at-least-32-characters';
export const DEFAULT_PASSWORD = 'e2e-password';

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

interface CachedOwner {
  id: string;
  token: string;
  accessToken: string;
  http: OpcHttpClient;
}

let cachedOwner: CachedOwner | undefined;

export async function startTestServer(
  databaseUrl = process.env.DATABASE_URL ?? 'postgres://opc:opc@localhost:5432/opc',
  options: { migrationsSchema?: string } = {}
): Promise<TestServer> {
  const db = createDbClient(databaseUrl);
  await runMigrations(db, { migrationsSchema: options.migrationsSchema });

  const eventPublisher: {
    publish?: (roomId: string, event: ServerEvent) => void;
    publishGatewayCommand?: (gatewayId: string, command: GatewayCommand) => void;
  } = {};
  let server: Server | undefined;
  let bridge: MqttBridge | undefined;

  try {
    server = createServer({
      db,
      jwtSecret: TEST_JWT_SECRET,
      mqttSuperuser: { username: TEST_MQTT.username, password: TEST_MQTT.password },
      eventPublisher: {
        publish: (roomId, event) => eventPublisher.publish?.(roomId, event),
        publishGatewayCommand: (gatewayId, command) =>
          eventPublisher.publishGatewayCommand?.(gatewayId, command),
      },
    });
    await new Promise<void>((resolve, reject) => {
      server!.listen(TEST_HTTP_PORT, () => resolve()).on('error', reject);
    });

    const createdBridge = createMqttBridge({
      brokerUrl: TEST_MQTT.brokerUrl,
      username: TEST_MQTT.username,
      password: TEST_MQTT.password,
      participantRepo: createParticipantRepository(db),
      roomRepo: createRoomRepository(db),
      messageRepo: createMessageRepository(db),
    });
    bridge = createdBridge;
    await Promise.race([
      createdBridge.ready,
      new Promise<void>((_, reject) => {
        setTimeout(
          () => reject(new Error('MQTT bridge did not become ready within 10s')),
          10000
        );
      }),
    ]);
    eventPublisher.publish = (roomId, event) => createdBridge.publish(roomId, event);
    eventPublisher.publishGatewayCommand = (gatewayId, command) =>
      createdBridge.publishGatewayCommand(gatewayId, command);
  } catch (err) {
    // broker 不可用时 bridge.ready 会 reject；避免测试进程残留 HTTP server/端口
    await bridge?.close().catch(() => {});
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await db.$client.end();
    throw err;
  }

  if (!server || !bridge) {
    throw new Error('test server or MQTT bridge was not initialized');
  }

  // Bootstrap the first Owner: an empty database allows the first human
  // registration without authentication, after which owner auth is required.
  const ownerHttp = createHttpClient();
  const ownerId = `e2e-owner-${randomUUID()}`;
  const { token: ownerToken } = await ownerHttp.registerParticipant(
    ownerId,
    ownerId,
    DEFAULT_PASSWORD
  );
  const { accessToken: ownerAccessToken } = await ownerHttp.login(ownerId, DEFAULT_PASSWORD);
  ownerHttp.setAccessToken(ownerAccessToken);
  cachedOwner = { id: ownerId, token: ownerToken, accessToken: ownerAccessToken, http: ownerHttp };

  return {
    baseUrl: TEST_BASE_URL,
    server,
    bridge,
    cleanup: async () => {
      cachedOwner = undefined;
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

/** 以 Owner 身份注册参与者并返回 MQTT 登录 token */
export async function registerParticipant(
  id: string,
  name?: string,
  password = DEFAULT_PASSWORD
): Promise<string> {
  if (!cachedOwner) {
    throw new Error('registerParticipant: startTestServer must be called first');
  }
  const { token } = await cachedOwner.http.registerParticipant(id, name, password);
  return token;
}

/** 返回已登录的 Owner HTTP 客户端（由 startTestServer 自动 bootstrap） */
export async function createAuthenticatedHttpClient(): Promise<OpcHttpClient> {
  if (!cachedOwner) {
    throw new Error('createAuthenticatedHttpClient: startTestServer must be called first');
  }
  await Promise.resolve();
  return cachedOwner.http;
}

/** 返回 bootstrap Owner 的 participant id */
export function getOwnerId(): string {
  if (!cachedOwner) {
    throw new Error('getOwnerId: startTestServer must be called first');
  }
  return cachedOwner.id;
}

/** 返回 bootstrap Owner 的 MQTT 登录 token */
export function getOwnerToken(): string {
  if (!cachedOwner) {
    throw new Error('getOwnerToken: startTestServer must be called first');
  }
  return cachedOwner.token;
}

/** 返回 bootstrap Owner 的 HTTP access token（JWT） */
export function getOwnerAccessToken(): string {
  if (!cachedOwner) {
    throw new Error('getOwnerAccessToken: startTestServer must be called first');
  }
  return cachedOwner.accessToken;
}

/** 建立 SDK 实时连接，等待 broker 认证通过 */
export async function connectSdkClient(participantId: string, token: string): Promise<OpcClient> {
  const http = createHttpClient();
  const { accessToken } = await http.login(participantId, DEFAULT_PASSWORD);
  const client = new OpcClient({
    baseUrl: TEST_BASE_URL,
    brokerUrl: TEST_MQTT.brokerUrl,
    participantId,
    token,
    accessToken,
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
