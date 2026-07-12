import { API_ROUTES, type CreateRoomRequest, type CreateRoomResponse, type ListRoomsResponse, type RoomHistoryResponse } from '@opc/protocol';

export class OpcHttpClient {
  constructor(private readonly baseUrl: string) {}

  async createRoom(req: CreateRoomRequest): Promise<CreateRoomResponse> {
    const res = await fetch(`${this.baseUrl}${API_ROUTES.rooms}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(`createRoom failed: ${res.status}`);
    return res.json() as Promise<CreateRoomResponse>;
  }

  async listRooms(): Promise<ListRoomsResponse> {
    const res = await fetch(`${this.baseUrl}${API_ROUTES.rooms}`);
    if (!res.ok) throw new Error(`listRooms failed: ${res.status}`);
    return res.json() as Promise<ListRoomsResponse>;
  }

  async getHistory(roomId: string): Promise<RoomHistoryResponse> {
    const res = await fetch(`${this.baseUrl}${API_ROUTES.roomHistory(roomId)}`);
    if (!res.ok) throw new Error(`getHistory failed: ${res.status}`);
    return res.json() as Promise<RoomHistoryResponse>;
  }
}
