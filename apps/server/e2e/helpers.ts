import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { CapabilityGrant, GatewayCommand, ServerEvent } from '@logact-pub/opc-protocol';
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
  /** 本 server 实际使用的 database URL（默认指向独立临时 schema），供测试直连 DB 校验持久化 */
  databaseUrl: string;
  server: Server;
  bridge: MqttBridge;
  cleanup: () => Promise<void>;
}

const DEFAULT_DATABASE_URL = 'postgres://opc:opc@localhost:5432/opc';

function databaseUrlWithSchema(baseUrl: string, schemaName: string): string {
  if (!/^opc_e2e_[a-f0-9]+$/.test(schemaName)) {
    throw new Error(`unsafe temporary schema name: ${schemaName}`);
  }
  const url = new URL(baseUrl);
  url.searchParams.set('options', `-csearch_path=${schemaName},public`);
  return url.toString();
}

interface CachedOwner {
  id: string;
  token: string;
  accessToken: string;
  http: OpcHttpClient;
}

let cachedOwner: CachedOwner | undefined;

/**
 * 按 database URL 记住已 bootstrap 的 owner：同一数据库上的 server 重启
 * （cleanup → startTestServer）不能再次匿名注册（hasOwner 已为 true），
 * 但旧凭据仍然有效，重新登录刷新 JWT 即可复用。
 */
const ownerByDatabase = new Map<string, CachedOwner>();

/**
 * 为需要跨 startTestServer 调用共享同一数据库的用例（如 server 重启）创建
 * 独立临时 schema；调用方负责在结束时 drop。
 */
export async function createSharedTestDatabase(): Promise<{
  databaseUrl: string;
  migrationsSchema: string;
  drop: () => Promise<void>;
}> {
  const baseUrl = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const migrationsSchema = `opc_e2e_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
  const admin = createDbClient(baseUrl);
  await admin.$client.query(`CREATE SCHEMA "${migrationsSchema}"`);
  return {
    databaseUrl: databaseUrlWithSchema(baseUrl, migrationsSchema),
    migrationsSchema,
    drop: async () => {
      ownerByDatabase.delete(databaseUrlWithSchema(baseUrl, migrationsSchema));
      await admin.$client.query(`DROP SCHEMA IF EXISTS "${migrationsSchema}" CASCADE`).catch(() => {});
      await admin.$client.end().catch(() => {});
    },
  };
}

export async function startTestServer(
  databaseUrl = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
  options: { migrationsSchema?: string } = {}
): Promise<TestServer> {
  // 默认每次启动独占一个临时 PG schema（search_path 隔离）：
  // #116 之后 bootstrap 注册 owner 要求库中尚无 owner（hasOwner=false），
  // 共享 public schema 时前一个测试文件创建的 owner 会让后续 bootstrap 401。
  // 显式传入 options.migrationsSchema 时由调用方负责创建/销毁 schema。
  const tempSchema = options.migrationsSchema
    ? undefined
    : `opc_e2e_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
  const scopedDatabaseUrl = tempSchema ? databaseUrlWithSchema(databaseUrl, tempSchema) : databaseUrl;
  const admin = tempSchema ? createDbClient(databaseUrl) : undefined;
  if (admin && tempSchema) {
    await admin.$client.query(`CREATE SCHEMA "${tempSchema}"`);
  }
  const cleanupSchema = async () => {
    if (admin && tempSchema) {
      await admin.$client.query(`DROP SCHEMA IF EXISTS "${tempSchema}" CASCADE`).catch(() => {});
      await admin.$client.end().catch(() => {});
    }
  };

  const db = createDbClient(scopedDatabaseUrl);
  try {
    await runMigrations(db, { migrationsSchema: options.migrationsSchema ?? tempSchema });
  } catch (err) {
    await db.$client.end().catch(() => {});
    await cleanupSchema();
    throw err;
  }

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
      // e2e 依赖未鉴权的首个人类注册 bootstrap owner（issue #122 后默认关闭，测试显式打开）
      allowOpenBootstrap: true,
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

    // Bootstrap the first Owner: an empty database allows the first human
    // registration without authentication, after which owner auth is required.
    // 同一数据库上的重启复用此前 bootstrap 的 owner 凭据。
    const existingOwner = ownerByDatabase.get(scopedDatabaseUrl);
    if (existingOwner) {
      const ownerHttp = createHttpClient();
      const { accessToken } = await ownerHttp.login(existingOwner.id, DEFAULT_PASSWORD);
      ownerHttp.setAccessToken(accessToken);
      cachedOwner = { ...existingOwner, accessToken, http: ownerHttp };
    } else {
      const ownerHttp = createHttpClient();
      const ownerId = `e2e-owner-${randomUUID()}`;
      const { token: ownerToken } = await ownerHttp.registerParticipant(
        ownerId,
        ownerId,
        DEFAULT_PASSWORD
      );
      const { accessToken: ownerAccessToken } = await ownerHttp.login(ownerId, DEFAULT_PASSWORD);
      ownerHttp.setAccessToken(ownerAccessToken);
      cachedOwner = {
        id: ownerId,
        token: ownerToken,
        accessToken: ownerAccessToken,
        http: ownerHttp,
      };
      ownerByDatabase.set(scopedDatabaseUrl, cachedOwner);
    }
  } catch (err) {
    // 任何一步失败（含 bootstrap）都要完整回收资源：
    // 避免测试进程残留 HTTP server/端口，或遗留临时 schema
    cachedOwner = undefined;
    await bridge?.close().catch(() => {});
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await db.$client.end().catch(() => {});
    await cleanupSchema();
    throw err;
  }

  if (!server || !bridge) {
    throw new Error('test server or MQTT bridge was not initialized');
  }

  return {
    baseUrl: TEST_BASE_URL,
    databaseUrl: scopedDatabaseUrl,
    server,
    bridge,
    cleanup: async () => {
      cachedOwner = undefined;
      await bridge.close();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      await db.$client.end();
      // 自动临时 schema 随 cleanup 销毁，对应 owner 凭据一并失效；
      // 显式共享 schema 由调用方管理，凭据保留供 server 重启后复用。
      if (tempSchema) ownerByDatabase.delete(scopedDatabaseUrl);
      await cleanupSchema();
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

/**
 * 房间内订阅/收发消息所需的最小 capability 组合。
 * self scope：participant 只能在自己所属（创建或成员）的房间内读/发。
 */
export const SELF_MESSAGING_GRANTS: CapabilityGrant[] = [
  { capability: 'message.read', scope: { type: 'self' } },
  { capability: 'message.send', scope: { type: 'self' } },
];

/**
 * 以 Owner 身份为 participant 授予 capability（issue #112 enforced RBAC）：
 * 非 Owner participant 默认无任何 position grant，需要 message.read /
 * message.send / room.create 等能力的用例通过本函数显式授权
 * （每次调用新建独立 department + position + assignment）。
 */
export async function grantCapabilities(
  participantId: string,
  grants: CapabilityGrant[]
): Promise<void> {
  if (!cachedOwner) {
    throw new Error('grantCapabilities: startTestServer must be called first');
  }
  const http = cachedOwner.http;
  const { department } = await http.createDepartment({ name: `e2e-grant-${randomUUID()}` });
  const { position } = await http.createPosition({
    departmentId: department.id,
    name: `e2e-grant-${randomUUID()}`,
    capabilityGrants: grants,
  });
  await http.createStaffAssignment(participantId, { positionId: position.id });
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
