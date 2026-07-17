import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios';
import { buildBaseURL, type OpcApiConfig } from './config.js';

export interface OpcHttpClient {
  axios: AxiosInstance;
  get: <T>(url: string, config?: AxiosRequestConfig) => Promise<T>;
  post: <T>(url: string, data?: unknown, config?: AxiosRequestConfig) => Promise<T>;
  patch: <T>(url: string, data?: unknown, config?: AxiosRequestConfig) => Promise<T>;
}

export function createHttpClient(config: OpcApiConfig): OpcHttpClient {
  const instance = axios.create({
    baseURL: buildBaseURL(config),
    timeout: config.timeout ?? 10000,
    headers: {
      'Content-Type': 'application/json',
    },
  });

  return {
    axios: instance,
    get: async <T>(url: string, requestConfig?: AxiosRequestConfig): Promise<T> => {
      const response = await instance.get<T>(url, requestConfig);
      return response.data;
    },
    post: async <T>(url: string, data?: unknown, requestConfig?: AxiosRequestConfig): Promise<T> => {
      const response = await instance.post<T>(url, data, requestConfig);
      return response.data;
    },
    patch: async <T>(url: string, data?: unknown, requestConfig?: AxiosRequestConfig): Promise<T> => {
      const response = await instance.patch<T>(url, data, requestConfig);
      return response.data;
    },
  };
}
