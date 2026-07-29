import {
  API_ROUTES,
  ListParticipantsResponseSchema,
  RegisterParticipantResponseSchema,
} from '@logact-pub/opc-protocol';
import type { OpcHttpClient } from './http.js';
import type {
  GetParticipantResponse,
  ListParticipantsResponse,
  ParticipantKind,
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
    register: async (
      id: string,
      options?: Omit<RegisterParticipantRequest, 'id'>,
    ): Promise<RegisterParticipantResponse> => {
      const data = await client.post<unknown>(ROUTES.participants, {
        id,
        ...options,
      } satisfies RegisterParticipantRequest);
      return RegisterParticipantResponseSchema.parse(data);
    },

    list: async (options?: { kind?: ParticipantKind }): Promise<ListParticipantsResponse> => {
      const path = API_ROUTES.participants.replace(API_PREFIX, '');
      const url = options?.kind ? `${path}?kind=${encodeURIComponent(options.kind)}` : path;
      const data = await client.get<unknown>(url);
      return ListParticipantsResponseSchema.parse(data);
    },

    get: (id: string) => client.get<GetParticipantResponse>(ROUTES.participant(id)),

    update: (id: string, payload: UpdateParticipantRequest) =>
      client.patch<UpdateParticipantResponse>(ROUTES.participant(id), payload),
  };
}
