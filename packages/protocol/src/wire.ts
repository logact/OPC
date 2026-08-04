import type { z } from 'zod';
import {
  AddRoomMembersRequestSchema,
  AddRoomMembersResponseSchema,
  AgentModelConfigSchema,
  AgentPresenceStatusSchema,
  BroadcastMessageRequestSchema,
  BroadcastMessageResponseSchema,
  CreateDirectRoomRequestSchema,
  CreateDirectRoomResponseSchema,
  CreateRoomRequestSchema,
  CreateRoomResponseSchema,
  GatewayCommandSchema,
  GatewayModelCatalogSchema,
  GatewaySpawnCommandSchema,
  GetMessageResponseSchema,
  GetParticipantResponseSchema,
  GetRoomResponseSchema,
  ListParticipantsQuerySchema,
  ListParticipantsResponseSchema,
  ListRoomsResponseSchema,
  LoginRequestSchema,
  LoginResponseSchema,
  MessageContentSchema,
  MessageDeliveredEventSchema,
  MessageIntentSchema,
  MessageSchema,
  ModelInfoSchema,
  MqttAuthAclRequestSchema,
  MqttAuthSuperuserRequestSchema,
  MqttAuthUserRequestSchema,
  ParticipantJoinedEventSchema,
  ParticipantKindSchema,
  ParticipantLeftEventSchema,
  ParticipantSchema,
  PresencePayloadSchema,
  PresenceSchema,
  ProviderModelsSchema,
  RemoveRoomMemberResponseSchema,
  RegisterParticipantRequestSchema,
  RegisterParticipantResponseSchema,
  RoomHistoryResponseSchema,
  RoomHistoryQuerySchema,
  RoomSchema,
  RoomTypeSchema,
  RoomUpdatedEventSchema,
  ServerEventSchema,
  CapabilityGrantSchema,
  CapabilityScopeSchema,
  CreateDepartmentRequestSchema,
  CreateDepartmentResponseSchema,
  CreatePositionRequestSchema,
  CreatePositionResponseSchema,
  CreateStaffAssignmentRequestSchema,
  CreateStaffAssignmentResponseSchema,
  DeleteDepartmentResponseSchema,
  DeletePositionResponseSchema,
  DeleteStaffAssignmentResponseSchema,
  DepartmentLeaderSchema,
  DepartmentNodeSchema,
  DepartmentSchema,
  GetDepartmentResponseSchema,
  GetOrganizationResponseSchema,
  GetOrganizationTreeResponseSchema,
  GetPositionResponseSchema,
  GetStaffResponseSchema,
  ListDepartmentsResponseSchema,
  ListPositionsQuerySchema,
  ListPositionsResponseSchema,
  ListStaffResponseSchema,
  OrganizationErrorCodeSchema,
  OrganizationErrorResponseSchema,
  OrganizationSchema,
  PositionSchema,
  ResponsibilitySchema,
  StaffAssignmentSchema,
  StaffProfileSchema,
  UpdateDepartmentRequestSchema,
  UpdateDepartmentResponseSchema,
  UpdateOrganizationRequestSchema,
  UpdateOrganizationResponseSchema,
  UpdatePositionRequestSchema,
  UpdatePositionResponseSchema,
  UpdateStaffAssignmentRequestSchema,
  UpdateStaffAssignmentResponseSchema,
  UpdateParticipantRequestSchema,
  UpdateParticipantResponseSchema,
  UpdateRoomRequestSchema,
  UpdateRoomResponseSchema,
  UplinkPayloadSchema,
  AuthorizationAuditEntrySchema,
  AuthorizationChannelSchema,
  AuthorizationDecisionSchema,
  AuthorizationErrorCodeSchema,
  AuthorizationErrorResponseSchema,
  AuthorizationOutcomeSchema,
  AuthorizationResourceSchema,
  AuthorizationResourceTypeSchema,
  CapabilityNameSchema,
  ListAuthorizationAuditQuerySchema,
  ListAuthorizationAuditResponseSchema,
  AppendTaskEventRequestSchema,
  AppendTaskEventResponseSchema,
  ApproveTaskRequestSchema,
  AssignTaskRequestSchema,
  BlockTaskRequestSchema,
  CancelTaskRequestSchema,
  CreateTaskRequestSchema,
  CreateTaskResponseSchema,
  FailTaskRequestSchema,
  GetTaskResponseSchema,
  ListTasksQuerySchema,
  ListTasksResponseSchema,
  RecommendTaskResponseSchema,
  RejectTaskRequestSchema,
  ResumeTaskRequestSchema,
  SubmitTaskRequestSchema,
  TaskAssignmentSchema,
  TaskAvailabilitySchema,
  TaskCommandRequestSchema,
  TaskErrorCodeSchema,
  TaskErrorResponseSchema,
  TaskEventKindSchema,
  TaskEventSchema,
  TaskMutationResponseSchema,
  TaskMessageMetadataSchema,
  TaskRecommendationReasonSchema,
  TaskRecommendationSchema,
  TaskResultSchema,
  TaskSchema,
  TaskServerEventSchema,
  TaskStatusSchema,
  TaskTargetSchema,
  TaskTransitionSchema,
  UpdateTaskRequestSchema,
  UpdateTaskResponseSchema,
} from './schemas.js';

/**
 * MQTT topic 约定。
 * 客户端与 server 都是 broker 的 MQTT 客户端，通过以下 topic 通信：
 * - 上行：客户端 PUBLISH 到
 *   opc/participants/{participantId}/rooms/{roomId}/uplink
 * - 下行：server PUBLISH ServerEvent 到 opc/rooms/{roomId}/events；
 *   对房间内 kind=agent 的成员，server 额外 fan-out 到 opc/agents/{agentId}/events，
 *   由该 agent 所属的 gateway 订阅并路由给对应的 agent runtime
 */
export const MQTT_TOPICS = {
  /** server subscribes here so ACL can bind a publish to its participant actor */
  participantUplinkFilter: 'opc/participants/+/rooms/+/uplink',
  participantUplink: (participantId: string, roomId: string) =>
    `opc/participants/${participantId}/rooms/${roomId}/uplink`,
  events: (roomId: string) => `opc/rooms/${roomId}/events`,
  /** server 向指定 gateway 下发控制命令 */
  gatewayControl: (gatewayId: string) => `opc/gateways/${gatewayId}/control`,
  /** server 向 agent 所属 gateway fan-out 的房间事件（负载同房间 events topic） */
  agentEvents: (agentId: string) => `opc/agents/${agentId}/events`,
  /** server 订阅此通配 topic 接收所有 participant 的在线状态变化 */
  presenceFilter: 'opc/participants/+/presence',
  /** participant 的 presence topic：retained，负载为 PresencePayload */
  presence: (participantId: string) => `opc/participants/${participantId}/presence`,
} as const;

/** HTTP header names shared by gateway, SDK, and server authentication. */
export const OPC_HTTP_HEADERS = {
  delegatedActor: 'x-opc-actor-id',
} as const;

const PARTICIPANT_UPLINK_PATTERN =
  /^opc\/participants\/([^/]+|\+)\/rooms\/([^/]+|\+)\/uplink$/;
const EVENTS_PATTERN = /^opc\/rooms\/([^/]+)\/events$/;
const GATEWAY_CONTROL_PATTERN = /^opc\/gateways\/([^/]+)\/control$/;
const AGENT_EVENTS_PATTERN = /^opc\/agents\/([^/]+)\/events$/;
const PRESENCE_PATTERN = /^opc\/participants\/([^/]+|\+)\/presence$/;

export type RoomTopicDirection = 'uplink' | 'events';

export interface RoomTopic {
  roomId: string;
  direction: RoomTopicDirection;
  participantId?: string;
}

export interface ParticipantUplinkTopic {
  participantId: string;
  roomId: string;
}

/** Parse the enforced actor-addressed uplink topic. */
export function parseParticipantUplinkTopic(topic: string): ParticipantUplinkTopic | null {
  const match = PARTICIPANT_UPLINK_PATTERN.exec(topic);
  if (!match) return null;
  return { participantId: match[1], roomId: match[2] };
}

/** 解析房间相关 topic（上行或下行），用于 ACL 判定；不匹配返回 null */
export function parseRoomTopic(topic: string): RoomTopic | null {
  const participantUplink = PARTICIPANT_UPLINK_PATTERN.exec(topic);
  if (participantUplink) {
    return {
      participantId: participantUplink[1],
      roomId: participantUplink[2],
      direction: 'uplink',
    };
  }
  const events = EVENTS_PATTERN.exec(topic);
  if (events) return { roomId: events[1], direction: 'events' };
  return null;
}

/** 从 gateway 控制 topic 提取 gatewayId，用于 ACL 判定；不匹配返回 null */
export function parseGatewayControlTopic(topic: string): string | null {
  return GATEWAY_CONTROL_PATTERN.exec(topic)?.[1] ?? null;
}

/** 从 agent events topic 提取 agentId，用于路由与 ACL 判定；不匹配返回 null */
export function parseAgentEventsTopic(topic: string): string | null {
  return AGENT_EVENTS_PATTERN.exec(topic)?.[1] ?? null;
}

/** 从 presence topic 提取 participantId，用于 ACL 判定与消息路由；不匹配返回 null */
export function parsePresenceTopic(topic: string): string | null {
  return PRESENCE_PATTERN.exec(topic)?.[1] ?? null;
}

/**
 * 核心领域模型类型，从 Zod Schema 推导。
 * 这些类型是 OPC 生态（server + mobile + sdk）的唯一类型来源。
 */
export type Participant = z.infer<typeof ParticipantSchema>;
export type ParticipantKind = z.infer<typeof ParticipantKindSchema>;
export type RoomType = z.infer<typeof RoomTypeSchema>;
export type Presence = z.infer<typeof PresenceSchema>;
export type PresencePayload = z.infer<typeof PresencePayloadSchema>;
export type AgentPresenceStatus = z.infer<typeof AgentPresenceStatusSchema>;
export type AgentModelConfig = z.infer<typeof AgentModelConfigSchema>;
export type ModelInfo = z.infer<typeof ModelInfoSchema>;
export type ProviderModels = z.infer<typeof ProviderModelsSchema>;
export type GatewayModelCatalog = z.infer<typeof GatewayModelCatalogSchema>;
export type Organization = z.infer<typeof OrganizationSchema>;
export type Department = z.infer<typeof DepartmentSchema>;
export type DepartmentNode = z.infer<typeof DepartmentNodeSchema>;
export type DepartmentLeader = z.infer<typeof DepartmentLeaderSchema>;
export type Responsibility = z.infer<typeof ResponsibilitySchema>;
export type CapabilityScope = z.infer<typeof CapabilityScopeSchema>;
export type CapabilityName = z.infer<typeof CapabilityNameSchema>;
export type CapabilityGrant = z.infer<typeof CapabilityGrantSchema>;
export type Position = z.infer<typeof PositionSchema>;
export type StaffAssignment = z.infer<typeof StaffAssignmentSchema>;
export type StaffProfile = z.infer<typeof StaffProfileSchema>;
export type OrganizationErrorCode = z.infer<typeof OrganizationErrorCodeSchema>;
export type OrganizationErrorResponse = z.infer<typeof OrganizationErrorResponseSchema>;
export type AuthorizationResourceType = z.infer<typeof AuthorizationResourceTypeSchema>;
export type AuthorizationResource = z.infer<typeof AuthorizationResourceSchema>;
export type AuthorizationDecision = z.infer<typeof AuthorizationDecisionSchema>;
export type AuthorizationChannel = z.infer<typeof AuthorizationChannelSchema>;
export type AuthorizationOutcome = z.infer<typeof AuthorizationOutcomeSchema>;
export type AuthorizationErrorCode = z.infer<typeof AuthorizationErrorCodeSchema>;
export type AuthorizationErrorResponse = z.infer<typeof AuthorizationErrorResponseSchema>;
export type AuthorizationAuditEntry = z.infer<typeof AuthorizationAuditEntrySchema>;
export type Room = z.infer<typeof RoomSchema>;
export type Message = z.infer<typeof MessageSchema>;
export type MessageContent = z.infer<typeof MessageContentSchema>;
export type MessageIntent = z.infer<typeof MessageIntentSchema>;
export type TaskMessageMetadata = z.infer<typeof TaskMessageMetadataSchema>;
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type TaskTarget = z.infer<typeof TaskTargetSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type TaskAssignment = z.infer<typeof TaskAssignmentSchema>;
export type TaskResult = z.infer<typeof TaskResultSchema>;
export type TaskTransition = z.infer<typeof TaskTransitionSchema>;
export type TaskEventKind = z.infer<typeof TaskEventKindSchema>;
export type TaskEvent = z.infer<typeof TaskEventSchema>;
export type TaskAvailability = z.infer<typeof TaskAvailabilitySchema>;
export type TaskRecommendationReason = z.infer<typeof TaskRecommendationReasonSchema>;
export type TaskRecommendation = z.infer<typeof TaskRecommendationSchema>;
export type TaskErrorCode = z.infer<typeof TaskErrorCodeSchema>;
export type TaskErrorResponse = z.infer<typeof TaskErrorResponseSchema>;

/**
 * 客户端 → server 的上行消息负载（PUBLISH 到 uplink topic 的 JSON body）。
 * 人与 agent 使用完全相同的负载格式。
 */
export type UplinkPayload = z.infer<typeof UplinkPayloadSchema>;

/**
 * server → 客户端的下行负载：即下方从 ServerEventSchema 推导的 ServerEvent，
 * PUBLISH 到对应房间的 events topic。
 */
export type DownlinkPayload = ServerEvent;

/**
 * HTTP API 负载类型
 */
export type CreateRoomRequest = z.infer<typeof CreateRoomRequestSchema>;
export type CreateRoomResponse = z.infer<typeof CreateRoomResponseSchema>;
export type ListRoomsResponse = z.infer<typeof ListRoomsResponseSchema>;
export type GetRoomResponse = z.infer<typeof GetRoomResponseSchema>;
export type UpdateRoomRequest = z.infer<typeof UpdateRoomRequestSchema>;
export type UpdateRoomResponse = z.infer<typeof UpdateRoomResponseSchema>;
export type RoomHistoryResponse = z.infer<typeof RoomHistoryResponseSchema>;
export type RoomHistoryQuery = z.infer<typeof RoomHistoryQuerySchema>;
export type AddRoomMembersRequest = z.infer<typeof AddRoomMembersRequestSchema>;
export type AddRoomMembersResponse = z.infer<typeof AddRoomMembersResponseSchema>;
export type RemoveRoomMemberResponse = z.infer<typeof RemoveRoomMemberResponseSchema>;
export type CreateDirectRoomRequest = z.infer<typeof CreateDirectRoomRequestSchema>;
export type CreateDirectRoomResponse = z.infer<typeof CreateDirectRoomResponseSchema>;
export type BroadcastMessageRequest = z.infer<typeof BroadcastMessageRequestSchema>;
export type BroadcastMessageResponse = z.infer<typeof BroadcastMessageResponseSchema>;
export type RegisterParticipantRequest = z.infer<typeof RegisterParticipantRequestSchema>;
export type RegisterParticipantResponse = z.infer<typeof RegisterParticipantResponseSchema>;
export type ListParticipantsResponse = z.infer<typeof ListParticipantsResponseSchema>;
export type ListParticipantsQuery = z.infer<typeof ListParticipantsQuerySchema>;
export type GetParticipantResponse = z.infer<typeof GetParticipantResponseSchema>;
export type UpdateParticipantRequest = z.infer<typeof UpdateParticipantRequestSchema>;
export type UpdateParticipantResponse = z.infer<typeof UpdateParticipantResponseSchema>;
export type GetMessageResponse = z.infer<typeof GetMessageResponseSchema>;
export type LoginRequest = z.infer<typeof LoginRequestSchema>;
export type LoginResponse = z.infer<typeof LoginResponseSchema>;
export type GetOrganizationResponse = z.infer<typeof GetOrganizationResponseSchema>;
export type UpdateOrganizationRequest = z.infer<typeof UpdateOrganizationRequestSchema>;
export type UpdateOrganizationResponse = z.infer<typeof UpdateOrganizationResponseSchema>;
export type GetOrganizationTreeResponse = z.infer<typeof GetOrganizationTreeResponseSchema>;
export type ListDepartmentsResponse = z.infer<typeof ListDepartmentsResponseSchema>;
export type CreateDepartmentRequest = z.infer<typeof CreateDepartmentRequestSchema>;
export type CreateDepartmentResponse = z.infer<typeof CreateDepartmentResponseSchema>;
export type GetDepartmentResponse = z.infer<typeof GetDepartmentResponseSchema>;
export type UpdateDepartmentRequest = z.infer<typeof UpdateDepartmentRequestSchema>;
export type UpdateDepartmentResponse = z.infer<typeof UpdateDepartmentResponseSchema>;
export type DeleteDepartmentResponse = z.infer<typeof DeleteDepartmentResponseSchema>;
export type ListPositionsQuery = z.infer<typeof ListPositionsQuerySchema>;
export type ListPositionsResponse = z.infer<typeof ListPositionsResponseSchema>;
export type CreatePositionRequest = z.infer<typeof CreatePositionRequestSchema>;
export type CreatePositionResponse = z.infer<typeof CreatePositionResponseSchema>;
export type GetPositionResponse = z.infer<typeof GetPositionResponseSchema>;
export type UpdatePositionRequest = z.infer<typeof UpdatePositionRequestSchema>;
export type UpdatePositionResponse = z.infer<typeof UpdatePositionResponseSchema>;
export type DeletePositionResponse = z.infer<typeof DeletePositionResponseSchema>;
export type ListStaffResponse = z.infer<typeof ListStaffResponseSchema>;
export type GetStaffResponse = z.infer<typeof GetStaffResponseSchema>;
export type CreateStaffAssignmentRequest = z.infer<typeof CreateStaffAssignmentRequestSchema>;
export type CreateStaffAssignmentResponse = z.infer<typeof CreateStaffAssignmentResponseSchema>;
export type UpdateStaffAssignmentRequest = z.infer<typeof UpdateStaffAssignmentRequestSchema>;
export type UpdateStaffAssignmentResponse = z.infer<typeof UpdateStaffAssignmentResponseSchema>;
export type DeleteStaffAssignmentResponse = z.infer<typeof DeleteStaffAssignmentResponseSchema>;
export type ListAuthorizationAuditQuery = z.infer<typeof ListAuthorizationAuditQuerySchema>;
export type ListAuthorizationAuditResponse = z.infer<typeof ListAuthorizationAuditResponseSchema>;
export type CreateTaskRequest = z.infer<typeof CreateTaskRequestSchema>;
export type CreateTaskResponse = z.infer<typeof CreateTaskResponseSchema>;
export type ListTasksQuery = z.infer<typeof ListTasksQuerySchema>;
export type ListTasksResponse = z.infer<typeof ListTasksResponseSchema>;
export type GetTaskResponse = z.infer<typeof GetTaskResponseSchema>;
export type UpdateTaskRequest = z.infer<typeof UpdateTaskRequestSchema>;
export type UpdateTaskResponse = z.infer<typeof UpdateTaskResponseSchema>;
export type RecommendTaskResponse = z.infer<typeof RecommendTaskResponseSchema>;
export type AssignTaskRequest = z.infer<typeof AssignTaskRequestSchema>;
export type TaskCommandRequest = z.infer<typeof TaskCommandRequestSchema>;
export type BlockTaskRequest = z.infer<typeof BlockTaskRequestSchema>;
export type ResumeTaskRequest = z.infer<typeof ResumeTaskRequestSchema>;
export type SubmitTaskRequest = z.infer<typeof SubmitTaskRequestSchema>;
export type ApproveTaskRequest = z.infer<typeof ApproveTaskRequestSchema>;
export type RejectTaskRequest = z.infer<typeof RejectTaskRequestSchema>;
export type FailTaskRequest = z.infer<typeof FailTaskRequestSchema>;
export type CancelTaskRequest = z.infer<typeof CancelTaskRequestSchema>;
export type AppendTaskEventRequest = z.infer<typeof AppendTaskEventRequestSchema>;
export type AppendTaskEventResponse = z.infer<typeof AppendTaskEventResponseSchema>;
export type TaskMutationResponse = z.infer<typeof TaskMutationResponseSchema>;

/**
 * mosquitto-go-auth HTTP 后端回调负载。
 * 见 https://github.com/iegomez/mosquitto-go-auth#http
 */
export type MqttAuthUserRequest = z.infer<typeof MqttAuthUserRequestSchema>;
export type MqttAuthSuperuserRequest = z.infer<typeof MqttAuthSuperuserRequestSchema>;
export type MqttAuthAclRequest = z.infer<typeof MqttAuthAclRequestSchema>;

export const MQTT_ACL = {
  READ: 1,
  WRITE: 2,
  READWRITE: 3,
  SUBSCRIBE: 4,
} as const;

// 事件联合类型，从 schema 推导以同时支持运行时校验
export type MessageDeliveredEvent = z.infer<typeof MessageDeliveredEventSchema>;
export type ParticipantJoinedEvent = z.infer<typeof ParticipantJoinedEventSchema>;
export type ParticipantLeftEvent = z.infer<typeof ParticipantLeftEventSchema>;
export type RoomUpdatedEvent = z.infer<typeof RoomUpdatedEventSchema>;
export type TaskServerEvent = z.infer<typeof TaskServerEventSchema>;
export type ServerEvent = z.infer<typeof ServerEventSchema>;
export type GatewayCommand = z.infer<typeof GatewayCommandSchema>;
export type GatewaySpawnCommand = z.infer<typeof GatewaySpawnCommandSchema>;
