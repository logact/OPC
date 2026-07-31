import { createAdaptorServer } from '@hono/node-server';
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { logger } from 'hono/logger';
import { Scalar } from '@scalar/hono-api-reference';
import { SignJWT, jwtVerify } from 'jose';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Server as HttpServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMessage } from '@logact-pub/opc-core';
import {
  API_ROUTES,
  MQTT_ACL,
  parseAgentEventsTopic,
  parseGatewayControlTopic,
  parsePresenceTopic,
  parseRoomTopic,
} from '@logact-pub/opc-protocol';
import {
  AddRoomMembersRequestSchema,
  AddRoomMembersResponseSchema,
  BroadcastMessageRequestSchema,
  BroadcastMessageResponseSchema,
  CreateDirectRoomRequestSchema,
  CreateDirectRoomResponseSchema,
  CreateRoomRequestSchema,
  CreateRoomResponseSchema,
  GetMessageResponseSchema,
  GetParticipantResponseSchema,
  GetRoomResponseSchema,
  ListParticipantsQuerySchema,
  ListParticipantsResponseSchema,
  ListRoomsResponseSchema,
  LoginRequestSchema,
  LoginResponseSchema,
  MqttAuthAclRequestSchema,
  MqttAuthSuperuserRequestSchema,
  MqttAuthUserRequestSchema,
  RegisterParticipantRequestSchema,
  RegisterParticipantResponseSchema,
  RoomHistoryQuerySchema,
  RoomHistoryResponseSchema,
  UpdateParticipantRequestSchema,
  UpdateParticipantResponseSchema,
  UpdateRoomRequestSchema,
  UpdateRoomResponseSchema,
} from '@logact-pub/opc-protocol';
import type { GatewayCommand, ServerEvent } from '@logact-pub/opc-protocol';
import {
  createDbClient,
  createMessageRepository,
  createParticipantRepository,
  createRoomRepository,
} from '@opc/database';

export type { DbClient } from '@opc/database';

export interface MqttSuperuser {
  username: string;
  password: string;
}

export interface ServerOptions {
  db: ReturnType<typeof createDbClient>;
  /** JWT 签名密钥 */
  jwtSecret: string;
  /** JWT 有效期，例如 '7d'、'1h' */
  jwtExpiresIn?: string;
  /** mqtt-bridge 的连接身份；broker 回调 superuser/user 检查时据此判定 */
  mqttSuperuser: MqttSuperuser;
  /** 用于 HTTP 广播/成员加入事件向 MQTT events topic 发布，以及向 gateway 下发控制命令 */
  eventPublisher?: {
    publish(roomId: string, event: ServerEvent): void;
    publishGatewayCommand?(gatewayId: string, command: GatewayCommand): void;
  };
}

const ErrorResponseSchema = z.object({ error: z.string() }).openapi('ErrorResponse');

const idParamSchema = z.object({ id: z.string() }).openapi('IdParam');

export function createServer({
  db,
  jwtSecret,
  jwtExpiresIn = '7d',
  mqttSuperuser,
  eventPublisher,
}: ServerOptions): HttpServer {
  const roomRepo = createRoomRepository(db);
  const participantRepo = createParticipantRepository(db);
  const messageRepo = createMessageRepository(db);
  const secretBytes = new TextEncoder().encode(jwtSecret);

  const packageJson = JSON.parse(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../package.json'), 'utf-8'),
  ) as { version: string };

  const app = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json({ error: result.error.issues[0]?.message ?? 'validation failed' }, 400);
      }
    },
  });

  // 全量请求日志：覆盖所有 HTTP 入口（含 OpenAPI 路由、/docs、404）
  app.use(logger());

  app.notFound((c) => c.json({ error: 'not found' }, 404));

  // ---- Auth middleware ----

  app.use('/api/v1/*', async (c, next) => {
    // 公开端点放行
    if (c.req.path.startsWith('/api/v1/auth/')) return next();
    if (c.req.method === 'POST' && c.req.path === API_ROUTES.participants) return next();
    // gateway 发现：列出 participants（可按 kind 过滤）无需鉴权，与注册端点一致
    if (c.req.method === 'GET' && c.req.path === API_ROUTES.participants) return next();

    const auth = c.req.header('authorization');
    if (!auth?.startsWith('Bearer ')) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    const token = auth.slice(7);
    // 接受两种 Bearer 凭证：/auth/login 签发的 JWT，以及 register 发放的
    // participant token（与 MQTT CONNECT 同一凭据，mobile 只持有后者）。
    try {
      await jwtVerify(token, secretBytes);
    } catch {
      const participant = await participantRepo.findByToken(token);
      if (!participant) {
        return c.json({ error: 'unauthorized' }, 401);
      }
    }
    await next();
  });

  // ---- Rooms ----

  const createRoomRoute = createRoute({
    method: 'post',
    path: API_ROUTES.rooms,
    request: {
      body: {
        content: { 'application/json': { schema: CreateRoomRequestSchema } },
      },
    },
    responses: {
      201: {
        content: { 'application/json': { schema: CreateRoomResponseSchema } },
        description: 'Room created',
      },
      400: { content: { 'application/json': { schema: ErrorResponseSchema } }, description: 'Bad request' },
    },
    security: [{ bearerAuth: [] }],
    tags: ['Rooms'],
  });

  app.openapi(createRoomRoute, async (c) => {
    const payload = c.req.valid('json');
    const participantIds = payload.participantIds ?? [];
    for (const participantId of participantIds) {
      await participantRepo.ensure(participantId);
    }
    const room = await roomRepo.create(payload.name, participantIds, { type: 'group' });
    return c.json({ roomId: room.id } satisfies { roomId: string }, 201);
  });

  const listRoomsRoute = createRoute({
    method: 'get',
    path: API_ROUTES.rooms,
    responses: {
      200: {
        content: { 'application/json': { schema: ListRoomsResponseSchema } },
        description: 'List of rooms',
      },
    },
    security: [{ bearerAuth: [] }],
    tags: ['Rooms'],
  });

  app.openapi(listRoomsRoute, async (c) => {
    const roomList = await roomRepo.list();
    return c.json({ rooms: roomList }, 200);
  });

  const getRoomRoute = createRoute({
    method: 'get',
    path: '/api/v1/rooms/{id}',
    request: { params: idParamSchema },
    responses: {
      200: { content: { 'application/json': { schema: GetRoomResponseSchema } }, description: 'Room details' },
      404: { content: { 'application/json': { schema: ErrorResponseSchema } }, description: 'Room not found' },
    },
    security: [{ bearerAuth: [] }],
    tags: ['Rooms'],
  });

  app.openapi(getRoomRoute, async (c) => {
    const { id } = c.req.valid('param');
    const room = await roomRepo.findById(id);
    if (!room) return c.json({ error: 'not found' }, 404);
    return c.json({ room }, 200);
  });

  const updateRoomRoute = createRoute({
    method: 'patch',
    path: '/api/v1/rooms/{id}',
    request: {
      params: idParamSchema,
      body: {
        content: { 'application/json': { schema: UpdateRoomRequestSchema } },
      },
    },
    responses: {
      200: { content: { 'application/json': { schema: UpdateRoomResponseSchema } }, description: 'Room updated' },
      404: { content: { 'application/json': { schema: ErrorResponseSchema } }, description: 'Room not found' },
    },
    security: [{ bearerAuth: [] }],
    tags: ['Rooms'],
  });

  app.openapi(updateRoomRoute, async (c) => {
    const { id } = c.req.valid('param');
    const payload = c.req.valid('json');
    const room = await roomRepo.update(id, payload);
    if (!room) return c.json({ error: 'not found' }, 404);
    return c.json({ room }, 200);
  });

  const roomHistoryRoute = createRoute({
    method: 'get',
    path: '/api/v1/rooms/{id}/history',
    request: { params: idParamSchema, query: RoomHistoryQuerySchema },
    responses: {
      200: {
        content: { 'application/json': { schema: RoomHistoryResponseSchema } },
        description: 'Room message history',
      },
      404: { content: { 'application/json': { schema: ErrorResponseSchema } }, description: 'Room not found' },
    },
    security: [{ bearerAuth: [] }],
    tags: ['Rooms'],
  });

  app.openapi(roomHistoryRoute, async (c) => {
    const { id } = c.req.valid('param');
    const { since } = c.req.valid('query');
    const messages = await messageRepo.findByRoomId(id, { since });
    return c.json({ messages }, 200);
  });

  const addRoomMembersRoute = createRoute({
    method: 'post',
    path: '/api/v1/rooms/{id}/members',
    request: {
      params: idParamSchema,
      body: {
        content: { 'application/json': { schema: AddRoomMembersRequestSchema } },
      },
    },
    responses: {
      200: {
        content: { 'application/json': { schema: AddRoomMembersResponseSchema } },
        description: 'Members added',
      },
      404: { content: { 'application/json': { schema: ErrorResponseSchema } }, description: 'Room not found' },
    },
    security: [{ bearerAuth: [] }],
    tags: ['Rooms'],
  });

  app.openapi(addRoomMembersRoute, async (c) => {
    const { id } = c.req.valid('param');
    const payload = c.req.valid('json');

    const room = await roomRepo.findById(id);
    if (!room) return c.json({ error: 'not found' }, 404);

    for (const participantId of payload.participantIds) {
      await participantRepo.ensure(participantId);
    }

    const updatedRoom = await roomRepo.addMembers(id, payload.participantIds);
    if (!updatedRoom) return c.json({ error: 'not found' }, 404);

    for (const participantId of payload.participantIds) {
      if (room.participantIds.includes(participantId)) continue;
      const participant = await participantRepo.findById(participantId);
      if (participant) {
        eventPublisher?.publish(id, { type: 'participant.joined', roomId: id, participant });
      }
    }

    return c.json({ room: updatedRoom }, 200);
  });

  const createDirectRoomRoute = createRoute({
    method: 'post',
    path: API_ROUTES.directRooms,
    request: {
      body: {
        content: { 'application/json': { schema: CreateDirectRoomRequestSchema } },
      },
    },
    responses: {
      201: {
        content: { 'application/json': { schema: CreateDirectRoomResponseSchema } },
        description: 'Direct room created',
      },
      400: { content: { 'application/json': { schema: ErrorResponseSchema } }, description: 'Bad request' },
    },
    security: [{ bearerAuth: [] }],
    tags: ['Rooms'],
  });

  app.openapi(createDirectRoomRoute, async (c) => {
    const payload = c.req.valid('json');
    const [a, b] = payload.participantIds;

    for (const participantId of payload.participantIds) {
      await participantRepo.ensure(participantId);
    }

    const existing = await roomRepo.findDirectRoom(a, b);
    if (existing) {
      return c.json({ roomId: existing.id }, 201);
    }

    const room = await roomRepo.create(`${a}-${b}`, [a, b], { type: 'direct' });
    return c.json({ roomId: room.id }, 201);
  });

  const broadcastMessageRoute = createRoute({
    method: 'post',
    path: '/api/v1/rooms/{id}/broadcast',
    request: {
      params: idParamSchema,
      body: {
        content: { 'application/json': { schema: BroadcastMessageRequestSchema } },
      },
    },
    responses: {
      201: {
        content: { 'application/json': { schema: BroadcastMessageResponseSchema } },
        description: 'Message broadcast',
      },
      404: { content: { 'application/json': { schema: ErrorResponseSchema } }, description: 'Room not found' },
      503: { content: { 'application/json': { schema: ErrorResponseSchema } }, description: 'Event publisher not available' },
    },
    security: [{ bearerAuth: [] }],
    tags: ['Rooms'],
  });

  app.openapi(broadcastMessageRoute, async (c) => {
    const { id } = c.req.valid('param');
    const payload = c.req.valid('json');

    if (!eventPublisher) {
      return c.json({ error: 'event publisher not available' }, 503);
    }

    const room = await roomRepo.findById(id);
    if (!room) return c.json({ error: 'not found' }, 404);

    // Persist the content exactly as sent (type + body). The sender must exist
    // as a participant (messages FK), so ensure even the default 'system'
    // sender — it is hidden from GET /participants instead.
    const from = payload.from ?? 'system';
    await participantRepo.ensure(from);
    const message = createMessage(randomUUID(), id, from, payload.content, { broadcast: true }, payload.intent);
    await messageRepo.insert(id, message);

    const event: ServerEvent = { type: 'message.delivered', message };
    eventPublisher.publish(id, event);

    return c.json({ message }, 201);
  });

  // ---- Participants ----

  const listParticipantsRoute = createRoute({
    method: 'get',
    path: API_ROUTES.participants,
    request: {
      query: ListParticipantsQuerySchema,
    },
    responses: {
      200: {
        content: { 'application/json': { schema: ListParticipantsResponseSchema } },
        description: 'List of participants',
      },
    },
    tags: ['Participants'],
  });

  app.openapi(listParticipantsRoute, async (c) => {
    const { kind, gatewayId } = c.req.valid('query');
    const participantList = await participantRepo.list();
    // Hide the internal broadcast sender (created on demand by the broadcast
    // route to satisfy the messages FK) from contact/member pickers.
    return c.json(
      {
        participants: participantList.filter(
          (p) =>
            p.id !== 'system' &&
            (kind === undefined || p.kind === kind) &&
            (gatewayId === undefined || p.gatewayId === gatewayId)
        ),
      },
      200
    );
  });

  const participantRoomsRoute = createRoute({
    method: 'get',
    path: API_ROUTES.participantRooms('{id}'),
    request: { params: idParamSchema },
    responses: {
      200: {
        content: { 'application/json': { schema: ListRoomsResponseSchema } },
        description: 'Rooms the participant belongs to',
      },
      404: { content: { 'application/json': { schema: ErrorResponseSchema } }, description: 'Participant not found' },
    },
    security: [{ bearerAuth: [] }],
    tags: ['Participants'],
  });

  app.openapi(participantRoomsRoute, async (c) => {
    const { id } = c.req.valid('param');
    const participant = await participantRepo.findById(id);
    if (!participant) return c.json({ error: 'not found' }, 404);
    const roomList = await roomRepo.listByParticipantId(id);
    return c.json({ rooms: roomList }, 200);
  });

  const registerParticipantRoute = createRoute({
    method: 'post',
    path: API_ROUTES.participants,
    request: {
      body: {
        content: { 'application/json': { schema: RegisterParticipantRequestSchema } },
      },
    },
    responses: {
      201: {
        content: { 'application/json': { schema: RegisterParticipantResponseSchema } },
        description: 'Participant registered',
      },
      400: { content: { 'application/json': { schema: ErrorResponseSchema } }, description: 'Bad request' },
    },
    tags: ['Participants'],
  });

  app.openapi(registerParticipantRoute, async (c) => {
    const payload = c.req.valid('json');
    if (typeof payload?.id !== 'string' || payload.id.length === 0) {
      return c.json({ error: 'id is required' }, 400);
    }
    const kind = payload.kind ?? 'human';
    const { participant, token } = await participantRepo.register(
      payload.id,
      payload.name,
      kind,
      payload.password,
      payload.gatewayId
    );
    if (kind === 'agent' && payload.gatewayId) {
      // 持久化 spawn 参数，供 gateway 重连/重启后 server 重发 agent.spawn（issue #84）
      await participantRepo.update(participant.id, {
        metadata: {
          ...participant.metadata,
          spawn: { name: payload.name, model: payload.model },
        },
      });
      // gateway 单连接多路复用后 agent 不再需要独立 MQTT 凭据，不再下发 token
      // （schema 中 token 字段保留为可选兼容层，供旧版 gateway 解析）
      console.log(`[server] agent.spawn -> gateway=${payload.gatewayId} agent=${participant.id}`);
      eventPublisher?.publishGatewayCommand?.(payload.gatewayId, {
        type: 'agent.spawn',
        participantId: participant.id,
        name: payload.name,
        model: payload.model,
      });
    }
    return c.json({ participantId: participant.id, token }, 201);
  });

  const loginRoute = createRoute({
    method: 'post',
    path: API_ROUTES.auth.login,
    request: {
      body: {
        content: { 'application/json': { schema: LoginRequestSchema } },
      },
    },
    responses: {
      200: {
        content: { 'application/json': { schema: LoginResponseSchema } },
        description: 'Login successful',
      },
      401: { content: { 'application/json': { schema: ErrorResponseSchema } }, description: 'Invalid credentials' },
      404: { content: { 'application/json': { schema: ErrorResponseSchema } }, description: 'Participant not found' },
    },
    tags: ['Auth'],
  });

  app.openapi(loginRoute, async (c) => {
    const { username, password } = c.req.valid('json');
    const valid = await participantRepo.verifyPassword(username, password);
    if (!valid) {
      return c.json({ error: 'invalid credentials' }, 401);
    }
    const participant = await participantRepo.findById(username);
    if (!participant) {
      return c.json({ error: 'not found' }, 404);
    }
    const accessToken = await new SignJWT({ sub: participant.id })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(jwtExpiresIn)
      .sign(secretBytes);
    return c.json({ accessToken, participant }, 200);
  });

  const getParticipantRoute = createRoute({
    method: 'get',
    path: '/api/v1/participants/{id}',
    request: { params: idParamSchema },
    responses: {
      200: {
        content: { 'application/json': { schema: GetParticipantResponseSchema } },
        description: 'Participant details',
      },
      404: { content: { 'application/json': { schema: ErrorResponseSchema } }, description: 'Participant not found' },
    },
    security: [{ bearerAuth: [] }],
    tags: ['Participants'],
  });

  app.openapi(getParticipantRoute, async (c) => {
    const { id } = c.req.valid('param');
    const participant = await participantRepo.findById(id);
    if (!participant) return c.json({ error: 'not found' }, 404);
    return c.json({ participant }, 200);
  });

  const updateParticipantRoute = createRoute({
    method: 'patch',
    path: '/api/v1/participants/{id}',
    request: {
      params: idParamSchema,
      body: {
        content: { 'application/json': { schema: UpdateParticipantRequestSchema } },
      },
    },
    responses: {
      200: {
        content: { 'application/json': { schema: UpdateParticipantResponseSchema } },
        description: 'Participant updated',
      },
      400: { content: { 'application/json': { schema: ErrorResponseSchema } }, description: 'Bad request' },
      404: { content: { 'application/json': { schema: ErrorResponseSchema } }, description: 'Participant not found' },
    },
    security: [{ bearerAuth: [] }],
    tags: ['Participants'],
  });

  app.openapi(updateParticipantRoute, async (c) => {
    const { id } = c.req.valid('param');
    const { modelCatalog, ...rest } = c.req.valid('json');
    // modelCatalog 持久化到 participant 的 metadata.modelCatalog，
    // 与已有 metadata 及同请求中的 metadata 合并，不覆盖其他 key。
    let patch = rest;
    if (modelCatalog !== undefined) {
      const existing = await participantRepo.findById(id);
      if (!existing) return c.json({ error: 'not found' }, 404);
      patch = {
        ...rest,
        metadata: { ...existing.metadata, ...rest.metadata, modelCatalog },
      };
    }
    const participant = await participantRepo.update(id, patch);
    if (!participant) return c.json({ error: 'not found' }, 404);
    return c.json({ participant }, 200);
  });

  // ---- Messages ----

  const getMessageRoute = createRoute({
    method: 'get',
    path: '/api/v1/messages/{id}',
    request: { params: idParamSchema },
    responses: {
      200: {
        content: { 'application/json': { schema: GetMessageResponseSchema } },
        description: 'Message details',
      },
      404: { content: { 'application/json': { schema: ErrorResponseSchema } }, description: 'Message not found' },
    },
    security: [{ bearerAuth: [] }],
    tags: ['Messages'],
  });

  app.openapi(getMessageRoute, async (c) => {
    const { id } = c.req.valid('param');
    const message = await messageRepo.findById(id);
    if (!message) return c.json({ error: 'not found' }, 404);
    return c.json({ message }, 200);
  });

  // ---- mosquitto-go-auth HTTP backend callbacks ----

  const mqttUserRoute = createRoute({
    method: 'post',
    path: API_ROUTES.auth.mqttUser,
    request: {
      body: {
        content: { 'application/json': { schema: MqttAuthUserRequestSchema } },
      },
    },
    responses: {
      200: { description: 'Authenticated' },
      403: { description: 'Forbidden' },
    },
    tags: ['MQTT Auth'],
  });

  app.openapi(mqttUserRoute, async (c) => {
    const { username, password } = c.req.valid('json');
    const ok =
      username === mqttSuperuser.username
        ? password === mqttSuperuser.password
        : await participantRepo.verifyToken(username, password);
    return c.json({}, ok ? 200 : 403);
  });

  const mqttSuperuserRoute = createRoute({
    method: 'post',
    path: API_ROUTES.auth.mqttSuperuser,
    request: {
      body: {
        content: { 'application/json': { schema: MqttAuthSuperuserRequestSchema } },
      },
    },
    responses: {
      200: { description: 'Is superuser' },
      403: { description: 'Forbidden' },
    },
    tags: ['MQTT Auth'],
  });

  app.openapi(mqttSuperuserRoute, (c) => {
    const { username } = c.req.valid('json');
    return c.json({}, username === mqttSuperuser.username ? 200 : 403);
  });

  const mqttAclRoute = createRoute({
    method: 'post',
    path: API_ROUTES.auth.mqttAcl,
    request: {
      body: {
        content: { 'application/json': { schema: MqttAuthAclRequestSchema } },
      },
    },
    responses: {
      200: { description: 'Allowed' },
      403: { description: 'Forbidden' },
    },
    tags: ['MQTT Auth'],
  });

  app.openapi(mqttAclRoute, async (c) => {
    const { username, topic, acc } = c.req.valid('json');
    const allowed = await checkAcl(username, topic, acc);
    return c.json({}, allowed ? 200 : 403);
  });

  async function checkAcl(username: string, topic: string, acc: number): Promise<boolean> {
    const gatewayId = parseGatewayControlTopic(topic);
    if (gatewayId) {
      return username === gatewayId &&
        (acc === MQTT_ACL.READ || acc === MQTT_ACL.SUBSCRIBE || acc === MQTT_ACL.READWRITE);
    }

    // agent events topic：仅所属 gateway 可订阅（username 即 gatewayId，且该
    // agent 归属此 gateway）；server 以 superuser 身份发布，不经此判定
    const agentId = parseAgentEventsTopic(topic);
    if (agentId) {
      if (!(acc === MQTT_ACL.READ || acc === MQTT_ACL.SUBSCRIBE || acc === MQTT_ACL.READWRITE)) {
        return false;
      }
      const agent = await participantRepo.findById(agentId);
      return agent?.kind === 'agent' && agent.gatewayId === username;
    }

    // presence topic：在线状态本质是公开信息，全员可读；只能写自己（或其名下 agent）的状态
    const presenceId = parsePresenceTopic(topic);
    if (presenceId) {
      if (acc === MQTT_ACL.READ || acc === MQTT_ACL.SUBSCRIBE || acc === MQTT_ACL.READWRITE) {
        return true;
      }
      if (acc !== MQTT_ACL.WRITE) return false;
      if (username === presenceId) return true;
      // gateway 代其名下 agent 上报 presence
      const target = await participantRepo.findById(presenceId);
      return target?.kind === 'agent' && target.gatewayId === username;
    }

    const parsed = parseRoomTopic(topic);
    if (!parsed) return false;

    const directionOk =
      parsed.direction === 'uplink'
        ? acc === MQTT_ACL.WRITE || acc === MQTT_ACL.READWRITE
        : acc === MQTT_ACL.READ || acc === MQTT_ACL.SUBSCRIBE || acc === MQTT_ACL.READWRITE;
    if (!directionOk) return false;

    const room = await roomRepo.findById(parsed.roomId);
    if (!room) return false;
    if (room.participantIds.includes(username)) return true;

    // gateway 单连接多路复用：gateway 代发 uplink（payload.from 为其名下 agent），
    // 放行条件是该 gateway 的任一 agent 属于该房间
    if (parsed.direction === 'uplink') {
      const ownedAgents = await participantRepo.listByGatewayId(username);
      return ownedAgents.some((agent) => room.participantIds.includes(agent.id));
    }
    return false;
  }

  // ---- OpenAPI docs ----

  app.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
  });

  app.doc('/openapi.json', {
    openapi: '3.0.0',
    info: {
      title: 'OPC Server API',
      version: packageJson.version,
      description: 'OPC IM Server HTTP API',
    },
  });

  // Serve the Scalar browser bundle from node_modules so docs work without external CDN.
  const scalarPackageEntry = fileURLToPath(import.meta.resolve('@scalar/api-reference'));
  const scalarBundlePath = join(dirname(scalarPackageEntry), 'browser', 'standalone.js');
  const scalarBundle = readFileSync(scalarBundlePath, 'utf-8');
  app.get('/scalar/api-reference.js', (c) =>
    c.body(scalarBundle, 200, { 'Content-Type': 'application/javascript' }),
  );

  app.get('/docs', Scalar({ spec: { url: '/openapi.json' }, cdn: '/scalar/api-reference.js' }));

  return createAdaptorServer({ fetch: app.fetch }) as HttpServer;
}
