import {
  API_ROUTES,
  type AddRoomMembersRequest,
  type AddRoomMembersResponse,
  type BroadcastMessageRequest,
  type BroadcastMessageResponse,
  type CreateDirectRoomRequest,
  type CreateDirectRoomResponse,
  type CreateRoomRequest,
  type CreateRoomResponse,
  type GetMessageResponse,
  type GetParticipantResponse,
  type GetRoomResponse,
  type ListParticipantsResponse,
  type ListRoomsResponse,
  type RegisterParticipantRequest,
  type RegisterParticipantResponse,
  type RoomHistoryResponse,
  type UpdateParticipantRequest,
  type UpdateParticipantResponse,
  type UpdateRoomRequest,
  type UpdateRoomResponse,
} from '@logact-pub/opc-protocol';

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

  async listParticipants(): Promise<ListParticipantsResponse> {
    const res = await fetch(`${this.baseUrl}${API_ROUTES.participants}`);
    if (!res.ok) throw new Error(`listParticipants failed: ${res.status}`);
    return res.json() as Promise<ListParticipantsResponse>;
  }

  async addRoomMembers(roomId: string, req: AddRoomMembersRequest): Promise<AddRoomMembersResponse> {
    const res = await fetch(`${this.baseUrl}${API_ROUTES.roomMembers(roomId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(`addRoomMembers failed: ${res.status}`);
    return res.json() as Promise<AddRoomMembersResponse>;
  }

  async createDirectRoom(req: CreateDirectRoomRequest): Promise<CreateDirectRoomResponse> {
    const res = await fetch(`${this.baseUrl}${API_ROUTES.directRooms}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(`createDirectRoom failed: ${res.status}`);
    return res.json() as Promise<CreateDirectRoomResponse>;
  }

  async broadcastMessage(
    roomId: string,
    req: BroadcastMessageRequest
  ): Promise<BroadcastMessageResponse> {
    const res = await fetch(`${this.baseUrl}${API_ROUTES.roomBroadcast(roomId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(`broadcastMessage failed: ${res.status}`);
    return res.json() as Promise<BroadcastMessageResponse>;
  }

  async getHistory(roomId: string): Promise<RoomHistoryResponse> {
    const res = await fetch(`${this.baseUrl}${API_ROUTES.roomHistory(roomId)}`);
    if (!res.ok) throw new Error(`getHistory failed: ${res.status}`);
    return res.json() as Promise<RoomHistoryResponse>;
  }

  async getRoom(roomId: string): Promise<GetRoomResponse> {
    const res = await fetch(`${this.baseUrl}${API_ROUTES.room(roomId)}`);
    if (!res.ok) throw new Error(`getRoom failed: ${res.status}`);
    return res.json() as Promise<GetRoomResponse>;
  }

  async updateRoom(roomId: string, req: UpdateRoomRequest): Promise<UpdateRoomResponse> {
    const res = await fetch(`${this.baseUrl}${API_ROUTES.room(roomId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(`updateRoom failed: ${res.status}`);
    return res.json() as Promise<UpdateRoomResponse>;
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

  async getParticipant(id: string): Promise<GetParticipantResponse> {
    const res = await fetch(`${this.baseUrl}${API_ROUTES.participant(id)}`);
    if (!res.ok) throw new Error(`getParticipant failed: ${res.status}`);
    return res.json() as Promise<GetParticipantResponse>;
  }

  async updateParticipant(
    id: string,
    req: UpdateParticipantRequest
  ): Promise<UpdateParticipantResponse> {
    const res = await fetch(`${this.baseUrl}${API_ROUTES.participant(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(`updateParticipant failed: ${res.status}`);
    return res.json() as Promise<UpdateParticipantResponse>;
  }

  async getMessage(messageId: string): Promise<GetMessageResponse> {
    const res = await fetch(`${this.baseUrl}${API_ROUTES.message(messageId)}`);
    if (!res.ok) throw new Error(`getMessage failed: ${res.status}`);
    return res.json() as Promise<GetMessageResponse>;
  }
}
