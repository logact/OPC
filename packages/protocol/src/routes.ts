export const API_ROUTES = {
  rooms: '/api/v1/rooms',
  room: (id: string) => `/api/v1/rooms/${id}`,
  roomHistory: (id: string) => `/api/v1/rooms/${id}/history`,
  roomMembers: (id: string) => `/api/v1/rooms/${id}/members`,
  roomMember: (roomId: string, participantId: string) =>
    `/api/v1/rooms/${roomId}/members/${participantId}`,
  roomBroadcast: (id: string) => `/api/v1/rooms/${id}/broadcast`,
  directRooms: '/api/v1/rooms/direct',
  participants: '/api/v1/participants',
  participant: (id: string) => `/api/v1/participants/${id}`,
  /** 列出 participant 所在的全部房间（agent 离线补投时由 gateway 调用） */
  participantRooms: (id: string) => `/api/v1/participants/${id}/rooms`,
  organization: '/api/v1/organization',
  organizationTree: '/api/v1/organization/tree',
  organizationDepartments: '/api/v1/organization/departments',
  organizationDepartment: (id: string) => `/api/v1/organization/departments/${id}`,
  organizationPositions: '/api/v1/organization/positions',
  organizationPosition: (id: string) => `/api/v1/organization/positions/${id}`,
  organizationStaff: '/api/v1/organization/staff',
  organizationStaffMember: (participantId: string) =>
    `/api/v1/organization/staff/${participantId}`,
  organizationStaffAssignments: (participantId: string) =>
    `/api/v1/organization/staff/${participantId}/assignments`,
  organizationAssignment: (id: string) => `/api/v1/organization/assignments/${id}`,
  authorizationAudit: '/api/v1/authorization/audit',
  messages: '/api/v1/messages',
  message: (id: string) => `/api/v1/messages/${id}`,
  auth: {
    login: '/api/v1/auth/login',
    mqttUser: '/api/v1/auth/mqtt/user',
    mqttSuperuser: '/api/v1/auth/mqtt/superuser',
    mqttAcl: '/api/v1/auth/mqtt/acl',
  },
} as const;
