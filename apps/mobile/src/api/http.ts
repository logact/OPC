import {
  createHttpClient,
  createRoomsApi,
  createParticipantsApi,
} from '@opc/api-client';
import { ENV } from '../config/env';

/**
 * Shared HTTP/api-client instances for the whole app. Auth is attached by
 * mutating the underlying axios instance's default Authorization header via
 * setAuthToken(), so every consumer of these instances automatically sends
 * `Bearer <token>` once the user is registered/hydrated.
 */
const http = createHttpClient({
  baseURL: ENV.serverBaseUrl,
  apiVersion: ENV.apiVersion,
});

export const roomsApi = createRoomsApi(http);
export const participantsApi = createParticipantsApi(http);

/** Attach (or clear, with null) the bearer token on all shared API calls. */
export function setAuthToken(token: string | null): void {
  if (token) {
    http.axios.defaults.headers.common.Authorization = `Bearer ${token}`;
  } else {
    delete http.axios.defaults.headers.common.Authorization;
  }
}
