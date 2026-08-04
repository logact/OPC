import { API_ROUTES, LoginResponseSchema } from '@logact-pub/opc-protocol';
import type { OpcHttpClient } from './http.js';
import type { LoginRequest, LoginResponse } from './types.js';

// API_ROUTES paths carry the /api/v1 prefix, which the http client's baseURL
// (buildBaseURL) already prepends — strip it to keep request URLs unchanged.
const API_PREFIX = '/api/v1';

export function createAuthApi(client: OpcHttpClient) {
  return {
    login: async (username: string, password: string): Promise<LoginResponse> => {
      const path = API_ROUTES.auth.login.replace(API_PREFIX, '');
      const data = await client.post<unknown>(path, {
        username,
        password,
      } satisfies LoginRequest);
      return LoginResponseSchema.parse(data);
    },
  };
}
