import type { Message, ServerEvent } from '@opc/core';

/**
 * 客户端 → 服务器的 WebSocket 帧。
 * 人与 agent 使用完全相同的帧类型。
 */
export type ClientFrame =
  | AuthenticateFrame
  | SubscribeRoomFrame
  | UnsubscribeRoomFrame
  | SendMessageFrame
  | PingFrame;

export interface AuthenticateFrame {
  type: 'auth';
  token: string;
}

export interface SubscribeRoomFrame {
  type: 'room.subscribe';
  roomId: string;
}

export interface UnsubscribeRoomFrame {
  type: 'room.unsubscribe';
  roomId: string;
}

export interface SendMessageFrame {
  type: 'message.send';
  roomId: string;
  content: { type: 'text'; body: string } | { type: 'json'; body: unknown };
  clientMessageId?: string;
}

export interface PingFrame {
  type: 'ping';
  ts: number;
}

/**
 * 服务器 → 客户端的 WebSocket 帧。
 */
export type ServerFrame =
  | AuthenticatedFrame
  | ErrorFrame
  | EventFrame
  | PongFrame;

export interface AuthenticatedFrame {
  type: 'authenticated';
  participantId: string;
}

export interface ErrorFrame {
  type: 'error';
  code: string;
  message: string;
}

export interface EventFrame {
  type: 'event';
  event: ServerEvent;
}

export interface PongFrame {
  type: 'pong';
  ts: number;
}

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

export interface RoomHistoryResponse {
  messages: Message[];
}
