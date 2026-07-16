import type { z } from 'zod';
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
  LoginRequestSchema,
  LoginResponseSchema,
  MessageContentSchema,
  MessageDeliveredEventSchema,
  MessageSchema,
  MqttAuthAclRequestSchema,
  MqttAuthSuperuserRequestSchema,
  MqttAuthUserRequestSchema,
  ParticipantJoinedEventSchema,
  ParticipantKindSchema,
  ParticipantLeftEventSchema,
  ParticipantSchema,
  RegisterParticipantRequestSchema,
  RegisterParticipantResponseSchema,
  RoomHistoryResponseSchema,
  RoomSchema,
  RoomUpdatedEventSchema,
  ServerEventSchema,
  UpdateParticipantRequestSchema,
  UpdateParticipantResponseSchema,
  UpdateRoomRequestSchema,
  UpdateRoomResponseSchema,
} from './schemas.js';

/**
 * MQTT topic 约定。
 * 客户端与 server 都是 broker 的 MQTT 客户端，通过以下 topic 通信：
 * - 上行：客户端 PUBLISH 到 opc/rooms/{roomId}/uplink
 * - 下行：server PUBLISH ServerEvent 到 opc/rooms/{roomId}/events
 */
export const MQTT_TOPICS = {
  /** server 订阅此通配 topic 接收所有房间的上行消息 */
  uplinkFilter: 'opc/rooms/+/uplink',
  uplink: (roomId: string) => `opc/rooms/${roomId}/uplink`,
  events: (roomId: string) => `opc/rooms/${roomId}/events`,
} as const;

const UPLINK_PATTERN = /^opc\/rooms\/([^/]+|\+)\/uplink$/;
const EVENTS_PATTERN = /^opc\/rooms\/([^/]+)\/events$/;

export type RoomTopicDirection = 'uplink' | 'events';

export interface RoomTopic {
  roomId: string;
  direction: RoomTopicDirection;
}

/** 从上行 topic 提取 roomId，不匹配返回 null */
export function parseUplinkTopic(topic: string): string | null {
  return UPLINK_PATTERN.exec(topic)?.[1] ?? null;
}

/** 解析房间相关 topic（上行或下行），用于 ACL 判定；不匹配返回 null */
export function parseRoomTopic(topic: string): RoomTopic | null {
  const uplink = UPLINK_PATTERN.exec(topic);
  if (uplink) return { roomId: uplink[1], direction: 'uplink' };
  const events = EVENTS_PATTERN.exec(topic);
  if (events) return { roomId: events[1], direction: 'events' };
  return null;
}

/**
 * 核心领域模型类型，从 Zod Schema 推导。
 * 这些类型是 OPC 生态（server + mobile + sdk）的唯一类型来源。
 */
export type Participant = z.infer<typeof ParticipantSchema>;
export type ParticipantKind = z.infer<typeof ParticipantKindSchema>;
export type Room = z.infer<typeof RoomSchema>;
export type Message = z.infer<typeof MessageSchema>;
export type MessageContent = z.infer<typeof MessageContentSchema>;

/**
 * 客户端 → server 的上行消息负载（PUBLISH 到 uplink topic 的 JSON body）。
 * 人与 agent 使用完全相同的负载格式。
 */
export interface UplinkPayload {
  from: string;
  content: { type: 'text' | 'markdown' | 'json' | 'system'; body: string };
  clientMessageId?: string;
}

/**
 * server → 客户端的下行负载：即下方从 ServerEventSchema 推导的 ServerEvent，
 * PUBLISH 到对应房间的 events topic。
 */
export type DownlinkPayload = ServerEvent;

/**
 * HTTP API 负载类型
 */
export type CreateRoomRequest = z.infer<typeof CreateRoomRequestSchema>;
export type CreateRoomResponse = z.infer<typeof CreateRoomResponseSchema>;
export type ListRoomsResponse = z.infer<typeof ListRoomsResponseSchema>;
export type GetRoomResponse = z.infer<typeof GetRoomResponseSchema>;
export type UpdateRoomRequest = z.infer<typeof UpdateRoomRequestSchema>;
export type UpdateRoomResponse = z.infer<typeof UpdateRoomResponseSchema>;
export type RoomHistoryResponse = z.infer<typeof RoomHistoryResponseSchema>;
export type AddRoomMembersRequest = z.infer<typeof AddRoomMembersRequestSchema>;
export type AddRoomMembersResponse = z.infer<typeof AddRoomMembersResponseSchema>;
export type CreateDirectRoomRequest = z.infer<typeof CreateDirectRoomRequestSchema>;
export type CreateDirectRoomResponse = z.infer<typeof CreateDirectRoomResponseSchema>;
export type BroadcastMessageRequest = z.infer<typeof BroadcastMessageRequestSchema>;
export type BroadcastMessageResponse = z.infer<typeof BroadcastMessageResponseSchema>;
export type RegisterParticipantRequest = z.infer<typeof RegisterParticipantRequestSchema>;
export type RegisterParticipantResponse = z.infer<typeof RegisterParticipantResponseSchema>;
export type ListParticipantsResponse = z.infer<typeof ListParticipantsResponseSchema>;
export type GetParticipantResponse = z.infer<typeof GetParticipantResponseSchema>;
export type UpdateParticipantRequest = z.infer<typeof UpdateParticipantRequestSchema>;
export type UpdateParticipantResponse = z.infer<typeof UpdateParticipantResponseSchema>;
export type GetMessageResponse = z.infer<typeof GetMessageResponseSchema>;
export type LoginRequest = z.infer<typeof LoginRequestSchema>;
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

/**
 * mosquitto-go-auth HTTP 后端回调负载。
 * 见 https://github.com/iegomez/mosquitto-go-auth#http
 */
export type MqttAuthUserRequest = z.infer<typeof MqttAuthUserRequestSchema>;
export type MqttAuthSuperuserRequest = z.infer<typeof MqttAuthSuperuserRequestSchema>;
export type MqttAuthAclRequest = z.infer<typeof MqttAuthAclRequestSchema>;

export const MQTT_ACL = {
  READ: 1,
  WRITE: 2,
  READWRITE: 3,
  SUBSCRIBE: 4,
} as const;

// 事件联合类型，从 schema 推导以同时支持运行时校验
export type MessageDeliveredEvent = z.infer<typeof MessageDeliveredEventSchema>;
export type ParticipantJoinedEvent = z.infer<typeof ParticipantJoinedEventSchema>;
export type ParticipantLeftEvent = z.infer<typeof ParticipantLeftEventSchema>;
export type RoomUpdatedEvent = z.infer<typeof RoomUpdatedEventSchema>;
export type ServerEvent = z.infer<typeof ServerEventSchema>;
