export const API_ROUTES = {
  rooms: '/api/v1/rooms',
  room: (id: string) => `/api/v1/rooms/${id}`,
  roomHistory: (id: string) => `/api/v1/rooms/${id}/history`,
  ws: '/ws/v1',
} as const;
