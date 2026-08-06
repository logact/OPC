import {
  createHttpClient,
  createOrganizationApi,
  createRoomsApi,
  createParticipantsApi,
  createTasksApi,
  createAuthApi,
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
export const organizationApi = createOrganizationApi(http);
export const tasksApi = createTasksApi(http);
export const authApi = createAuthApi(http);

let currentToken: string | null = null;

http.axios.interceptors.request.use(config => {
  if (currentToken) {
    config.headers.Authorization = `Bearer ${currentToken}`;
  } else {
    delete config.headers.Authorization;
  }
  // 诊断 400：把实际发出的 body 打出来（脱敏 password/token 类字段）
  let bodyLog = '';
  if (config.data != null) {
    try {
      const raw = typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
      const redacted = Object.fromEntries(
        Object.entries(raw as Record<string, unknown>).map(([k, v]) => [
          k,
          /password|token|secret|apiKey/i.test(k) ? '***' : v,
        ]),
      );
      bodyLog = ' body=' + JSON.stringify(redacted).slice(0, 200);
    } catch {
      bodyLog = ' body=<non-json>';
    }
  }
  console.log(
    `[HTTP] ${config.method?.toUpperCase()} ${config.baseURL}${
      config.url
    } auth=${
      config.headers.Authorization
        ? 'YES(' + String(config.headers.Authorization).slice(7, 15) + '...)'
        : 'NO'
    }${bodyLog}`,
  );
  return config;
});

http.axios.interceptors.response.use(
  res => {
    console.log(
      `[HTTP] ${res.config.method?.toUpperCase()} ${res.config.url} -> ${
        res.status
      }`,
    );
    return res;
  },
  err => {
    const url = err.config?.url || '?';
    const method = err.config?.method?.toUpperCase() || '?';
    const status = err.response?.status || 'no-response';
    const body = err.response?.data
      ? JSON.stringify(err.response.data).slice(0, 200)
      : 'no-body';
    // 诊断 400 no-body：打印响应头，区分 Hono JSON 错误 / Node HTTP 层裸 400 / 中间盒
    const headers = err.response?.headers
      ? ' headers=' + JSON.stringify(err.response.headers).slice(0, 300)
      : '';
    console.log(`[HTTP] ${method} ${url} -> ${status} | ${body}${headers}`);
    return Promise.reject(err);
  },
);

/** Attach (or clear, with null) the bearer token on all shared API calls. */
export function setAuthToken(token: string | null): void {
  currentToken = token;
}

/** Update the base URL at runtime (e.g. after user changes server config). */
export function updateBaseUrl(url: string): void {
  http.axios.defaults.baseURL = `${url}/api/v1`;
}
