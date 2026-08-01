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
  AuthorizationErrorResponseSchema,
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
  ListAuthorizationAuditQuerySchema,
  ListAuthorizationAuditResponseSchema,
  ListRoomsResponseSchema,
  LoginRequestSchema,
  LoginResponseSchema,
  MqttAuthAclRequestSchema,
  MqttAuthSuperuserRequestSchema,
  MqttAuthUserRequestSchema,
  OrganizationErrorResponseSchema,
  RemoveRoomMemberResponseSchema,
  RegisterParticipantRequestSchema,
  RegisterParticipantResponseSchema,
  RoomHistoryQuerySchema,
  RoomHistoryResponseSchema,
  UpdateParticipantRequestSchema,
  UpdateParticipantResponseSchema,
  UpdateRoomRequestSchema,
  UpdateRoomResponseSchema,
} from '@logact-pub/opc-protocol';
import type {
  AuthorizationResource,
  GatewayCommand,
  ServerEvent,
} from '@logact-pub/opc-protocol';
import {
  createAuthorizationAuditRepository,
  createDbClient,
  createMessageRepository,
  createOrganizationRepository,
  createParticipantRepository,
  createRoomRepository,
} from '@opc/database';
import {
  registerOrganizationRoutes,
  respondParticipantOrganizationError,
} from './organization-routes.js';
import {
  AuthorizationDeniedError,
  createAuthorizationService,
  messageResource,
  participantResource,
  roomResource,
  type ServerEnv,
} from './authorization.js';

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
  /** Temporary rollout switch; enforced by default and removable in issue #114. */
  authorizationMode?: 'enforce' | 'compat';
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
  authorizationMode = 'enforce',
  eventPublisher,
}: ServerOptions): HttpServer {
  const roomRepo = createRoomRepository(db);
  const participantRepo = createParticipantRepository(db);
  const messageRepo = createMessageRepository(db);
  const organizationRepo = createOrganizationRepository(db);
  const auditRepo = createAuthorizationAuditRepository(db);
  const authorization = createAuthorizationService({
    organizationRepo,
    participantRepo,
    auditRepo,
    mode: authorizationMode,
  });
  const secretBytes = new TextEncoder().encode(jwtSecret);

  const packageJson = JSON.parse(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../package.json'), 'utf-8'),
  ) as { version: string };

  const app = new OpenAPIHono<ServerEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        if (c.req.path.startsWith('/api/v1/organization')) {
          return c.json(
            {
              error: {
                code: 'validation_error' as const,
                message: result.error.issues[0]?.message ?? 'validation failed',
              },
            },
            400
          );
        }
        return c.json({ error: result.error.issues[0]?.message ?? 'validation failed' }, 400);
      }
    },
  });

  // 全量请求日志：覆盖所有 HTTP 入口（含 OpenAPI 路由、/docs、404）
  app.use(logger());

  app.notFound((c) => c.json({ error: 'not found' }, 404));

  app.onError((error, c) => {
    if (error instanceof AuthorizationDeniedError) {
      return c.json(
        { error: { code: error.code, message: error.message } },
        error.status
      );
    }
    throw error;
  });

  // ---- Auth middleware ----

  app.use('/api/v1/*', async (c, next) => {
    // Broker callbacks and login are public; participant bootstrap is handled below.
    if (c.req.path.startsWith('/api/v1/auth/')) return next();
    if (
      authorizationMode === 'compat' &&
      c.req.path === API_ROUTES.participants &&
      (c.req.method === 'GET' || c.req.method === 'POST')
    ) {
      return next();
    }

    const auth = c.req.header('authorization');
    if (!auth?.startsWith('Bearer ')) {
      if (c.req.method === 'POST' && c.req.path === API_ROUTES.participants) {
        return next();
      }
      return c.json(
        { error: { code: 'unauthorized' as const, message: 'authentication required' } },
        401
      );
    }
    const token = auth.slice(7);
    // 接受两种 Bearer 凭证：/auth/login 签发的 JWT，以及 register 发放的
    // participant token（与 MQTT CONNECT 同一凭据，mobile 只持有后者）。
    let actorId: string | undefined;
    try {
      const verified = await jwtVerify(token, secretBytes);
      if (typeof verified.payload.sub === 'string') {
        if (authorizationMode === 'compat') {
          actorId = verified.payload.sub;
        } else {
          const participant = await participantRepo.findById(verified.payload.sub);
          actorId = participant?.id;
        }
      }
    } catch {
      const participant = await participantRepo.findByToken(token);
      actorId = participant?.id;
    }
    if (!actorId) {
      return c.json(
        { error: { code: 'unauthorized' as const, message: 'invalid bearer token' } },
        401
      );
    }
    c.set('actorId', actorId);
    await next();
  });

  registerOrganizationRoutes(app, organizationRepo, authorization);

  const actorId = (c: { get(key: 'actorId'): string | undefined }): string => {
    const id = c.get('actorId');
    if (!id) throw new Error('authenticated route missing actor context');
    return id;
  };

  const participantAuthorizationResource = async (
    participantId: string
  ): Promise<AuthorizationResource | undefined> => {
    const participant = await participantRepo.findById(participantId);
    if (!participant) return undefined;
    return participantResource(
      participant,
      await authorization.participantDepartmentIds(participantId)
    );
  };

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
    const creatorId = actorId(c);
    const participantIds = authorizationMode === 'compat'
      ? payload.participantIds ?? []
      : [...new Set([creatorId, ...(payload.participantIds ?? [])])];
    await authorization.require(creatorId, 'room.create', {
      type: 'room',
      id: 'new',
      creatorId,
      roomType: 'group',
      departmentId: payload.departmentId ?? null,
      participantIds,
    });
    for (const participantId of participantIds) {
      const participant = await participantRepo.ensure(participantId);
      await organizationRepo.reconcileParticipant(participant.id, participant.kind);
    }
    const room = await roomRepo.create({
      name: payload.name,
      participantIds,
      creatorId,
      type: 'group',
      departmentId: payload.departmentId,
      metadata: { type: 'group' },
    });
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
    const visible = [];
    for (const room of roomList) {
      const decision = await authorization.authorize(actorId(c), 'room.read', roomResource(room));
      if (decision.allowed) visible.push(room);
    }
    return c.json({ rooms: visible }, 200);
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
    await authorization.require(actorId(c), 'room.read', roomResource(room));
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
    const current = await roomRepo.findById(id);
    if (!current) return c.json({ error: 'not found' }, 404);
    await authorization.require(actorId(c), 'room.manage', roomResource(current));
    if (payload.departmentId && payload.departmentId !== current.departmentId) {
      const targetResource: AuthorizationResource = {
        type: 'room',
        id: current.id,
        creatorId: current.creatorId,
        roomType: current.type,
        departmentId: payload.departmentId,
        participantIds: current.participantIds,
      };
      await authorization.require(actorId(c), 'room.manage', targetResource);
    }
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
    const room = await roomRepo.findById(id);
    if (!room) return c.json({ error: 'not found' }, 404);
    await authorization.require(actorId(c), 'message.read', roomResource(room));
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
    await authorization.require(actorId(c), 'room.members.manage', roomResource(room));

    const targets = await Promise.all(
      payload.participantIds.map((participantId) => participantRepo.findById(participantId))
    );
    for (const [index, participantId] of payload.participantIds.entries()) {
      const participant = targets[index];
      const resource = participant
        ? participantResource(
            participant,
            await authorization.participantDepartmentIds(participantId)
          )
        : {
            type: 'participant' as const,
            id: participantId,
            participantId,
            departmentIds: [],
          };
      await authorization.require(actorId(c), 'participant.manage', resource);
    }
    for (const participantId of payload.participantIds) {
      const participant = await participantRepo.ensure(participantId);
      await organizationRepo.reconcileParticipant(participant.id, participant.kind);
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

  const removeRoomMemberRoute = createRoute({
    method: 'delete',
    path: API_ROUTES.roomMember('{id}', '{participantId}'),
    request: {
      params: z.object({ id: z.string(), participantId: z.string() }),
    },
    responses: {
      200: {
        content: { 'application/json': { schema: RemoveRoomMemberResponseSchema } },
        description: 'Member removed',
      },
      404: {
        content: { 'application/json': { schema: ErrorResponseSchema } },
        description: 'Room not found',
      },
    },
    security: [{ bearerAuth: [] }],
    tags: ['Rooms'],
  });

  app.openapi(removeRoomMemberRoute, async (c) => {
    const { id, participantId } = c.req.valid('param');
    const room = await roomRepo.findById(id);
    if (!room) return c.json({ error: 'not found' }, 404);
    await authorization.require(actorId(c), 'room.members.manage', roomResource(room));
    const target = await participantAuthorizationResource(participantId);
    if (target) await authorization.require(actorId(c), 'participant.manage', target);
    const updated = await roomRepo.removeMember(id, participantId);
    if (!updated) return c.json({ error: 'not found' }, 404);
    eventPublisher?.publish(id, { type: 'participant.left', roomId: id, participantId });
    return c.json({ room: updated }, 200);
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
    const creatorId = actorId(c);
    await authorization.require(creatorId, 'room.create', {
      type: 'room',
      id: 'new-direct',
      creatorId,
      roomType: 'direct',
      departmentId: null,
      participantIds: payload.participantIds,
    });

    for (const participantId of payload.participantIds) {
      const participant = await participantRepo.ensure(participantId);
      await organizationRepo.reconcileParticipant(participant.id, participant.kind);
    }

    const existing = await roomRepo.findDirectRoom(a, b);
    if (existing) {
      return c.json({ roomId: existing.id }, 201);
    }

    const room = await roomRepo.create({
      name: `${a}-${b}`,
      participantIds: [a, b],
      creatorId,
      type: 'direct',
      departmentId: null,
      metadata: { type: 'direct' },
    });
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

    const authenticatedActorId = actorId(c);
    const from = authorizationMode === 'compat'
      ? payload.from ?? 'system'
      : authenticatedActorId;
    if (payload.from !== undefined && payload.from !== from) {
      const decision = await authorization.deny(
        authenticatedActorId,
        'message.send',
        roomResource(room),
        'legacy from must match the authenticated actor',
        'http',
        { claimedActorId: payload.from }
      );
      throw new AuthorizationDeniedError(decision);
    }
    await authorization.require(authenticatedActorId, 'message.send', roomResource(room));
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
    if (authorizationMode === 'compat' && !c.get('actorId')) {
      return c.json(
        {
          participants: participantList.filter(
            (participant) =>
              participant.id !== 'system' &&
              (kind === undefined || participant.kind === kind) &&
              (gatewayId === undefined || participant.gatewayId === gatewayId)
          ),
        },
        200
      );
    }
    const visible = [];
    for (const participant of participantList) {
      if (participant.id === 'system') continue;
      const decision = await authorization.authorize(
        actorId(c),
        'participant.read',
        participantResource(
          participant,
          await authorization.participantDepartmentIds(participant.id)
        )
      );
      if (decision.allowed) visible.push(participant);
    }
    return c.json(
      {
        participants: visible.filter(
          (p) =>
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
    const requesterId = actorId(c);
    const requester = await participantRepo.findById(requesterId);
    const gatewayOwnsAgent =
      requester?.kind === 'gateway' && participant.gatewayId === requesterId;
    if (requesterId !== id && !gatewayOwnsAgent) {
      const resource = await participantAuthorizationResource(id);
      if (resource) await authorization.require(requesterId, 'participant.read', resource);
    }
    const roomList = await roomRepo.listByParticipantId(id);
    const visible = [];
    for (const room of roomList) {
      if (gatewayOwnsAgent) {
        visible.push(room);
        continue;
      }
      const decision = await authorization.authorize(requesterId, 'room.read', roomResource(room));
      if (decision.allowed) visible.push(room);
    }
    return c.json({ rooms: visible }, 200);
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
      401: { content: { 'application/json': { schema: AuthorizationErrorResponseSchema } }, description: 'Unauthenticated' },
      409: { content: { 'application/json': { schema: OrganizationErrorResponseSchema } }, description: 'Organization conflict' },
      422: { content: { 'application/json': { schema: OrganizationErrorResponseSchema } }, description: 'Invalid staff transition' },
    },
    tags: ['Participants'],
  });

  app.openapi(registerParticipantRoute, async (c) => {
    try {
      const payload = c.req.valid('json');
      if (typeof payload?.id !== 'string' || payload.id.length === 0) {
        return c.json({ error: 'id is required' }, 400);
      }
      const kind = payload.kind ?? 'human';
      const requesterId = c.get('actorId');
      const hasOwner = await organizationRepo.hasOwner();
      if (!requesterId) {
        if (authorizationMode !== 'compat' && (hasOwner || kind !== 'human')) {
          return c.json(
            { error: { code: 'unauthorized' as const, message: 'authentication required' } },
            401
          );
        }
      } else {
        const requester = await participantRepo.findById(requesterId);
        const gatewayOwnsNewAgent =
          requester?.kind === 'gateway' && kind === 'agent' && payload.gatewayId === requesterId;
        if (!gatewayOwnsNewAgent) {
          const resource: AuthorizationResource = kind === 'agent'
            ? {
                type: 'agent',
                id: payload.id,
                participantId: payload.id,
                departmentIds: [],
                ...(payload.gatewayId ? { gatewayId: payload.gatewayId } : {}),
              }
            : {
                type: 'participant',
                id: payload.id,
                participantId: payload.id,
                departmentIds: [],
              };
          await authorization.require(
            requesterId,
            kind === 'agent' ? 'agent.manage' : 'participant.manage',
            resource
          );
        }
      }
      await organizationRepo.assertParticipantKindChange(payload.id, kind);
      const { participant, token } = await participantRepo.register(
        payload.id,
        payload.name,
        kind,
        payload.password,
        payload.gatewayId
      );
      await organizationRepo.reconcileParticipant(
        participant.id,
        participant.kind,
        participant.kind === 'human'
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
    } catch (error) {
      return respondParticipantOrganizationError(c, error);
    }
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
    const resource = await participantAuthorizationResource(id);
    if (resource) await authorization.require(actorId(c), 'participant.read', resource);
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
      409: { content: { 'application/json': { schema: OrganizationErrorResponseSchema } }, description: 'Owner or staff conflict' },
      422: { content: { 'application/json': { schema: OrganizationErrorResponseSchema } }, description: 'Invalid staff transition' },
    },
    security: [{ bearerAuth: [] }],
    tags: ['Participants'],
  });

  app.openapi(updateParticipantRoute, async (c) => {
    try {
      const { id } = c.req.valid('param');
      const { modelCatalog, ...rest } = c.req.valid('json');
      const existingParticipant = await participantRepo.findById(id);
      if (!existingParticipant) return c.json({ error: 'not found' }, 404);
      const requesterId = actorId(c);
      const requester = await participantRepo.findById(requesterId);
      const gatewayOwnsAgent =
        requester?.kind === 'gateway' &&
        existingParticipant.kind === 'agent' &&
        existingParticipant.gatewayId === requesterId;
      if (!gatewayOwnsAgent) {
        const resource = await participantAuthorizationResource(id);
        if (resource) {
          await authorization.require(
            requesterId,
            existingParticipant.kind === 'agent' ? 'agent.manage' : 'participant.manage',
            resource
          );
        }
      }
      if (rest.kind) await organizationRepo.assertParticipantKindChange(id, rest.kind);
      // modelCatalog 持久化到 participant 的 metadata.modelCatalog，
      // 与已有 metadata 及同请求中的 metadata 合并，不覆盖其他 key。
      let patch = rest;
      if (modelCatalog !== undefined) {
        patch = {
          ...rest,
          metadata: { ...existingParticipant.metadata, ...rest.metadata, modelCatalog },
        };
      }
      const participant = await participantRepo.update(id, patch);
      if (!participant) return c.json({ error: 'not found' }, 404);
      await organizationRepo.reconcileParticipant(participant.id, participant.kind);
      return c.json({ participant }, 200);
    } catch (error) {
      return respondParticipantOrganizationError(c, error);
    }
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
    const room = await roomRepo.findById(message.roomId);
    if (!room) return c.json({ error: 'not found' }, 404);
    await authorization.require(actorId(c), 'message.read', messageResource(room, id));
    return c.json({ message }, 200);
  });

  const authorizationAuditRoute = createRoute({
    method: 'get',
    path: API_ROUTES.authorizationAudit,
    request: { query: ListAuthorizationAuditQuerySchema },
    responses: {
      200: {
        content: { 'application/json': { schema: ListAuthorizationAuditResponseSchema } },
        description: 'Authorization audit entries',
      },
      401: {
        content: { 'application/json': { schema: AuthorizationErrorResponseSchema } },
        description: 'Unauthenticated',
      },
      403: {
        content: { 'application/json': { schema: AuthorizationErrorResponseSchema } },
        description: 'Forbidden',
      },
    },
    security: [{ bearerAuth: [] }],
    tags: ['Authorization'],
  });

  app.openapi(authorizationAuditRoute, async (c) => {
    await authorization.require(actorId(c), 'authorization.audit.read', {
      type: 'authorization_audit',
      id: 'authorization-audit',
    });
    return c.json(await auditRepo.list(c.req.valid('query')), 200);
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
    if (parsed.direction === 'events') {
      if (authorizationMode === 'compat') {
        return room.participantIds.includes(username);
      }
      const decision = await authorization.authorize(
        username,
        'message.read',
        roomResource(room),
        'mqtt',
        { metadata: { topic, acc } }
      );
      return decision.allowed;
    }

    const connectionIdentity = await participantRepo.findById(username);
    let claimedActorId = parsed.participantId;
    if (!claimedActorId) {
      // Temporary compatibility for old single-participant clients. Gateway
      // multiplexing is never accepted on the ambiguous legacy topic.
      if (connectionIdentity?.kind === 'gateway') {
        if (authorizationMode !== 'compat') return false;
        const ownedAgents = await participantRepo.listByGatewayId(username);
        return ownedAgents.some((agent) => room.participantIds.includes(agent.id));
      }
      claimedActorId = username;
    }
    if (connectionIdentity?.kind === 'gateway') {
      const claimed = await participantRepo.findById(claimedActorId);
      if (claimed?.kind !== 'agent' || claimed.gatewayId !== username) return false;
    } else if (claimedActorId !== username) {
      return false;
    }
    if (authorizationMode === 'compat') {
      return room.participantIds.includes(claimedActorId);
    }
    const decision = await authorization.authorize(
      claimedActorId,
      'message.send',
      roomResource(room),
      'mqtt',
      { claimedActorId, metadata: { connectionIdentity: username, topic, acc } }
    );
    return decision.allowed;
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
