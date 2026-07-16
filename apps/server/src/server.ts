import { createAdaptorServer } from '@hono/node-server';
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { Scalar } from '@scalar/hono-api-reference';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Server as HttpServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTextMessage } from '@logact-pub/opc-core';
import { API_ROUTES, MQTT_ACL, parseRoomTopic } from '@logact-pub/opc-protocol';
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
  ListParticipantsResponseSchema,
  ListRoomsResponseSchema,
  MqttAuthAclRequestSchema,
  MqttAuthSuperuserRequestSchema,
  MqttAuthUserRequestSchema,
  RegisterParticipantRequestSchema,
  RegisterParticipantResponseSchema,
  RoomHistoryResponseSchema,
  UpdateParticipantRequestSchema,
  UpdateParticipantResponseSchema,
  UpdateRoomRequestSchema,
  UpdateRoomResponseSchema,
} from '@logact-pub/opc-protocol';
import type { ServerEvent } from '@logact-pub/opc-protocol';
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
  /** mqtt-bridge 的连接身份；broker 回调 superuser/user 检查时据此判定 */
  mqttSuperuser: MqttSuperuser;
  /** 用于 HTTP 广播/成员加入事件向 MQTT events topic 发布 */
  eventPublisher?: { publish(roomId: string, event: ServerEvent): void };
}

const ErrorResponseSchema = z.object({ error: z.string() }).openapi('ErrorResponse');

const idParamSchema = z.object({ id: z.string() }).openapi('IdParam');

export function createServer({ db, mqttSuperuser, eventPublisher }: ServerOptions): HttpServer {
  const roomRepo = createRoomRepository(db);
  const participantRepo = createParticipantRepository(db);
  const messageRepo = createMessageRepository(db);

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

  app.notFound((c) => c.json({ error: 'not found' }, 404));

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
    request: { params: idParamSchema },
    responses: {
      200: {
        content: { 'application/json': { schema: RoomHistoryResponseSchema } },
        description: 'Room message history',
      },
      404: { content: { 'application/json': { schema: ErrorResponseSchema } }, description: 'Room not found' },
    },
    tags: ['Rooms'],
  });

  app.openapi(roomHistoryRoute, async (c) => {
    const { id } = c.req.valid('param');
    const messages = await messageRepo.findByRoomId(id);
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

    const from = payload.from ?? 'system';
    await participantRepo.ensure(from);
    const message = createTextMessage(randomUUID(), id, from, payload.content.body, {
      broadcast: true,
      ...(payload.content.type !== 'text' ? { originalType: payload.content.type } : {}),
    });
    await messageRepo.insert(id, message);

    const event: ServerEvent = { type: 'message.delivered', message };
    eventPublisher.publish(id, event);

    return c.json({ message }, 201);
  });

  // ---- Participants ----

  const listParticipantsRoute = createRoute({
    method: 'get',
    path: API_ROUTES.participants,
    responses: {
      200: {
        content: { 'application/json': { schema: ListParticipantsResponseSchema } },
        description: 'List of participants',
      },
    },
    tags: ['Participants'],
  });

  app.openapi(listParticipantsRoute, async (c) => {
    const participantList = await participantRepo.list();
    return c.json({ participants: participantList }, 200);
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
    const { participant, token } = await participantRepo.register(payload.id, payload.name);
    return c.json({ participantId: participant.id, token }, 201);
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
      404: { content: { 'application/json': { schema: ErrorResponseSchema } }, description: 'Participant not found' },
    },
    tags: ['Participants'],
  });

  app.openapi(updateParticipantRoute, async (c) => {
    const { id } = c.req.valid('param');
    const payload = c.req.valid('json');
    const participant = await participantRepo.update(id, payload);
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
    const parsed = parseRoomTopic(topic);
    if (!parsed) return false;

    const directionOk =
      parsed.direction === 'uplink'
        ? acc === MQTT_ACL.WRITE || acc === MQTT_ACL.READWRITE
        : acc === MQTT_ACL.READ || acc === MQTT_ACL.SUBSCRIBE || acc === MQTT_ACL.READWRITE;
    if (!directionOk) return false;

    const room = await roomRepo.findById(parsed.roomId);
    return room?.participantIds.includes(username) ?? false;
  }

  // ---- OpenAPI docs ----

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
