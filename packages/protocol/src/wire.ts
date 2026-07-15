import type { Message, MessageContent, Participant, Room, ServerEvent } from '@opc/core';

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

const UPLINK_PATTERN = /^opc\/rooms\/([^/]+)\/uplink$/;
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
 * 客户端 → server 的上行消息负载（PUBLISH 到 uplink topic 的 JSON body）。
 * 人与 agent 使用完全相同的负载格式。
 */
export interface UplinkPayload {
  from: string;
  content: MessageContent;
  clientMessageId?: string;
}

/**
 * server → 客户端的下行负载：直接复用 core 的 ServerEvent，
 * PUBLISH 到对应房间的 events topic。
 */
export type DownlinkPayload = ServerEvent;

/**
 * mosquitto-go-auth HTTP 后端回调负载。
 * 见 https://github.com/iegomez/mosquitto-go-auth#http
 */
export interface MqttAuthUserRequest {
  username: string;
  password: string;
  clientid?: string;
}

export interface MqttAuthAclRequest {
  username: string;
  topic: string;
  /** 1=read, 2=write, 3=readwrite, 4=subscribe */
  acc: number;
  clientid?: string;
}

export const MQTT_ACL = {
  READ: 1,
  WRITE: 2,
  READWRITE: 3,
  SUBSCRIBE: 4,
} as const;

/**
 * HTTP API 负载类型
 */
export interface CreateRoomRequest {
  name: string;
  participantIds?: string[];
}

export interface CreateRoomResponse {
  roomId: string;
}

export interface ListRoomsResponse {
  rooms: { id: string; name: string }[];
}

export interface GetRoomResponse {
  room: Room;
}

export interface UpdateRoomRequest {
  name?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateRoomResponse {
  room: Room;
}

export interface RoomHistoryResponse {
  messages: Message[];
}

export interface RegisterParticipantRequest {
  id: string;
  name?: string;
}

export interface RegisterParticipantResponse {
  participantId: string;
  /** 明文 token 仅此一次返回，server 只保存其哈希 */
  token: string;
}

export interface GetParticipantResponse {
  participant: Participant;
}

export interface UpdateParticipantRequest {
  name?: string;
  kind?: Participant['kind'];
  metadata?: Record<string, unknown>;
}

export interface UpdateParticipantResponse {
  participant: Participant;
}

export interface GetMessageResponse {
  message: Message;
}
