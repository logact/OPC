import { create } from 'zustand';
import type { Message } from '@opc/api-client';
import type { ServerEvent } from '@opc/mqtt-client';
import { roomsApi } from '../api/http';

export interface Room {
  id: string;
  name: string;
}

export interface RoomState {
  rooms: Room[];
  currentRoomId: string | null;
  messages: Message[];
  /** Latest known message per room, drives the conversation-list preview. */
  lastMessages: Record<string, Message>;
  /** 已读游标（issue #108）：roomId → participantId → lastReadAt（null 表示从未读过）。 */
  readCursors: Record<string, Record<string, string | null>>;
  isLoadingRooms: boolean;
  isLoadingMessages: boolean;
  error: string | null;

  loadRooms: () => Promise<void>;
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

export const useRoomStore = create<RoomState>((set, get) => ({
  rooms: [],
  currentRoomId: null,
  messages: [],
  lastMessages: {},
  readCursors: {},
  isLoadingRooms: false,
  isLoadingMessages: false,
  error: null,

  loadRooms: async () => {
    set({ isLoadingRooms: true, error: null });
    try {
      const response = await roomsApi.list();
      set({ rooms: response.rooms, isLoadingRooms: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : '加载房间失败',
        isLoadingRooms: false,
      });
    }
  },

  enterRoom: async (roomId: string) => {
    set({ currentRoomId: roomId, messages: [], isLoadingMessages: true, error: null });
    try {
      const [response, readState] = await Promise.all([
        roomsApi.history(roomId),
        // 已读游标拉取失败不阻塞消息加载，仅失去已读指示
        roomsApi.readState(roomId).catch(() => null),
      ]);
      set((state) => ({
        // history is newest-first; store oldest-first so the chat list shows
        // the latest message at the bottom and live appends land there too
        messages: [...response.messages].reverse(),
        isLoadingMessages: false,
        // seed the conversation-list preview with the latest message
        lastMessages: response.messages[0]
          ? { ...state.lastMessages, [roomId]: response.messages[0] }
          : state.lastMessages,
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
      }));
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : '加载历史消息失败',
        isLoadingMessages: false,
      });
    }
  },

  leaveRoom: () => {
    set({ currentRoomId: null, messages: [] });
  },

  appendMessage: (message: Message) => {
    set((state) => {
      if (state.messages.some((m) => m.id === message.id)) {
        return state;
      }
      return {
        messages: [...state.messages, message],
        lastMessages: { ...state.lastMessages, [message.roomId]: message },
      };
    });
  },

  handleServerEvent: (event: ServerEvent) => {
    switch (event.type) {
      case 'message.delivered':
        get().appendMessage(event.message);
        break;
      case 'read.updated': {
        const { roomId, participantId, lastReadAt } = event;
        set((state) => {
          const roomCursors = state.readCursors[roomId] ?? {};
          const merged = mergeCursor(roomCursors[participantId], lastReadAt);
          if (merged === roomCursors[participantId]) return state;
          return {
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
