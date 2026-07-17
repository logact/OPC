/**
 * OPC MQTT topic 约定。
 * 与 OPC-server packages/protocol/src/wire.ts 保持一致。
 */
export const MQTT_TOPICS = {
  /** server 订阅此通配 topic 接收所有房间的上行消息 */
  uplinkFilter: 'opc/rooms/+/uplink',

  /** 客户端 PUBLISH 到 server 的上行 topic */
  uplink: (roomId: string) => `opc/rooms/${roomId}/uplink`,

  /** server PUBLISH 事件到客户端的下行 topic */
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
