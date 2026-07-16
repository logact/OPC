export const API_ROUTES = {
  rooms: '/api/v1/rooms',
  room: (id: string) => `/api/v1/rooms/${id}`,
  roomHistory: (id: string) => `/api/v1/rooms/${id}/history`,
  roomMembers: (id: string) => `/api/v1/rooms/${id}/members`,
  roomBroadcast: (id: string) => `/api/v1/rooms/${id}/broadcast`,
  directRooms: '/api/v1/rooms/direct',
  participants: '/api/v1/participants',
  participant: (id: string) => `/api/v1/participants/${id}`,
  messages: '/api/v1/messages',
  message: (id: string) => `/api/v1/messages/${id}`,
  auth: {
    login: '/api/v1/auth/login',
    mqttUser: '/api/v1/auth/mqtt/user',
    mqttSuperuser: '/api/v1/auth/mqtt/superuser',
    mqttAcl: '/api/v1/auth/mqtt/acl',
  },
} as const;
