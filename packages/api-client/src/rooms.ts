import {
  API_ROUTES,
  BroadcastMessageResponseSchema,
  CreateDirectRoomResponseSchema,
  CreateRoomResponseSchema,
  GetRoomResponseSchema,
  ListRoomsResponseSchema,
  RemoveRoomMemberResponseSchema,
  RoomHistoryResponseSchema,
  UpdateRoomResponseSchema,
} from '@logact-pub/opc-protocol';
import type { OpcHttpClient } from './http.js';
import type {
  BroadcastMessageRequest,
  BroadcastMessageResponse,
  CreateDirectRoomRequest,
  CreateDirectRoomResponse,
  CreateRoomRequest,
  CreateRoomResponse,
  GetRoomResponse,
  ListRoomsResponse,
  RemoveRoomMemberResponse,
  RoomHistoryResponse,
  UpdateRoomRequest,
  UpdateRoomResponse,
} from './types.js';

// API_ROUTES paths carry the /api/v1 prefix, which the http client's baseURL
// (buildBaseURL) already prepends — strip it to keep request URLs unchanged.
const API_PREFIX = '/api/v1';

const ROUTES = {
  rooms: '/rooms',
  directRooms: API_ROUTES.directRooms.replace(API_PREFIX, ''),
  room: (id: string) => `/rooms/${encodeURIComponent(id)}`,
  roomHistory: (id: string) => `/rooms/${encodeURIComponent(id)}/history`,
  roomMember: (roomId: string, participantId: string) =>
    API_ROUTES.roomMember(encodeURIComponent(roomId), encodeURIComponent(participantId)).replace(
      API_PREFIX,
      ''
    ),
} as const;

export function createRoomsApi(client: OpcHttpClient) {
  return {
    create: async (
      name: string,
      participantIds?: string[],
      departmentId?: string
    ): Promise<CreateRoomResponse> => {
      const data = await client.post<unknown>(ROUTES.rooms, {
        name,
        participantIds,
        departmentId,
      } satisfies CreateRoomRequest);
      return CreateRoomResponseSchema.parse(data);
    },

    // Find-or-create a 1v1 room; the server dedupes and stamps
    // metadata { type: 'direct' } (unlike create(), which stamps 'group').
    createDirect: async (participantIds: [string, string]): Promise<CreateDirectRoomResponse> => {
      const data = await client.post<unknown>(ROUTES.directRooms, {
        participantIds,
      } satisfies CreateDirectRoomRequest);
      return CreateDirectRoomResponseSchema.parse(data);
    },

    list: async (): Promise<ListRoomsResponse> =>
      ListRoomsResponseSchema.parse(await client.get<unknown>(ROUTES.rooms)),

    get: async (id: string): Promise<GetRoomResponse> =>
      GetRoomResponseSchema.parse(await client.get<unknown>(ROUTES.room(id))),

    update: async (id: string, payload: UpdateRoomRequest): Promise<UpdateRoomResponse> =>
      UpdateRoomResponseSchema.parse(await client.patch<unknown>(ROUTES.room(id), payload)),

    history: async (id: string): Promise<RoomHistoryResponse> =>
      RoomHistoryResponseSchema.parse(await client.get<unknown>(ROUTES.roomHistory(id))),

    removeMember: async (
      roomId: string,
      participantId: string
    ): Promise<RemoveRoomMemberResponse> =>
      RemoveRoomMemberResponseSchema.parse(
        await client.delete<unknown>(ROUTES.roomMember(roomId, participantId))
      ),

    broadcast: async (id: string, payload: BroadcastMessageRequest): Promise<BroadcastMessageResponse> => {
      const data = await client.post<unknown>(API_ROUTES.roomBroadcast(id).replace(API_PREFIX, ''), payload);
      return BroadcastMessageResponseSchema.parse(data);
    },
  };
}
