import { createAdaptorServer } from '@hono/node-server';
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { Scalar } from '@scalar/hono-api-reference';
import type { Server as HttpServer } from 'node:http';
import { API_ROUTES, MQTT_ACL, parseRoomTopic } from '@opc/protocol';
import {
  CreateRoomRequestSchema,
  CreateRoomResponseSchema,
  GetMessageResponseSchema,
  GetParticipantResponseSchema,
  GetRoomResponseSchema,
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
} from '@opc/protocol';
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
}

const ErrorResponseSchema = z.object({ error: z.string() }).openapi('ErrorResponse');

const idParamSchema = z.object({ id: z.string() }).openapi('IdParam');

export function createServer({ db, mqttSuperuser }: ServerOptions): HttpServer {
  const roomRepo = createRoomRepository(db);
  const participantRepo = createParticipantRepository(db);
  const messageRepo = createMessageRepository(db);

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
    const room = await roomRepo.create(payload.name, participantIds);
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

  // ---- Participants ----

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
      version: '1.1.0',
      description: 'OPC IM Server HTTP API',
    },
  });

  app.get('/docs', Scalar({ spec: { url: '/openapi.json' } }));

  return createAdaptorServer({ fetch: app.fetch }) as HttpServer;
}
