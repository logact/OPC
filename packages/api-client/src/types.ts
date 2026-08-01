// New wire types are owned by the protocol package (single source of truth);
// re-export them here so existing `@opc/api-client` imports keep working.
export type {
  AgentModelConfig,
  BroadcastMessageRequest,
  BroadcastMessageResponse,
  CreateDirectRoomRequest,
  CreateDirectRoomResponse,
  CreateDepartmentRequest,
  CreateDepartmentResponse,
  CreatePositionRequest,
  CreatePositionResponse,
  CreateStaffAssignmentRequest,
  CreateStaffAssignmentResponse,
  DeleteDepartmentResponse,
  DeletePositionResponse,
  DeleteStaffAssignmentResponse,
  Department,
  DepartmentLeader,
  DepartmentNode,
  GatewayModelCatalog,
  GetParticipantResponse,
  GetDepartmentResponse,
  GetOrganizationResponse,
  GetOrganizationTreeResponse,
  GetPositionResponse,
  GetStaffResponse,
  ListParticipantsResponse,
  ListDepartmentsResponse,
  ListPositionsQuery,
  ListPositionsResponse,
  ListStaffResponse,
  ModelInfo,
  Participant,
  ParticipantKind,
  Organization,
  OrganizationErrorCode,
  OrganizationErrorResponse,
  Position,
  ProviderModels,
  RegisterParticipantRequest,
  RegisterParticipantResponse,
  StaffAssignment,
  StaffProfile,
  UpdateDepartmentRequest,
  UpdateDepartmentResponse,
  UpdateOrganizationRequest,
  UpdateOrganizationResponse,
  UpdateParticipantRequest,
  UpdateParticipantResponse,
  UpdatePositionRequest,
  UpdatePositionResponse,
  UpdateStaffAssignmentRequest,
  UpdateStaffAssignmentResponse,
} from '@logact-pub/opc-protocol';

export interface Room {
  id: string;
  name: string;
  participantIds: string[];
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface MessageContent {
  type: 'text' | 'markdown' | 'json' | 'system';
  body: string;
}

export interface Message {
  id: string;
  roomId: string;
  from: string;
  content: MessageContent;
  clientMessageId?: string;
  createdAt: string;
}

export interface CreateRoomRequest {
  name: string;
  participantIds?: string[];
}

export interface CreateRoomResponse {
  roomId: string;
}

export interface ListRoomsResponse {
  rooms: { id: string; name: string }[];
}

export interface GetRoomResponse {
  room: Room;
}

export interface UpdateRoomRequest {
  name?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateRoomResponse {
  room: Room;
}

export interface RoomHistoryResponse {
  messages: Message[];
}

export interface GetMessageResponse {
  message: Message;
}
