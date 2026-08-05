import { z } from 'zod';

/**
 * 核心领域模型的 Zod Schemas。
 * 这些 schema 同时用于：
 * - HTTP API 请求/响应校验
 * - OpenAPI 文档生成
 * - 推导核心领域模型 TS 类型（见 wire.ts，OPC 生态的唯一类型来源）
 */

export const MessageContentSchema = z.object({
  type: z.enum(['text', 'markdown', 'json', 'system']),
  body: z.string(),
});

/**
 * 消息意图（issue #104）：可选标注，供消费端（mobile / agent）区分
 * 任务指派与提问。缺省表示普通消息，向后兼容。
 */
export const MessageIntentSchema = z.enum(['task', 'question']);

/**
 * Namespaced metadata used by the durable agent task execution flow.
 * Ordinary message metadata remains open-ended; consumers opt into this
 * schema only when `metadata.opcTask` is present.
 */
export const TaskMessageMetadataSchema = z
  .object({
    opcTask: z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('assignment'),
        taskId: z.string().min(1),
        assignmentId: z.string().min(1),
        assigneeId: z.string().min(1),
      }),
      z.object({
        kind: z.literal('reply'),
        taskId: z.string().min(1),
        assignmentId: z.string().min(1),
        threadId: z.string().min(1),
      }),
    ]),
  })
  .passthrough();

export const MessageSchema = z.object({
  id: z.string(),
  roomId: z.string(),
  from: z.string(),
  content: MessageContentSchema,
  timestamp: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  intent: MessageIntentSchema.optional(),
});

/**
 * MQTT room uplink body. The authenticated sender is encoded in the enforced
 * participant-addressed topic; `from` remains optional for one migration window.
 */
export const UplinkPayloadSchema = z.object({
  from: z.string().min(1).optional(),
  content: MessageContentSchema,
  clientMessageId: z.string().min(1).optional(),
  intent: MessageIntentSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const ParticipantKindSchema = z.enum(['human', 'agent', 'gateway']);

/** Agent 的 LLM 模型配置，注册时随 agent.spawn 命令转发给 gateway */
export const AgentModelConfigSchema = z.object({
  provider: z.string(),
  modelId: z.string(),
  apiKey: z.string().optional(),
});

/**
 * Agent 的应用层忙闲状态（issue #83）。与 `online` 正交：offline 由连接层
 * （LWT/断连）表达，不进入此枚举；展示层按 `!online → offline; online →
 * status ?? 'idle'` 合成 5 态。仅 kind='agent' 的 participant 发布。
 *
 * - `working`：任一线程 running（模型推理或工具执行中）
 * - `blocking`：无 running，但任一线程 waiting/paused（已回复等输入，或被暂停）
 * - `error`：无活跃线程，但任一线程 error（最近一次运行失败且未恢复）
 * - `idle`：在线且空闲
 */
export const AgentPresenceStatusSchema = z.enum(['idle', 'working', 'blocking', 'error']);

/**
 * Participant 在线状态。online 由 MQTT 连接生命周期驱动（LWT + retained
 * presence topic，见 wire.ts 的 MQTT_TOPICS.presence）；lastSeen 是 server
 * 收到最近一次 presence 消息时打的服务器时间（ISO 字符串）。
 * 从未上线过的 participant 没有 presence 字段。
 */
export const PresenceSchema = z.object({
  online: z.boolean(),
  lastSeen: z.string(),
  /** agent 忙闲状态；仅 agent 有值，人类 participant 无此字段 */
  status: AgentPresenceStatusSchema.optional(),
});

/** gateway 模型目录中的单个模型（映射自 pi-ai 内建目录） */
export const ModelInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  reasoning: z.boolean().optional(),
  contextWindow: z.number().optional(),
  maxTokens: z.number().optional(),
});

/** 单个 provider 及其可选模型列表 */
export const ProviderModelsSchema = z.object({
  provider: z.string(),
  models: z.array(ModelInfoSchema),
});

/**
 * gateway 上报的运行时模型目录，持久化在 gateway participant 的
 * `metadata.modelCatalog`，供 mobile Add Agent 页面动态渲染 provider/model 选项。
 */
export const GatewayModelCatalogSchema = z.object({
  providers: z.array(ProviderModelsSchema),
  /** catalog 生成时间（ISO 8601） */
  updatedAt: z.string(),
});

export const ParticipantSchema = z.object({
  id: z.string(),
  kind: ParticipantKindSchema,
  name: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  presence: PresenceSchema.optional(),
  /** 所属 gateway 的 participant id；仅 kind='agent' 且注册时提供 gatewayId 时有值 */
  gatewayId: z.string().optional(),
});

export const RoomTypeSchema = z.enum(['group', 'direct']);

export const RoomSchema = z.object({
  id: z.string(),
  name: z.string(),
  participantIds: z.array(z.string()),
  creatorId: z.string(),
  type: RoomTypeSchema,
  departmentId: z.string().nullable(),
  createdAt: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const MessageDeliveredEventSchema = z.object({
  type: z.literal('message.delivered'),
  message: MessageSchema,
});

export const ParticipantJoinedEventSchema = z.object({
  type: z.literal('participant.joined'),
  roomId: z.string(),
  participant: ParticipantSchema,
});

export const ParticipantLeftEventSchema = z.object({
  type: z.literal('participant.left'),
  roomId: z.string(),
  participantId: z.string(),
});

export const RoomUpdatedEventSchema = z.object({
  type: z.literal('room.updated'),
  room: RoomSchema,
});

/**
 * issue #130：`task.approved` / `task.rejected` 已废弃（review 环节移除），
 * server 不再产生这两种事件；枚举保留仅为兼容不可变的历史事件记录。
 */
export const TaskEventKindSchema = z.enum([
  'task.created',
  'task.updated',
  'task.assigned',
  'task.reassigned',
  'task.started',
  'task.blocked',
  'task.resumed',
  'task.submitted',
  'task.approved',
  'task.rejected',
  'task.failed',
  'task.cancelled',
  'progress',
  'note',
  'decision',
  'artifact',
]);

export const TaskEventSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  kind: TaskEventKindSchema,
  actorId: z.string().min(1),
  message: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.string().datetime(),
});

export const TaskServerEventSchema = z.object({
  type: z.literal('task.event'),
  roomId: z.string().min(1),
  taskId: z.string().min(1),
  event: TaskEventSchema,
});

export const ServerEventSchema = z.discriminatedUnion('type', [
  MessageDeliveredEventSchema,
  ParticipantJoinedEventSchema,
  ParticipantLeftEventSchema,
  RoomUpdatedEventSchema,
  TaskServerEventSchema,
]);

/**
 * HTTP API 请求/响应 Schemas
 */

export const CreateRoomRequestSchema = z.object({
  name: z.string().min(1),
  participantIds: z.array(z.string()).optional(),
  departmentId: z.string().min(1).optional(),
});

export const CreateRoomResponseSchema = z.object({
  roomId: z.string(),
});

export const ListRoomsResponseSchema = z.object({
  rooms: z.array(RoomSchema),
});

export const GetRoomResponseSchema = z.object({
  room: RoomSchema,
});

export const UpdateRoomRequestSchema = z.object({
  name: z.string().min(1).optional(),
  departmentId: z.string().min(1).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const UpdateRoomResponseSchema = z.object({
  room: RoomSchema,
});

export const RoomHistoryResponseSchema = z.object({
  messages: z.array(MessageSchema),
});

/**
 * GET /rooms/{id}/history 的可选查询参数。
 * since：ISO 8601 时间戳，仅返回 timestamp 严格大于 since 的消息，
 * 供 gateway 离线补投时按水位游标增量拉取；缺省返回全部历史。
 */
export const RoomHistoryQuerySchema = z.object({
  since: z.string().datetime().optional(),
});

export const RegisterParticipantRequestSchema = z.object({
  id: z.string().min(1),
  kind: ParticipantKindSchema.optional(),
  name: z.string().optional(),
  password: z.string().min(6).optional(),
  gatewayId: z.string().optional(),
  model: AgentModelConfigSchema.optional(),
});

export const RegisterParticipantResponseSchema = z.object({
  participantId: z.string(),
  /** 明文 token 仅此一次返回，server 只保存其哈希 */
  token: z.string(),
});

export const LoginRequestSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const LoginResponseSchema = z.object({
  accessToken: z.string(),
  participant: ParticipantSchema,
});

export const ListParticipantsResponseSchema = z.object({
  participants: z.array(ParticipantSchema),
});

/** GET /participants 的可选查询参数：按 kind / 所属 gateway 过滤（可组合） */
export const ListParticipantsQuerySchema = z.object({
  kind: ParticipantKindSchema.optional(),
  gatewayId: z.string().optional(),
});

export const GetParticipantResponseSchema = z.object({
  participant: ParticipantSchema,
});

export const AddRoomMembersRequestSchema = z.object({
  participantIds: z.array(z.string().min(1)).min(1),
});

export const AddRoomMembersResponseSchema = z.object({
  room: RoomSchema,
});

export const RemoveRoomMemberResponseSchema = z.object({
  room: RoomSchema,
});

export const CreateDirectRoomRequestSchema = z.object({
  participantIds: z.array(z.string().min(1)).length(2),
});

export const CreateDirectRoomResponseSchema = z.object({
  roomId: z.string(),
});

export const BroadcastMessageRequestSchema = z.object({
  /** @deprecated sender is resolved from the authenticated actor and must match when present */
  from: z.string().min(1).optional(),
  content: MessageContentSchema,
  intent: MessageIntentSchema.optional(),
});

export const BroadcastMessageResponseSchema = z.object({
  message: MessageSchema,
});

export const UpdateParticipantRequestSchema = z.object({
  name: z.string().optional(),
  kind: ParticipantKindSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  /** gateway 上报模型目录；server 合并进 participant 的 metadata.modelCatalog */
  modelCatalog: GatewayModelCatalogSchema.optional(),
});

export const UpdateParticipantResponseSchema = z.object({
  participant: ParticipantSchema,
});

export const GetMessageResponseSchema = z.object({
  message: MessageSchema,
});

/**
 * Organization contract (issue #14).
 *
 * The organization is a deployment singleton. Departments form an adjacency
 * tree; positions own their responsibilities, normalized skill tags, and
 * capability grants; human/agent participants receive staff profiles.
 */

export const OrganizationSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const DepartmentSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  name: z.string().min(1),
  parentId: z.string().min(1).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const ResponsibilitySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
});

export const CapabilityScopeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('self') }),
  z.object({ type: z.literal('department') }),
  z.object({ type: z.literal('department_subtree') }),
  z.object({ type: z.literal('organization') }),
]);

/**
 * Closed capability catalog for the organization-scoped authorization model.
 * Unknown legacy strings intentionally parse as invalid and never confer access.
 */
/**
 * issue #130：task 授权改为基于角色（creator / assignee / 房间成员），
 * 不再走 department-scoped capability，task.* 能力名整体移除。
 */
export const CapabilityNameSchema = z.enum([
  'organization.read',
  'organization.manage',
  'department.read',
  'department.manage',
  'position.read',
  'position.manage',
  'staff.read',
  'staff.manage',
  'participant.read',
  'participant.manage',
  'agent.manage',
  'room.create',
  'room.read',
  'room.manage',
  'room.members.manage',
  'message.read',
  'message.send',
  'capability.delegate',
  'authorization.audit.read',
]);

export const CapabilityGrantSchema = z.object({
  capability: CapabilityNameSchema,
  scope: CapabilityScopeSchema,
});

const SkillTagsSchema = z
  .array(z.string().trim().min(1).transform((tag) => tag.toLowerCase()))
  .transform((tags) => [...new Set(tags)].sort());

export const PositionSchema = z.object({
  id: z.string().min(1),
  departmentId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  responsibilities: z.array(ResponsibilitySchema),
  skillTags: SkillTagsSchema,
  capabilityGrants: z.array(CapabilityGrantSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const StaffAssignmentSchema = z.object({
  id: z.string().min(1),
  staffParticipantId: z.string().min(1),
  positionId: z.string().min(1),
  departmentId: z.string().min(1),
  active: z.boolean(),
  isDepartmentLeader: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const StaffProfileSchema = z.object({
  participantId: z.string().min(1),
  organizationId: z.string().min(1),
  isOwner: z.boolean(),
  assignments: z.array(StaffAssignmentSchema),
  effectiveResponsibilities: z.array(ResponsibilitySchema),
  effectiveSkillTags: SkillTagsSchema,
  effectiveCapabilityGrants: z.array(CapabilityGrantSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const DepartmentLeaderSchema = z.object({
  participantId: z.string().min(1),
  name: z.string().min(1),
  assignmentId: z.string().min(1),
  positionId: z.string().min(1),
});

type DepartmentNodeShape = z.infer<typeof DepartmentSchema> & {
  positions: z.infer<typeof PositionSchema>[];
  leaders: z.infer<typeof DepartmentLeaderSchema>[];
  children: DepartmentNodeShape[];
};

export const DepartmentNodeSchema: z.ZodType<DepartmentNodeShape> = DepartmentSchema.extend({
  positions: z.array(PositionSchema),
  leaders: z.array(DepartmentLeaderSchema),
  children: z.lazy(() => z.array(DepartmentNodeSchema)),
}).meta({ id: 'DepartmentNode' });

/**
 * issue #130：task 不再是 capability 授权资源（任务授权改为角色制），
 * AuthorizationResourceSchema 的 task variant 已移除；资源类型枚举保留
 * 'task' 仅为兼容不可变的历史授权审计记录（升级前写入的 resourceType='task'）。
 */
export const AuthorizationResourceTypeSchema = z.enum([
  'organization',
  'department',
  'position',
  'staff',
  'participant',
  'agent',
  'room',
  'message',
  'task',
  'authorization_audit',
]);

const DepartmentScopedResourceSchema = z.object({
  id: z.string().min(1),
  departmentId: z.string().min(1),
});

export const AuthorizationResourceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('organization'), id: z.string().min(1) }),
  DepartmentScopedResourceSchema.extend({ type: z.literal('department') }),
  DepartmentScopedResourceSchema.extend({ type: z.literal('position') }),
  z.object({
    type: z.literal('staff'),
    id: z.string().min(1),
    participantId: z.string().min(1),
    departmentIds: z.array(z.string().min(1)),
  }),
  z.object({
    type: z.literal('participant'),
    id: z.string().min(1),
    participantId: z.string().min(1),
    departmentIds: z.array(z.string().min(1)),
  }),
  z.object({
    type: z.literal('agent'),
    id: z.string().min(1),
    participantId: z.string().min(1),
    departmentIds: z.array(z.string().min(1)),
    gatewayId: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal('room'),
    id: z.string().min(1),
    creatorId: z.string().min(1),
    roomType: RoomTypeSchema,
    departmentId: z.string().min(1).nullable(),
    participantIds: z.array(z.string().min(1)),
  }),
  z.object({
    type: z.literal('message'),
    id: z.string().min(1),
    roomId: z.string().min(1),
    creatorId: z.string().min(1),
    departmentId: z.string().min(1).nullable(),
    participantIds: z.array(z.string().min(1)),
  }),
  z.object({ type: z.literal('authorization_audit'), id: z.string().min(1) }),
]);

export const AuthorizationChannelSchema = z.enum(['http', 'mqtt']);
export const AuthorizationOutcomeSchema = z.enum(['allowed', 'denied']);
export const AuthorizationErrorCodeSchema = z.enum(['unauthorized', 'forbidden']);

export const AuthorizationErrorResponseSchema = z.object({
  error: z.object({
    code: AuthorizationErrorCodeSchema,
    message: z.string().min(1),
  }),
});

export const AuthorizationDecisionSchema = z.object({
  allowed: z.boolean(),
  action: CapabilityNameSchema,
  reason: z.string().min(1),
  matchedAssignmentId: z.string().min(1).optional(),
  matchedScope: CapabilityScopeSchema.optional(),
});

export const AuthorizationAuditEntrySchema = z.object({
  id: z.string().min(1),
  actorId: z.string().min(1).nullable(),
  claimedActorId: z.string().min(1).optional(),
  channel: AuthorizationChannelSchema,
  action: CapabilityNameSchema,
  resourceType: AuthorizationResourceTypeSchema,
  resourceId: z.string().min(1),
  departmentId: z.string().min(1).nullable().optional(),
  outcome: AuthorizationOutcomeSchema,
  reason: z.string().min(1),
  timestamp: z.string().datetime(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const ListAuthorizationAuditQuerySchema = z.object({
  actorId: z.string().min(1).optional(),
  outcome: AuthorizationOutcomeSchema.optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const ListAuthorizationAuditResponseSchema = z.object({
  entries: z.array(AuthorizationAuditEntrySchema),
  nextCursor: z.string().min(1).optional(),
});

export const OrganizationErrorCodeSchema = z.enum([
  'organization_not_found',
  'department_not_found',
  'position_not_found',
  'staff_not_found',
  'assignment_not_found',
  'invalid_department_parent',
  'department_cycle',
  'department_has_dependents',
  'position_has_assignments',
  'staff_has_assignments',
  'duplicate_assignment',
  'participant_not_staff',
  'invalid_department_leader',
  'owner_immutable',
  'validation_error',
]);

export const OrganizationErrorResponseSchema = z.object({
  error: z.object({
    code: OrganizationErrorCodeSchema,
    message: z.string().min(1),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

export const OrganizationResourceIdParamSchema = z.object({
  id: z.string().min(1),
});

export const OrganizationStaffParamSchema = z.object({
  participantId: z.string().min(1),
});

export const GetOrganizationResponseSchema = z.object({
  organization: OrganizationSchema,
});

export const UpdateOrganizationRequestSchema = z.object({
  name: z.string().trim().min(1),
});

export const UpdateOrganizationResponseSchema = GetOrganizationResponseSchema;

export const GetOrganizationTreeResponseSchema = z.object({
  organization: OrganizationSchema,
  departments: z.array(DepartmentNodeSchema),
});

export const ListDepartmentsResponseSchema = z.object({
  departments: z.array(DepartmentSchema),
});

export const CreateDepartmentRequestSchema = z.object({
  name: z.string().trim().min(1),
  parentId: z.string().min(1).nullable().optional(),
});

export const CreateDepartmentResponseSchema = z.object({
  department: DepartmentSchema,
});

export const GetDepartmentResponseSchema = CreateDepartmentResponseSchema;

export const UpdateDepartmentRequestSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    parentId: z.string().min(1).nullable().optional(),
  })
  .refine((value) => value.name !== undefined || value.parentId !== undefined, {
    message: 'at least one department field is required',
  });

export const UpdateDepartmentResponseSchema = CreateDepartmentResponseSchema;

export const DeleteDepartmentResponseSchema = z.object({
  departmentId: z.string().min(1),
});

export const ListPositionsQuerySchema = z.object({
  departmentId: z.string().min(1).optional(),
});

const PositionDetailsSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().optional(),
  responsibilities: z.array(ResponsibilitySchema).optional(),
  skillTags: SkillTagsSchema.optional(),
  capabilityGrants: z.array(CapabilityGrantSchema).optional(),
});

export const CreatePositionRequestSchema = PositionDetailsSchema.extend({
  departmentId: z.string().min(1),
});

export const CreatePositionResponseSchema = z.object({
  position: PositionSchema,
});

export const ListPositionsResponseSchema = z.object({
  positions: z.array(PositionSchema),
});

export const GetPositionResponseSchema = CreatePositionResponseSchema;

export const UpdatePositionRequestSchema = PositionDetailsSchema.partial()
  .extend({
    departmentId: z.string().min(1).optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'at least one position field is required',
  });

export const UpdatePositionResponseSchema = CreatePositionResponseSchema;

export const DeletePositionResponseSchema = z.object({
  positionId: z.string().min(1),
});

export const ListStaffResponseSchema = z.object({
  staff: z.array(StaffProfileSchema),
});

export const GetStaffResponseSchema = z.object({
  staff: StaffProfileSchema,
});

export const CreateStaffAssignmentRequestSchema = z.object({
  positionId: z.string().min(1),
  active: z.boolean().optional(),
  isDepartmentLeader: z.boolean().optional(),
});

export const CreateStaffAssignmentResponseSchema = z.object({
  assignment: StaffAssignmentSchema,
});

export const UpdateStaffAssignmentRequestSchema = z
  .object({
    active: z.boolean().optional(),
    isDepartmentLeader: z.boolean().optional(),
  })
  .refine((value) => value.active !== undefined || value.isDepartmentLeader !== undefined, {
    message: 'at least one assignment field is required',
  });

export const UpdateStaffAssignmentResponseSchema = CreateStaffAssignmentResponseSchema;

export const DeleteStaffAssignmentResponseSchema = z.object({
  assignmentId: z.string().min(1),
});

/**
 * First-class task domain (issue #109, simplified in issue #130).
 * These schemas are the sole public contract for task persistence, HTTP, and
 * realtime events. Server/database/client layers derive their types from here.
 *
 * issue #130 简化：任务不再绑定 department，移除 reviewer/collaborator 角色、
 * candidate recommendation 与 review 状态；submit 直接进入 completed。
 * 授权从 department-scoped capability 改为角色制（creator / assignee / 任务房间成员）。
 */
export const TaskStatusSchema = z.enum([
  'draft',
  'assigned',
  'in_progress',
  'blocked',
  'completed',
  'failed',
  'cancelled',
]);

export const TaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  creatorId: z.string().min(1),
  status: TaskStatusSchema,
  assigneeId: z.string().min(1).nullable(),
  roomId: z.string().min(1).nullable(),
  latestResultId: z.string().min(1).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  assignedAt: z.string().datetime().nullable(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
});

export const TaskAssignmentSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  assigneeId: z.string().min(1),
  confirmedBy: z.string().min(1),
  idempotencyKey: z.string().min(1),
  createdAt: z.string().datetime(),
  supersededAt: z.string().datetime().nullable(),
  supersededReason: z.string().min(1).nullable(),
});

export const TaskResultSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  submittedBy: z.string().min(1),
  summary: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.string().datetime(),
});

export const TaskTransitionSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  from: TaskStatusSchema.nullable(),
  to: TaskStatusSchema,
  actorId: z.string().min(1),
  reason: z.string().min(1).nullable(),
  details: z.record(z.string(), z.unknown()).optional(),
  idempotencyKey: z.string().min(1),
  createdAt: z.string().datetime(),
});

export const TaskErrorCodeSchema = z.enum([
  'task_not_found',
  'task_not_draft',
  'invalid_task_transition',
  'invalid_task_participant',
  'task_idempotency_conflict',
  'task_concurrent_update',
  'stale_task_assignment',
  'human_confirmation_required',
  'forbidden',
  'validation_error',
]);

export const TaskErrorResponseSchema = z.object({
  error: z.object({
    code: TaskErrorCodeSchema,
    message: z.string().min(1),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

export const TaskIdParamSchema = z.object({ id: z.string().min(1) });

/**
 * 创建任务；可选 assigneeId 表示创建即指派（issue #130）——任务直接创建为
 * assigned 状态并在同一步骤内建好房间、成员与 dispatch。
 * 不带 assigneeId 时任务保持 draft，可稍后再 assign / reassign。
 */
export const CreateTaskRequestSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().optional(),
  assigneeId: z.string().min(1).optional(),
});

export const CreateTaskResponseSchema = z.object({ task: TaskSchema });

export const ListTasksQuerySchema = z.object({
  status: TaskStatusSchema.optional(),
  creatorId: z.string().min(1).optional(),
  assigneeId: z.string().min(1).optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const ListTasksResponseSchema = z.object({
  tasks: z.array(TaskSchema),
  nextCursor: z.string().min(1).optional(),
});

export const GetTaskResponseSchema = z.object({
  task: TaskSchema,
  assignments: z.array(TaskAssignmentSchema),
  results: z.array(TaskResultSchema),
  transitions: z.array(TaskTransitionSchema),
  events: z.array(TaskEventSchema),
});

export const UpdateTaskRequestSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    description: z.string().optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'at least one task field is required',
  });

export const UpdateTaskResponseSchema = CreateTaskResponseSchema;
export const TaskMutationResponseSchema = CreateTaskResponseSchema;

const IdempotencyKeySchema = z.string().trim().min(1).max(200);

export const AssignTaskRequestSchema = z.object({
  assigneeId: z.string().min(1),
  reason: z.string().trim().min(1).optional(),
  idempotencyKey: IdempotencyKeySchema,
});

export const TaskCommandRequestSchema = z.object({
  idempotencyKey: IdempotencyKeySchema,
  /** Current assignment precondition used by delegated agent callbacks. */
  assignmentId: z.string().min(1).optional(),
});

export const BlockTaskRequestSchema = TaskCommandRequestSchema.extend({
  reason: z.string().trim().min(1),
});

export const ResumeTaskRequestSchema = BlockTaskRequestSchema;

export const SubmitTaskRequestSchema = TaskCommandRequestSchema.extend({
  summary: z.string().trim().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const FailTaskRequestSchema = TaskCommandRequestSchema.extend({
  reason: z.string().trim().min(1),
  diagnostics: z.string().trim().min(1).optional(),
});

export const CancelTaskRequestSchema = BlockTaskRequestSchema;

export const AppendTaskEventRequestSchema = TaskCommandRequestSchema.extend({
  kind: z.enum(['progress', 'note', 'decision', 'artifact']),
  message: z.string().trim().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const AppendTaskEventResponseSchema = z.object({
  task: TaskSchema,
  event: TaskEventSchema,
});

/**
 * mosquitto-go-auth HTTP 后端回调负载。
 * 见 https://github.com/iegomez/mosquitto-go-auth#http
 */
export const MqttAuthUserRequestSchema = z.object({
  username: z.string(),
  password: z.string(),
  clientid: z.string().optional().nullable(),
});

/**
 * mosquitto-go-auth superuser 回调只发送 username（没有 password/clientid）。
 * 保持独立 schema 以兼容 broker 实际负载。
 */
export const MqttAuthSuperuserRequestSchema = z.object({
  username: z.string(),
  clientid: z.string().optional().nullable(),
});

export const MqttAuthAclRequestSchema = z.object({
  username: z.string(),
  topic: z.string(),
  /** 1=read, 2=write, 3=readwrite, 4=subscribe */
  acc: z.number(),
  clientid: z.string().optional().nullable(),
});

/**
 * Presence topic 负载：客户端 PUBLISH 到 opc/participants/{id}/presence 的 JSON body。
 * retained + qos 1。负载不携带时间戳——LWT 在 CONNECT 时注册，其内嵌时间必是
 * 连接时间而非断线时间，lastSeen 一律由 server 收到消息时打服务器时间。
 */
export const PresencePayloadSchema = z.object({
  online: z.boolean(),
  /** agent 忙闲状态（见 AgentPresenceStatusSchema）；人类 participant 不携带 */
  status: AgentPresenceStatusSchema.optional(),
});

/**
 * Gateway 控制面命令：server PUBLISH 到 opc/gateways/{gatewayId}/control，
 * gateway SUBSCRIBE 该 topic 后执行对应生命周期操作。
 */
export const GatewaySpawnCommandSchema = z.object({
  type: z.literal('agent.spawn'),
  participantId: z.string(),
  /**
   * @deprecated gateway 单连接多路复用后 agent 不再有独立 MQTT 连接，
   * server 不再下发 token；字段保留一期作兼容层，供旧版 gateway 解析。
   */
  token: z.string().optional(),
  name: z.string().optional(),
  model: AgentModelConfigSchema.optional(),
});

export const GatewayStopCommandSchema = z.object({
  type: z.literal('agent.stop'),
  participantId: z.string(),
});

export const GatewayCommandSchema = z.discriminatedUnion('type', [
  GatewaySpawnCommandSchema,
  GatewayStopCommandSchema,
]);
