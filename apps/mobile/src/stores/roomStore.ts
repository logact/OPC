import { create } from 'zustand';
import type { Message, RoomWithState } from '@opc/api-client';
import type { ServerEvent } from '@opc/mqtt-client';
import { roomsApi } from '../api/http';

// Conversation state is owned by the protocol. Keeping this alias avoids a
// second mobile-only room model drifting from the HTTP contract.
export type Room = RoomWithState;

export interface RoomState {
  /** Membership-scoped rooms, including server-derived unread state. */
  rooms: Room[];
  /** The signed-in participant whose unread state these rooms represent. */
  participantId: string | null;
  currentRoomId: string | null;
  messages: Message[];
  /** 已读游标（issue #108）：roomId → participantId → lastReadAt（null 表示从未读过）。 */
  readCursors: Record<string, Record<string, string | null>>;
  isLoadingRooms: boolean;
  isLoadingMessages: boolean;
  error: string | null;

  loadRooms: (participantId?: string) => Promise<void>;
  enterRoom: (roomId: string) => Promise<void>;
  leaveRoom: () => void;
  appendMessage: (message: Message) => void;
  handleServerEvent: (event: ServerEvent) => void;
}

/** 游标单调递增：重复或更旧的回执不回退已读水位。 */
function mergeCursor(
  existing: string | null | undefined,
  incoming: string | null,
): string | null {
  if (existing == null) return incoming;
  if (incoming == null) return existing;
  return incoming > existing ? incoming : existing;
}

function isNewerMessage(candidate: Message, current: Message | null): boolean {
  if (!current) return true;
  if (candidate.timestamp !== current.timestamp) return candidate.timestamp > current.timestamp;
  return candidate.id > current.id;
}

function insertMessage(messages: Message[], message: Message): Message[] {
  if (messages.some((item) => item.id === message.id)) return messages;
  return [...messages, message].sort((a, b) => {
    if (a.timestamp !== b.timestamp) return a.timestamp.localeCompare(b.timestamp);
    return a.id.localeCompare(b.id);
  });
}

/** Keep a live MQTT update that raced a room-list refetch. */
function mergeRoomList(incoming: Room[], current: Room[]): Room[] {
  const currentById = new Map(current.map((room) => [room.id, room]));
  return incoming.map((room) => {
    const existing = currentById.get(room.id);
    if (!existing?.lastMessage || !isNewerMessage(existing.lastMessage, room.lastMessage)) {
      return room;
    }
    return {
      ...room,
      lastMessage: existing.lastMessage,
      unreadCount: Math.max(room.unreadCount, existing.unreadCount),
    };
  });
}

export const useRoomStore = create<RoomState>((set, get) => ({
  rooms: [],
  participantId: null,
  currentRoomId: null,
  messages: [],
  readCursors: {},
  isLoadingRooms: false,
  isLoadingMessages: false,
  error: null,

  loadRooms: async (requestedParticipantId) => {
    const participantId = requestedParticipantId ?? get().participantId;
    if (!participantId) return;
    set({ isLoadingRooms: true, error: null, participantId });
    try {
      const response = await roomsApi.listForParticipant(participantId);
      // A late response for a user that has since logged out or switched
      // accounts must not overwrite the next user's conversations.
      if (get().participantId !== participantId) return;
      set((state) => ({
        rooms: mergeRoomList(response.rooms, state.rooms),
        isLoadingRooms: false,
      }));
    } catch (err) {
      if (get().participantId !== participantId) return;
      set({
        error: err instanceof Error ? err.message : '加载房间失败',
        isLoadingRooms: false,
      });
    }
  },

  enterRoom: async (roomId) => {
    // Opening a conversation is an immediate local read acknowledgement. The
    // ChatScreen publishes the durable broker receipt after history loads.
    set((state) => ({
      currentRoomId: roomId,
      messages: [],
      isLoadingMessages: true,
      error: null,
      rooms: state.rooms.map((room) =>
        room.id === roomId ? { ...room, unreadCount: 0 } : room,
      ),
    }));
    try {
      const [response, readState] = await Promise.all([
        roomsApi.history(roomId),
        // 已读游标拉取失败不阻塞消息加载，仅失去已读指示
        roomsApi.readState(roomId).catch(() => null),
      ]);
      if (get().currentRoomId !== roomId) return;
      set((state) => {
        const latest = response.messages[0] ?? null;
        return {
          // history is newest-first; store oldest-first so the chat list shows
          // the latest message at the bottom and live appends land there too.
          // Preserve an MQTT delivery that arrived after the history request
          // began but before its response resolved.
          messages: state.messages.reduce(
            (merged, message) => insertMessage(merged, message),
            [...response.messages].reverse(),
          ),
          isLoadingMessages: false,
          rooms: state.rooms.map((room) =>
            room.id === roomId
              ? {
                  ...room,
                  unreadCount: 0,
                  lastMessage: latest && isNewerMessage(latest, room.lastMessage)
                    ? latest
                    : room.lastMessage,
                }
              : room,
          ),
          readCursors: readState
            ? {
                ...state.readCursors,
                [roomId]: readState.reads.reduce<Record<string, string | null>>(
                  (acc, { participantId, lastReadAt }) => {
                    acc[participantId] = mergeCursor(
                      state.readCursors[roomId]?.[participantId],
                      lastReadAt,
                    );
                    return acc;
                  },
                  { ...state.readCursors[roomId] },
                ),
              }
            : state.readCursors,
        };
      });
    } catch (err) {
      if (get().currentRoomId !== roomId) return;
      set({
        error: err instanceof Error ? err.message : '加载历史消息失败',
        isLoadingMessages: false,
      });
    }
  },

  leaveRoom: () => {
    set({ currentRoomId: null, messages: [] });
  },

  appendMessage: (message) => {
    set((state) => ({ messages: insertMessage(state.messages, message) }));
  },

  handleServerEvent: (event) => {
    switch (event.type) {
      case 'message.delivered': {
        const message = event.message;
        let isCurrentRoom = false;
        set((state) => {
          const room = state.rooms.find((item) => item.id === message.roomId);
          if (!room) return state;
          isCurrentRoom = state.currentRoomId === message.roomId;
          const isNewer = isNewerMessage(message, room.lastMessage);
          const shouldIncrementUnread =
            isNewer && !isCurrentRoom && message.from !== state.participantId;
          return {
            rooms: state.rooms.map((item) =>
              item.id === message.roomId
                ? {
                    ...item,
                    lastMessage: isNewer ? message : item.lastMessage,
                    unreadCount: isCurrentRoom
                      ? 0
                      : item.unreadCount + (shouldIncrementUnread ? 1 : 0),
                  }
                : item,
            ),
          };
        });
        if (isCurrentRoom) get().appendMessage(message);
        break;
      }
      case 'read.updated': {
        const { roomId, participantId, lastReadAt } = event;
        set((state) => {
          const roomCursors = state.readCursors[roomId] ?? {};
          const merged = mergeCursor(roomCursors[participantId], lastReadAt);
          const rooms =
            participantId === state.participantId
              ? state.rooms.map((room) =>
                  room.id === roomId &&
                  room.lastMessage?.timestamp !== undefined &&
                  room.lastMessage.timestamp <= lastReadAt
                    ? { ...room, unreadCount: 0 }
                    : room,
                )
              : state.rooms;
          if (merged === roomCursors[participantId] && rooms === state.rooms) return state;
          return {
            rooms,
            readCursors: {
              ...state.readCursors,
              [roomId]: { ...roomCursors, [participantId]: merged },
            },
          };
        });
        break;
      }
      default:
        // participant.joined / participant.left / room.updated 尚未在 server 发布
        break;
    }
  },
}));
