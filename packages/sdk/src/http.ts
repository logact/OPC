import {
  API_ROUTES,
  AppendTaskEventResponseSchema,
  AuthorizationErrorResponseSchema,
  CreateTaskResponseSchema,
  DecomposeTaskResponseSchema,
  GetTaskResponseSchema,
  ListParticipantRoomsResponseSchema,
  ListTasksResponseSchema,
  OrganizationErrorResponseSchema,
  OPC_HTTP_HEADERS,
  TaskErrorResponseSchema,
  TaskMutationResponseSchema,
  UpdateTaskResponseSchema,
  type AddRoomMembersRequest,
  type AddRoomMembersResponse,
  type AppendTaskEventRequest,
  type AppendTaskEventResponse,
  type AssignTaskRequest,
  type BlockTaskRequest,
  type BroadcastMessageRequest,
  type BroadcastMessageResponse,
  type CancelTaskRequest,
  type CreateDirectRoomRequest,
  type CreateDirectRoomResponse,
  type CreateRoomRequest,
  type CreateRoomResponse,
  type CreateDepartmentRequest,
  type CreateDepartmentResponse,
  type CreatePositionRequest,
  type CreatePositionResponse,
  type CreateStaffAssignmentRequest,
  type CreateStaffAssignmentResponse,
  type CreateTaskRequest,
  type CreateTaskResponse,
  type DecomposeTaskRequest,
  type DecomposeTaskResponse,
  type DeleteDepartmentResponse,
  type DeletePositionResponse,
  type DeleteStaffAssignmentResponse,
  type GetDepartmentResponse,
  type GetOrganizationResponse,
  type GetOrganizationTreeResponse,
  type GetPositionResponse,
  type GetStaffResponse,
  type GetTaskResponse,
  type GetMessageResponse,
  type GetParticipantResponse,
  type GetRoomResponse,
  type AgentModelConfig,
  type ListParticipantsResponse,
  type ListParticipantRoomsResponse,
  type ListAuthorizationAuditQuery,
  type ListAuthorizationAuditResponse,
  type ListDepartmentsResponse,
  type ListPositionsQuery,
  type ListPositionsResponse,
  type ListRoomsResponse,
  type ListStaffResponse,
  type ListTasksQuery,
  type ListTasksResponse,
  type LoginRequest,
  type LoginResponse,
  type ParticipantKind,
  type RegisterParticipantRequest,
  type RegisterParticipantResponse,
  type RemoveRoomMemberResponse,
  type ResumeTaskRequest,
  type RoomHistoryResponse,
  type RoomReadStateResponse,
  type SubmitTaskRequest,
  type FailTaskRequest,
  type TaskCommandRequest,
  type TaskMutationResponse,
  type UpdateParticipantRequest,
  type UpdateParticipantResponse,
  type UpdateDepartmentRequest,
  type UpdateDepartmentResponse,
  type UpdateOrganizationRequest,
  type UpdateOrganizationResponse,
  type UpdatePositionRequest,
  type UpdatePositionResponse,
  type UpdateRoomRequest,
  type UpdateRoomResponse,
  type UpdateStaffAssignmentRequest,
  type UpdateStaffAssignmentResponse,
  type UpdateTaskRequest,
  type UpdateTaskResponse,
} from '@logact-pub/opc-protocol';

export class OpcHttpError extends Error {
  constructor(
    operation: string,
    readonly status: number,
    readonly code?: string,
    readonly details?: Record<string, unknown>
  ) {
    super(`${operation} failed: ${status}${code ? ` ${code}` : ''}`);
    this.name = 'OpcHttpError';
  }
}

async function throwHttpError(response: Response, operation: string): Promise<never> {
  const payload = typeof response.json === 'function'
    ? await response.json().catch(() => undefined)
    : undefined;
  const authorization = AuthorizationErrorResponseSchema.safeParse(payload);
  if (authorization.success) {
    throw new OpcHttpError(
      operation,
      response.status,
      authorization.data.error.code
    );
  }
  const task = TaskErrorResponseSchema.safeParse(payload);
  if (task.success) {
    throw new OpcHttpError(
      operation,
      response.status,
      task.data.error.code,
      task.data.error.details
    );
  }
  const parsed = OrganizationErrorResponseSchema.safeParse(payload);
  if (parsed.success) {
    throw new OpcHttpError(
      operation,
      response.status,
      parsed.data.error.code,
      parsed.data.error.details
    );
  }
  throw new OpcHttpError(operation, response.status);
}

export class OpcHttpClient {
  private accessToken?: string;

  constructor(
    private readonly baseUrl: string,
    accessToken?: string,
    private readonly options: { actorId?: string } = {}
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
    if (this.options.actorId) {
      headers[OPC_HTTP_HEADERS.delegatedActor] = this.options.actorId;
    }
    return headers;
  }

  private async taskRequest<T>(
    path: string,
    operation: string,
    schema: { parse(value: unknown): T },
    method: 'GET' | 'POST' | 'PATCH' = 'GET',
    body?: unknown
  ): Promise<T> {
    const init: RequestInit = { headers: this.headers(body) };
    if (method !== 'GET') init.method = method;
    if (body !== undefined) init.body = JSON.stringify(body);
    const response = await fetch(`${this.baseUrl}${path}`, init);
    if (!response.ok) await throwHttpError(response, operation);
    return schema.parse(await response.json());
  }

  async createRoom(req: CreateRoomRequest): Promise<CreateRoomResponse> {
    const res = await fetch(`${this.baseUrl}${API_ROUTES.rooms}`, {
      method: 'POST',
      headers: this.headers(req),
      body: JSON.stringify(req),
    });
    if (!res.ok) await throwHttpError(res, 'createRoom');
    return res.json() as Promise<CreateRoomResponse>;
  }

  async listRooms(): Promise<ListRoomsResponse> {
    const res = await fetch(`${this.baseUrl}${API_ROUTES.rooms}`, {
      headers: this.headers(),
    });
    if (!res.ok) await throwHttpError(res, 'listRooms');
    return res.json() as Promise<ListRoomsResponse>;
  }

  /**
   * Lists only a participant's rooms with server-derived unread counts and
   * conversation previews (issue #96).
   */
  async getParticipantRooms(participantId: string): Promise<ListParticipantRoomsResponse> {
    const res = await fetch(`${this.baseUrl}${API_ROUTES.participantRooms(participantId)}`, {
      headers: this.headers(),
    });
    if (!res.ok) await throwHttpError(res, 'getParticipantRooms');
    return ListParticipantRoomsResponseSchema.parse(await res.json());
  }

  async listParticipants(
    kind?: ParticipantKind,
    gatewayId?: string
  ): Promise<ListParticipantsResponse> {
    const params = new URLSearchParams();
    if (kind) params.set('kind', kind);
    if (gatewayId) params.set('gatewayId', gatewayId);
    const query = params.toString();
    const url = `${this.baseUrl}${API_ROUTES.participants}${query ? `?${query}` : ''}`;
    const res = await fetch(url, {
      headers: this.headers(),
    });
    if (!res.ok) await throwHttpError(res, 'listParticipants');
    return res.json() as Promise<ListParticipantsResponse>;
  }

  async addRoomMembers(roomId: string, req: AddRoomMembersRequest): Promise<AddRoomMembersResponse> {
    const res = await fetch(`${this.baseUrl}${API_ROUTES.roomMembers(roomId)}`, {
      method: 'POST',
      headers: this.headers(req),
      body: JSON.stringify(req),
    });
    if (!res.ok) await throwHttpError(res, 'addRoomMembers');
    return res.json() as Promise<AddRoomMembersResponse>;
  }

  async removeRoomMember(
    roomId: string,
    participantId: string
  ): Promise<RemoveRoomMemberResponse> {
    const res = await fetch(
      `${this.baseUrl}${API_ROUTES.roomMember(roomId, participantId)}`,
      { method: 'DELETE', headers: this.headers() }
    );
    if (!res.ok) await throwHttpError(res, 'removeRoomMember');
    return res.json() as Promise<RemoveRoomMemberResponse>;
  }

  async createDirectRoom(req: CreateDirectRoomRequest): Promise<CreateDirectRoomResponse> {
    const res = await fetch(`${this.baseUrl}${API_ROUTES.directRooms}`, {
      method: 'POST',
      headers: this.headers(req),
      body: JSON.stringify(req),
    });
    if (!res.ok) await throwHttpError(res, 'createDirectRoom');
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
    if (!res.ok) await throwHttpError(res, 'broadcastMessage');
    return res.json() as Promise<BroadcastMessageResponse>;
  }

  async getHistory(roomId: string): Promise<RoomHistoryResponse> {
    const res = await fetch(`${this.baseUrl}${API_ROUTES.roomHistory(roomId)}`, {
      headers: this.headers(),
    });
    if (!res.ok) await throwHttpError(res, 'getHistory');
    return res.json() as Promise<RoomHistoryResponse>;
  }

  /** 房间全部成员的已读游标（issue #108），从未读过的成员 lastReadAt 为 null */
  async getRoomReadState(roomId: string): Promise<RoomReadStateResponse> {
    const res = await fetch(`${this.baseUrl}${API_ROUTES.roomReadState(roomId)}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`getRoomReadState failed: ${res.status}`);
    return res.json() as Promise<RoomReadStateResponse>;
  }

  async getRoom(roomId: string): Promise<GetRoomResponse> {
    const res = await fetch(`${this.baseUrl}${API_ROUTES.room(roomId)}`, {
      headers: this.headers(),
    });
    if (!res.ok) await throwHttpError(res, 'getRoom');
    return res.json() as Promise<GetRoomResponse>;
  }

  async updateRoom(roomId: string, req: UpdateRoomRequest): Promise<UpdateRoomResponse> {
    const res = await fetch(`${this.baseUrl}${API_ROUTES.room(roomId)}`, {
      method: 'PATCH',
      headers: this.headers(req),
      body: JSON.stringify(req),
    });
    if (!res.ok) await throwHttpError(res, 'updateRoom');
    return res.json() as Promise<UpdateRoomResponse>;
  }

  /** 注册参与者并获取 MQTT 登录 token（明文仅此一次返回） */
  async registerParticipant(
    id: string,
    name?: string,
    password?: string,
    kind?: RegisterParticipantRequest['kind'],
    gatewayId?: string,
    model?: AgentModelConfig
  ): Promise<RegisterParticipantResponse> {
    const body: RegisterParticipantRequest = { id, name, kind, gatewayId, model };
    if (password) {
      body.password = password;
    }
    const res = await fetch(`${this.baseUrl}${API_ROUTES.participants}`, {
      method: 'POST',
      headers: this.headers(body),
      body: JSON.stringify(body),
    });
    if (!res.ok) await throwHttpError(res, 'registerParticipant');
    return res.json() as Promise<RegisterParticipantResponse>;
  }

  async login(participantId: string, password: string): Promise<LoginResponse> {
    const body: LoginRequest = { username: participantId, password };
    const res = await fetch(`${this.baseUrl}${API_ROUTES.auth.login}`, {
      method: 'POST',
      headers: this.headers(body),
      body: JSON.stringify(body),
    });
    if (!res.ok) await throwHttpError(res, 'login');
    return res.json() as Promise<LoginResponse>;
  }

  async getParticipant(id: string): Promise<GetParticipantResponse> {
    const res = await fetch(`${this.baseUrl}${API_ROUTES.participant(id)}`, {
      headers: this.headers(),
    });
    if (!res.ok) await throwHttpError(res, 'getParticipant');
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
    if (!res.ok) await throwHttpError(res, 'updateParticipant');
    return res.json() as Promise<UpdateParticipantResponse>;
  }

  async getOrganization(): Promise<GetOrganizationResponse> {
    const res = await fetch(`${this.baseUrl}${API_ROUTES.organization}`, {
      headers: this.headers(),
    });
    if (!res.ok) await throwHttpError(res, 'getOrganization');
    return res.json() as Promise<GetOrganizationResponse>;
  }

  async updateOrganization(req: UpdateOrganizationRequest): Promise<UpdateOrganizationResponse> {
    const res = await fetch(`${this.baseUrl}${API_ROUTES.organization}`, {
      method: 'PATCH',
      headers: this.headers(req),
      body: JSON.stringify(req),
    });
    if (!res.ok) await throwHttpError(res, 'updateOrganization');
    return res.json() as Promise<UpdateOrganizationResponse>;
  }

  async getOrganizationTree(): Promise<GetOrganizationTreeResponse> {
    const res = await fetch(`${this.baseUrl}${API_ROUTES.organizationTree}`, {
      headers: this.headers(),
    });
    if (!res.ok) await throwHttpError(res, 'getOrganizationTree');
    return res.json() as Promise<GetOrganizationTreeResponse>;
  }

  async listDepartments(): Promise<ListDepartmentsResponse> {
    const res = await fetch(`${this.baseUrl}${API_ROUTES.organizationDepartments}`, {
      headers: this.headers(),
    });
    if (!res.ok) await throwHttpError(res, 'listDepartments');
    return res.json() as Promise<ListDepartmentsResponse>;
  }

  async createDepartment(req: CreateDepartmentRequest): Promise<CreateDepartmentResponse> {
    const res = await fetch(`${this.baseUrl}${API_ROUTES.organizationDepartments}`, {
      method: 'POST',
      headers: this.headers(req),
      body: JSON.stringify(req),
    });
    if (!res.ok) await throwHttpError(res, 'createDepartment');
    return res.json() as Promise<CreateDepartmentResponse>;
  }

  async getDepartment(id: string): Promise<GetDepartmentResponse> {
    const res = await fetch(`${this.baseUrl}${API_ROUTES.organizationDepartment(encodeURIComponent(id))}`, {
      headers: this.headers(),
    });
    if (!res.ok) await throwHttpError(res, 'getDepartment');
    return res.json() as Promise<GetDepartmentResponse>;
  }

  async updateDepartment(
    id: string,
    req: UpdateDepartmentRequest
  ): Promise<UpdateDepartmentResponse> {
    const res = await fetch(`${this.baseUrl}${API_ROUTES.organizationDepartment(encodeURIComponent(id))}`, {
      method: 'PATCH',
      headers: this.headers(req),
      body: JSON.stringify(req),
    });
    if (!res.ok) await throwHttpError(res, 'updateDepartment');
    return res.json() as Promise<UpdateDepartmentResponse>;
  }

  async deleteDepartment(id: string): Promise<DeleteDepartmentResponse> {
    const res = await fetch(`${this.baseUrl}${API_ROUTES.organizationDepartment(encodeURIComponent(id))}`, {
      method: 'DELETE',
      headers: this.headers(),
    });
    if (!res.ok) await throwHttpError(res, 'deleteDepartment');
    return res.json() as Promise<DeleteDepartmentResponse>;
  }

  async listPositions(query: ListPositionsQuery = {}): Promise<ListPositionsResponse> {
    const params = new URLSearchParams();
    if (query.departmentId) params.set('departmentId', query.departmentId);
    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    const res = await fetch(`${this.baseUrl}${API_ROUTES.organizationPositions}${suffix}`, {
      headers: this.headers(),
    });
    if (!res.ok) await throwHttpError(res, 'listPositions');
    return res.json() as Promise<ListPositionsResponse>;
  }

  async createPosition(req: CreatePositionRequest): Promise<CreatePositionResponse> {
    const res = await fetch(`${this.baseUrl}${API_ROUTES.organizationPositions}`, {
      method: 'POST',
      headers: this.headers(req),
      body: JSON.stringify(req),
    });
    if (!res.ok) await throwHttpError(res, 'createPosition');
    return res.json() as Promise<CreatePositionResponse>;
  }

  async getPosition(id: string): Promise<GetPositionResponse> {
    const res = await fetch(`${this.baseUrl}${API_ROUTES.organizationPosition(encodeURIComponent(id))}`, {
      headers: this.headers(),
    });
    if (!res.ok) await throwHttpError(res, 'getPosition');
    return res.json() as Promise<GetPositionResponse>;
  }

  async updatePosition(id: string, req: UpdatePositionRequest): Promise<UpdatePositionResponse> {
    const res = await fetch(`${this.baseUrl}${API_ROUTES.organizationPosition(encodeURIComponent(id))}`, {
      method: 'PATCH',
      headers: this.headers(req),
      body: JSON.stringify(req),
    });
    if (!res.ok) await throwHttpError(res, 'updatePosition');
    return res.json() as Promise<UpdatePositionResponse>;
  }

  async deletePosition(id: string): Promise<DeletePositionResponse> {
    const res = await fetch(`${this.baseUrl}${API_ROUTES.organizationPosition(encodeURIComponent(id))}`, {
      method: 'DELETE',
      headers: this.headers(),
    });
    if (!res.ok) await throwHttpError(res, 'deletePosition');
    return res.json() as Promise<DeletePositionResponse>;
  }

  async listStaff(): Promise<ListStaffResponse> {
    const res = await fetch(`${this.baseUrl}${API_ROUTES.organizationStaff}`, {
      headers: this.headers(),
    });
    if (!res.ok) await throwHttpError(res, 'listStaff');
    return res.json() as Promise<ListStaffResponse>;
  }

  async getStaff(participantId: string): Promise<GetStaffResponse> {
    const res = await fetch(`${this.baseUrl}${API_ROUTES.organizationStaffMember(encodeURIComponent(participantId))}`, {
      headers: this.headers(),
    });
    if (!res.ok) await throwHttpError(res, 'getStaff');
    return res.json() as Promise<GetStaffResponse>;
  }

  async createStaffAssignment(
    participantId: string,
    req: CreateStaffAssignmentRequest
  ): Promise<CreateStaffAssignmentResponse> {
    const res = await fetch(`${this.baseUrl}${API_ROUTES.organizationStaffAssignments(encodeURIComponent(participantId))}`, {
      method: 'POST',
      headers: this.headers(req),
      body: JSON.stringify(req),
    });
    if (!res.ok) await throwHttpError(res, 'createStaffAssignment');
    return res.json() as Promise<CreateStaffAssignmentResponse>;
  }

  async updateStaffAssignment(
    id: string,
    req: UpdateStaffAssignmentRequest
  ): Promise<UpdateStaffAssignmentResponse> {
    const res = await fetch(`${this.baseUrl}${API_ROUTES.organizationAssignment(encodeURIComponent(id))}`, {
      method: 'PATCH',
      headers: this.headers(req),
      body: JSON.stringify(req),
    });
    if (!res.ok) await throwHttpError(res, 'updateStaffAssignment');
    return res.json() as Promise<UpdateStaffAssignmentResponse>;
  }

  async deleteStaffAssignment(id: string): Promise<DeleteStaffAssignmentResponse> {
    const res = await fetch(`${this.baseUrl}${API_ROUTES.organizationAssignment(encodeURIComponent(id))}`, {
      method: 'DELETE',
      headers: this.headers(),
    });
    if (!res.ok) await throwHttpError(res, 'deleteStaffAssignment');
    return res.json() as Promise<DeleteStaffAssignmentResponse>;
  }

  async getMessage(messageId: string): Promise<GetMessageResponse> {
    const res = await fetch(`${this.baseUrl}${API_ROUTES.message(messageId)}`, {
      headers: this.headers(),
    });
    if (!res.ok) await throwHttpError(res, 'getMessage');
    return res.json() as Promise<GetMessageResponse>;
  }

  async listAuthorizationAudit(
    query: Partial<ListAuthorizationAuditQuery> = {}
  ): Promise<ListAuthorizationAuditResponse> {
    const params = new URLSearchParams();
    if (query.actorId) params.set('actorId', query.actorId);
    if (query.outcome) params.set('outcome', query.outcome);
    if (query.cursor) params.set('cursor', query.cursor);
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    const res = await fetch(`${this.baseUrl}${API_ROUTES.authorizationAudit}${suffix}`, {
      headers: this.headers(),
    });
    if (!res.ok) await throwHttpError(res, 'listAuthorizationAudit');
    return res.json() as Promise<ListAuthorizationAuditResponse>;
  }

  async createTask(req: CreateTaskRequest): Promise<CreateTaskResponse> {
    return this.taskRequest(
      API_ROUTES.tasks,
      'createTask',
      CreateTaskResponseSchema,
      'POST',
      req
    );
  }

  async decomposeTask(
    taskId: string,
    req: DecomposeTaskRequest
  ): Promise<DecomposeTaskResponse> {
    return this.taskRequest(
      API_ROUTES.taskDecompose(encodeURIComponent(taskId)),
      'decomposeTask',
      DecomposeTaskResponseSchema,
      'POST',
      req
    );
  }

  async listTasks(query: Partial<ListTasksQuery> = {}): Promise<ListTasksResponse> {
    const params = new URLSearchParams();
    if (query.status) params.set('status', query.status);
    if (query.creatorId) params.set('creatorId', query.creatorId);
    if (query.assigneeId) params.set('assigneeId', query.assigneeId);
    if (query.cursor) params.set('cursor', query.cursor);
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    return this.taskRequest(
      `${API_ROUTES.tasks}${suffix}`,
      'listTasks',
      ListTasksResponseSchema
    );
  }

  async getTask(taskId: string): Promise<GetTaskResponse> {
    return this.taskRequest(
      API_ROUTES.task(encodeURIComponent(taskId)),
      'getTask',
      GetTaskResponseSchema
    );
  }

  async updateTask(taskId: string, req: UpdateTaskRequest): Promise<UpdateTaskResponse> {
    return this.taskRequest(
      API_ROUTES.task(encodeURIComponent(taskId)),
      'updateTask',
      UpdateTaskResponseSchema,
      'PATCH',
      req
    );
  }

  async assignTask(taskId: string, req: AssignTaskRequest): Promise<TaskMutationResponse> {
    return this.taskCommand(
      API_ROUTES.taskAssignments(encodeURIComponent(taskId)),
      'assignTask',
      req
    );
  }

  async startTask(taskId: string, req: TaskCommandRequest): Promise<TaskMutationResponse> {
    return this.taskCommand(API_ROUTES.taskStart(encodeURIComponent(taskId)), 'startTask', req);
  }

  async blockTask(taskId: string, req: BlockTaskRequest): Promise<TaskMutationResponse> {
    return this.taskCommand(API_ROUTES.taskBlock(encodeURIComponent(taskId)), 'blockTask', req);
  }

  async resumeTask(taskId: string, req: ResumeTaskRequest): Promise<TaskMutationResponse> {
    return this.taskCommand(API_ROUTES.taskResume(encodeURIComponent(taskId)), 'resumeTask', req);
  }

  async submitTask(taskId: string, req: SubmitTaskRequest): Promise<TaskMutationResponse> {
    return this.taskCommand(API_ROUTES.taskSubmit(encodeURIComponent(taskId)), 'submitTask', req);
  }

  async failTask(taskId: string, req: FailTaskRequest): Promise<TaskMutationResponse> {
    return this.taskCommand(API_ROUTES.taskFail(encodeURIComponent(taskId)), 'failTask', req);
  }

  async cancelTask(taskId: string, req: CancelTaskRequest): Promise<TaskMutationResponse> {
    return this.taskCommand(API_ROUTES.taskCancel(encodeURIComponent(taskId)), 'cancelTask', req);
  }

  async appendTaskEvent(
    taskId: string,
    req: AppendTaskEventRequest
  ): Promise<AppendTaskEventResponse> {
    return this.taskRequest(
      API_ROUTES.taskEvents(encodeURIComponent(taskId)),
      'appendTaskEvent',
      AppendTaskEventResponseSchema,
      'POST',
      req
    );
  }

  private async taskCommand(
    path: string,
    operation: string,
    req:
      | AssignTaskRequest
      | TaskCommandRequest
      | BlockTaskRequest
      | SubmitTaskRequest
      | FailTaskRequest
  ): Promise<TaskMutationResponse> {
    return this.taskRequest(path, operation, TaskMutationResponseSchema, 'POST', req);
  }
}
