import { API_ROUTES, ListParticipantsResponseSchema } from '@logact-pub/opc-protocol';
import type { OpcHttpClient } from './http.js';
import type {
  GetParticipantResponse,
  ListParticipantsResponse,
  RegisterParticipantRequest,
  RegisterParticipantResponse,
  UpdateParticipantRequest,
  UpdateParticipantResponse,
} from './types.js';

// API_ROUTES paths carry the /api/v1 prefix, which the http client's baseURL
// (buildBaseURL) already prepends — strip it to keep request URLs unchanged.
const API_PREFIX = '/api/v1';

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

    list: async (): Promise<ListParticipantsResponse> => {
      const data = await client.get<unknown>(API_ROUTES.participants.replace(API_PREFIX, ''));
      return ListParticipantsResponseSchema.parse(data);
    },

    get: (id: string) => client.get<GetParticipantResponse>(ROUTES.participant(id)),

    update: (id: string, payload: UpdateParticipantRequest) =>
      client.patch<UpdateParticipantResponse>(ROUTES.participant(id), payload),
  };
}
