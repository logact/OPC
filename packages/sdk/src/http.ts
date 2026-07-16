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
  type LoginRequest,
  type LoginResponse,
  type RegisterParticipantRequest,
  type RegisterParticipantResponse,
  type RoomHistoryResponse,
  type UpdateParticipantRequest,
  type UpdateParticipantResponse,
  type UpdateRoomRequest,
  type UpdateRoomResponse,
} from '@logact-pub/opc-protocol';

export class OpcHttpClient {
  private accessToken?: string;

  constructor(
    private readonly baseUrl: string,
    accessToken?: string
  ) {
    this.accessToken = accessToken;
  }

  setAccessToken(token: string): void {
    this.accessToken = token;
  }

  private headers(body?: unknown): Record<string, string> {
    const headers: Record<string, string> = {};
    if (body) {
      headers['Content-Type'] = 'application/json';
    }
    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }
    return headers;
  }

  async createRoom(req: CreateRoomRequest): Promise<CreateRoomResponse> {
    const res = await fetch(`${this.baseUrl}${API_ROUTES.rooms}`, {
      method: 'POST',
      headers: this.headers(req),
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(`createRoom failed: ${res.status}`);
    return res.json() as Promise<CreateRoomResponse>;
  }

  async listRooms(): Promise<ListRoomsResponse> {
    const res = await fetch(`${this.baseUrl}${API_ROUTES.rooms}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`listRooms failed: ${res.status}`);
    return res.json() as Promise<ListRoomsResponse>;
  }

  async listParticipants(): Promise<ListParticipantsResponse> {
    const res = await fetch(`${this.baseUrl}${API_ROUTES.participants}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`listParticipants failed: ${res.status}`);
    return res.json() as Promise<ListParticipantsResponse>;
  }

  async addRoomMembers(roomId: string, req: AddRoomMembersRequest): Promise<AddRoomMembersResponse> {
    const res = await fetch(`${this.baseUrl}${API_ROUTES.roomMembers(roomId)}`, {
      method: 'POST',
      headers: this.headers(req),
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(`addRoomMembers failed: ${res.status}`);
    return res.json() as Promise<AddRoomMembersResponse>;
  }

  async createDirectRoom(req: CreateDirectRoomRequest): Promise<CreateDirectRoomResponse> {
    const res = await fetch(`${this.baseUrl}${API_ROUTES.directRooms}`, {
      method: 'POST',
      headers: this.headers(req),
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
      headers: this.headers(req),
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(`broadcastMessage failed: ${res.status}`);
    return res.json() as Promise<BroadcastMessageResponse>;
  }

  async getHistory(roomId: string): Promise<RoomHistoryResponse> {
    const res = await fetch(`${this.baseUrl}${API_ROUTES.roomHistory(roomId)}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`getHistory failed: ${res.status}`);
    return res.json() as Promise<RoomHistoryResponse>;
  }

  async getRoom(roomId: string): Promise<GetRoomResponse> {
    const res = await fetch(`${this.baseUrl}${API_ROUTES.room(roomId)}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`getRoom failed: ${res.status}`);
    return res.json() as Promise<GetRoomResponse>;
  }

  async updateRoom(roomId: string, req: UpdateRoomRequest): Promise<UpdateRoomResponse> {
    const res = await fetch(`${this.baseUrl}${API_ROUTES.room(roomId)}`, {
      method: 'PATCH',
      headers: this.headers(req),
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(`updateRoom failed: ${res.status}`);
    return res.json() as Promise<UpdateRoomResponse>;
  }

  /** 注册参与者并获取 MQTT 登录 token（明文仅此一次返回） */
  async registerParticipant(
    id: string,
    name?: string,
    password?: string
  ): Promise<RegisterParticipantResponse> {
    const body: RegisterParticipantRequest = { id, name };
    if (password) {
      body.password = password;
    }
    const res = await fetch(`${this.baseUrl}${API_ROUTES.participants}`, {
      method: 'POST',
      headers: this.headers(body),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`registerParticipant failed: ${res.status}`);
    return res.json() as Promise<RegisterParticipantResponse>;
  }

  async login(participantId: string, password: string): Promise<LoginResponse> {
    const body: LoginRequest = { username: participantId, password };
    const res = await fetch(`${this.baseUrl}${API_ROUTES.auth.login}`, {
      method: 'POST',
      headers: this.headers(body),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`login failed: ${res.status}`);
    return res.json() as Promise<LoginResponse>;
  }

  async getParticipant(id: string): Promise<GetParticipantResponse> {
    const res = await fetch(`${this.baseUrl}${API_ROUTES.participant(id)}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`getParticipant failed: ${res.status}`);
    return res.json() as Promise<GetParticipantResponse>;
  }

  async updateParticipant(
    id: string,
    req: UpdateParticipantRequest
  ): Promise<UpdateParticipantResponse> {
    const res = await fetch(`${this.baseUrl}${API_ROUTES.participant(id)}`, {
      method: 'PATCH',
      headers: this.headers(req),
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(`updateParticipant failed: ${res.status}`);
    return res.json() as Promise<UpdateParticipantResponse>;
  }

  async getMessage(messageId: string): Promise<GetMessageResponse> {
    const res = await fetch(`${this.baseUrl}${API_ROUTES.message(messageId)}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`getMessage failed: ${res.status}`);
    return res.json() as Promise<GetMessageResponse>;
  }
}
