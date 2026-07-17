import type { OpcHttpClient } from './http.js';
import type {
  CreateRoomRequest,
  CreateRoomResponse,
  GetRoomResponse,
  ListRoomsResponse,
  RoomHistoryResponse,
  UpdateRoomRequest,
  UpdateRoomResponse,
} from './types.js';

const ROUTES = {
  rooms: '/rooms',
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

    list: () => client.get<ListRoomsResponse>(ROUTES.rooms),

    get: (id: string) => client.get<GetRoomResponse>(ROUTES.room(id)),

    update: (id: string, payload: UpdateRoomRequest) =>
      client.patch<UpdateRoomResponse>(ROUTES.room(id), payload),

    history: (id: string) => client.get<RoomHistoryResponse>(ROUTES.roomHistory(id)),
  };
}
