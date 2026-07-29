import {
  API_ROUTES,
  GetParticipantResponseSchema,
  ListParticipantsResponseSchema,
  RegisterParticipantResponseSchema,
  UpdateParticipantResponseSchema,
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

    get: async (id: string): Promise<GetParticipantResponse> => {
      const data = await client.get<unknown>(ROUTES.participant(id));
      return GetParticipantResponseSchema.parse(data);
    },

    update: async (
      id: string,
      payload: UpdateParticipantRequest
    ): Promise<UpdateParticipantResponse> => {
      const data = await client.patch<unknown>(ROUTES.participant(id), payload);
      return UpdateParticipantResponseSchema.parse(data);
    },
  };
}
