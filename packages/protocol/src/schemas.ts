import { z } from 'zod';

/**
 * 核心领域模型的 Zod Schemas。
 * 这些 schema 同时用于：
 * - HTTP API 请求/响应校验
 * - OpenAPI 文档生成
 * - 从 @opc/core 导出的 TS 类型保持一致
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

export const ParticipantKindSchema = z.enum(['human', 'agent']);

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
  rooms: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
    })
  ),
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
  name: z.string().optional(),
});

export const RegisterParticipantResponseSchema = z.object({
  participantId: z.string(),
  /** 明文 token 仅此一次返回，server 只保存其哈希 */
  token: z.string(),
});

export const GetParticipantResponseSchema = z.object({
  participant: ParticipantSchema,
});

export const UpdateParticipantRequestSchema = z.object({
  name: z.string().optional(),
  kind: ParticipantKindSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
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
