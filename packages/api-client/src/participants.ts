import type { OpcHttpClient } from './http.js';
import type {
  GetParticipantResponse,
  RegisterParticipantRequest,
  RegisterParticipantResponse,
  UpdateParticipantRequest,
  UpdateParticipantResponse,
} from './types.js';

const ROUTES = {
  participants: '/participants',
  participant: (id: string) => `/participants/${encodeURIComponent(id)}`,
} as const;

export function createParticipantsApi(client: OpcHttpClient) {
  return {
    register: (id: string, name?: string) =>
      client.post<RegisterParticipantResponse>(ROUTES.participants, {
        id,
        name,
      } satisfies RegisterParticipantRequest),

    get: (id: string) => client.get<GetParticipantResponse>(ROUTES.participant(id)),

    update: (id: string, payload: UpdateParticipantRequest) =>
      client.patch<UpdateParticipantResponse>(ROUTES.participant(id), payload),
  };
}
