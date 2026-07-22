import {
  API_ROUTES,
  BroadcastMessageResponseSchema,
  CreateDirectRoomResponseSchema,
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
} as const;

export function createRoomsApi(client: OpcHttpClient) {
  return {
    create: (name: string, participantIds?: string[]) =>
      client.post<CreateRoomResponse>(ROUTES.rooms, {
        name,
        participantIds,
      } satisfies CreateRoomRequest),

    // Find-or-create a 1v1 room; the server dedupes and stamps
    // metadata { type: 'direct' } (unlike create(), which stamps 'group').
    createDirect: async (participantIds: [string, string]): Promise<CreateDirectRoomResponse> => {
      const data = await client.post<unknown>(ROUTES.directRooms, {
        participantIds,
      } satisfies CreateDirectRoomRequest);
      return CreateDirectRoomResponseSchema.parse(data);
    },

    list: () => client.get<ListRoomsResponse>(ROUTES.rooms),

    get: (id: string) => client.get<GetRoomResponse>(ROUTES.room(id)),

    update: (id: string, payload: UpdateRoomRequest) =>
      client.patch<UpdateRoomResponse>(ROUTES.room(id), payload),

    history: (id: string) => client.get<RoomHistoryResponse>(ROUTES.roomHistory(id)),

    broadcast: async (id: string, payload: BroadcastMessageRequest): Promise<BroadcastMessageResponse> => {
      const data = await client.post<unknown>(API_ROUTES.roomBroadcast(id).replace(API_PREFIX, ''), payload);
      return BroadcastMessageResponseSchema.parse(data);
    },
  };
}
