import { API_ROUTES, type CreateRoomRequest, type CreateRoomResponse, type ListRoomsResponse, type RegisterParticipantRequest, type RegisterParticipantResponse, type RoomHistoryResponse } from '@opc/protocol';

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

  /** 注册参与者并获取 MQTT 登录 token（明文仅此一次返回） */
  async registerParticipant(id: string, name?: string): Promise<RegisterParticipantResponse> {
    const res = await fetch(`${this.baseUrl}${API_ROUTES.participants}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name } satisfies RegisterParticipantRequest),
    });
    if (!res.ok) throw new Error(`registerParticipant failed: ${res.status}`);
    return res.json() as Promise<RegisterParticipantResponse>;
  }
}
