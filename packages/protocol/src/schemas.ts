import { z } from 'zod';

/**
 * 核心领域模型的 Zod Schemas。
 * 这些 schema 同时用于：
 * - HTTP API 请求/响应校验
 * - OpenAPI 文档生成
 * - 推导核心领域模型 TS 类型（见 wire.ts，OPC 生态的唯一类型来源）
 */

export const MessageContentSchema = z.object({
  type: z.enum(['text', 'markdown', 'json', 'system']),
  body: z.string(),
});

export const MessageSchema = z.object({
  id: z.string(),
  roomId: z.string(),
  from: z.string(),
  content: MessageContentSchema,
  timestamp: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const ParticipantKindSchema = z.enum(['human', 'agent', 'gateway']);

/** Agent 的 LLM 模型配置，注册时随 agent.spawn 命令转发给 gateway */
export const AgentModelConfigSchema = z.object({
  provider: z.string(),
  modelId: z.string(),
  apiKey: z.string().optional(),
});

/** gateway 模型目录中的单个模型（映射自 pi-ai 内建目录） */
export const ModelInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  reasoning: z.boolean().optional(),
  contextWindow: z.number().optional(),
  maxTokens: z.number().optional(),
});

/** 单个 provider 及其可选模型列表 */
export const ProviderModelsSchema = z.object({
  provider: z.string(),
  models: z.array(ModelInfoSchema),
});

/**
 * gateway 上报的运行时模型目录，持久化在 gateway participant 的
 * `metadata.modelCatalog`，供 mobile Add Agent 页面动态渲染 provider/model 选项。
 */
export const GatewayModelCatalogSchema = z.object({
  providers: z.array(ProviderModelsSchema),
  /** catalog 生成时间（ISO 8601） */
  updatedAt: z.string(),
});

export const ParticipantSchema = z.object({
  id: z.string(),
  kind: ParticipantKindSchema,
  name: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const RoomSchema = z.object({
  id: z.string(),
  name: z.string(),
  participantIds: z.array(z.string()),
  createdAt: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const MessageDeliveredEventSchema = z.object({
  type: z.literal('message.delivered'),
  message: MessageSchema,
});

export const ParticipantJoinedEventSchema = z.object({
  type: z.literal('participant.joined'),
  roomId: z.string(),
  participant: ParticipantSchema,
});

export const ParticipantLeftEventSchema = z.object({
  type: z.literal('participant.left'),
  roomId: z.string(),
  participantId: z.string(),
});

export const RoomUpdatedEventSchema = z.object({
  type: z.literal('room.updated'),
  room: RoomSchema,
});

export const ServerEventSchema = z.discriminatedUnion('type', [
  MessageDeliveredEventSchema,
  ParticipantJoinedEventSchema,
  ParticipantLeftEventSchema,
  RoomUpdatedEventSchema,
]);

/**
 * HTTP API 请求/响应 Schemas
 */

export const CreateRoomRequestSchema = z.object({
  name: z.string().min(1),
  participantIds: z.array(z.string()).optional(),
});

export const CreateRoomResponseSchema = z.object({
  roomId: z.string(),
});

export const ListRoomsResponseSchema = z.object({
  rooms: z.array(RoomSchema),
});

export const GetRoomResponseSchema = z.object({
  room: RoomSchema,
});

export const UpdateRoomRequestSchema = z.object({
  name: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const UpdateRoomResponseSchema = z.object({
  room: RoomSchema,
});

export const RoomHistoryResponseSchema = z.object({
  messages: z.array(MessageSchema),
});

export const RegisterParticipantRequestSchema = z.object({
  id: z.string().min(1),
  kind: ParticipantKindSchema.optional(),
  name: z.string().optional(),
  password: z.string().min(6).optional(),
  gatewayId: z.string().optional(),
  model: AgentModelConfigSchema.optional(),
});

export const RegisterParticipantResponseSchema = z.object({
  participantId: z.string(),
  /** 明文 token 仅此一次返回，server 只保存其哈希 */
  token: z.string(),
});

export const LoginRequestSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const LoginResponseSchema = z.object({
  accessToken: z.string(),
  participant: ParticipantSchema,
});

export const ListParticipantsResponseSchema = z.object({
  participants: z.array(ParticipantSchema),
});

/** GET /participants 的可选查询参数：按 kind 过滤 */
export const ListParticipantsQuerySchema = z.object({
  kind: ParticipantKindSchema.optional(),
});

export const GetParticipantResponseSchema = z.object({
  participant: ParticipantSchema,
});

export const AddRoomMembersRequestSchema = z.object({
  participantIds: z.array(z.string().min(1)).min(1),
});

export const AddRoomMembersResponseSchema = z.object({
  room: RoomSchema,
});

export const CreateDirectRoomRequestSchema = z.object({
  participantIds: z.array(z.string().min(1)).length(2),
});

export const CreateDirectRoomResponseSchema = z.object({
  roomId: z.string(),
});

export const BroadcastMessageRequestSchema = z.object({
  from: z.string().min(1).optional(),
  content: MessageContentSchema,
});

export const BroadcastMessageResponseSchema = z.object({
  message: MessageSchema,
});

export const UpdateParticipantRequestSchema = z.object({
  name: z.string().optional(),
  kind: ParticipantKindSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  /** gateway 上报模型目录；server 合并进 participant 的 metadata.modelCatalog */
  modelCatalog: GatewayModelCatalogSchema.optional(),
});

export const UpdateParticipantResponseSchema = z.object({
  participant: ParticipantSchema,
});

export const GetMessageResponseSchema = z.object({
  message: MessageSchema,
});

/**
 * mosquitto-go-auth HTTP 后端回调负载。
 * 见 https://github.com/iegomez/mosquitto-go-auth#http
 */
export const MqttAuthUserRequestSchema = z.object({
  username: z.string(),
  password: z.string(),
  clientid: z.string().optional().nullable(),
});

/**
 * mosquitto-go-auth superuser 回调只发送 username（没有 password/clientid）。
 * 保持独立 schema 以兼容 broker 实际负载。
 */
export const MqttAuthSuperuserRequestSchema = z.object({
  username: z.string(),
  clientid: z.string().optional().nullable(),
});

export const MqttAuthAclRequestSchema = z.object({
  username: z.string(),
  topic: z.string(),
  /** 1=read, 2=write, 3=readwrite, 4=subscribe */
  acc: z.number(),
  clientid: z.string().optional().nullable(),
});

/**
 * Gateway 控制面命令：server PUBLISH 到 opc/gateways/{gatewayId}/control，
 * gateway SUBSCRIBE 该 topic 后执行对应生命周期操作。
 */
export const GatewaySpawnCommandSchema = z.object({
  type: z.literal('agent.spawn'),
  participantId: z.string(),
  token: z.string(),
  name: z.string().optional(),
  model: AgentModelConfigSchema.optional(),
});

export const GatewayStopCommandSchema = z.object({
  type: z.literal('agent.stop'),
  participantId: z.string(),
});

export const GatewayCommandSchema = z.discriminatedUnion('type', [
  GatewaySpawnCommandSchema,
  GatewayStopCommandSchema,
]);
