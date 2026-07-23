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

let currentToken: string | null = null;

http.axios.interceptors.request.use((config) => {
  if (currentToken) {
    config.headers.Authorization = `Bearer ${currentToken}`;
  } else {
    delete config.headers.Authorization;
  }
  console.log(`[HTTP] ${config.method?.toUpperCase()} ${config.baseURL}${config.url} auth=${config.headers.Authorization ? 'YES(' + String(config.headers.Authorization).slice(7, 15) + '...)' : 'NO'}`);
  return config;
});

http.axios.interceptors.response.use(
  (res) => {
    console.log(`[HTTP] ${res.config.method?.toUpperCase()} ${res.config.url} -> ${res.status}`);
    return res;
  },
  (err) => {
    const url = err.config?.url || '?';
    const method = err.config?.method?.toUpperCase() || '?';
    const status = err.response?.status || 'no-response';
    const body = err.response?.data ? JSON.stringify(err.response.data).slice(0, 200) : 'no-body';
    console.log(`[HTTP] ${method} ${url} -> ${status} | ${body}`);
    return Promise.reject(err);
  },
);

/** Attach (or clear, with null) the bearer token on all shared API calls. */
export function setAuthToken(token: string | null): void {
  currentToken = token;
}
