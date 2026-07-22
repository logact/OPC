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
  isLoadingRooms: boolean;
  isLoadingMessages: boolean;
  error: string | null;

  loadRooms: () => Promise<void>;
  enterRoom: (roomId: string) => Promise<void>;
  leaveRoom: () => void;
  appendMessage: (message: Message) => void;
  handleServerEvent: (event: ServerEvent) => void;
}

export const useRoomStore = create<RoomState>((set, get) => ({
  rooms: [],
  currentRoomId: null,
  messages: [],
  lastMessages: {},
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
      const response = await roomsApi.history(roomId);
      set((state) => ({
        messages: response.messages,
        isLoadingMessages: false,
        // history is newest-first; seed the list preview with the latest
        lastMessages: response.messages[0]
          ? { ...state.lastMessages, [roomId]: response.messages[0] }
          : state.lastMessages,
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
      default:
        // participant.joined / participant.left / room.updated 尚未在 server 发布
        break;
    }
  },
}));
