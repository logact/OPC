import { create } from 'zustand';
import type { RegisterParticipantResponse } from '@opc/api-client';
import { authApi, participantsApi, setAuthToken } from '../api/http';
import { normalizeApiError } from '../api/errors';
import { loadCredentials, saveCredentials, clearCredentials, type StoredCredentials } from '../services/authStorage';

export interface AuthState {
  participantId: string | null;
  token: string | null;
  clientId: string | null;
  isLoading: boolean;
  error: string | null;
  isHydrated: boolean;

  login: (username: string, password: string) => Promise<void>;
  register: (id: string, name?: string, password?: string) => Promise<void>;
  logout: () => Promise<void>;
  hydrate: () => Promise<void>;
  clearError: () => void;
}

function generateClientId(): string {
  return `opc-mobile-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  participantId: null,
  token: null,
  clientId: null,
  isLoading: false,
  error: null,
  isHydrated: false,

  hydrate: async () => {
    const credentials = await loadCredentials();
    if (credentials) {
      setAuthToken(credentials.token);
      set({
        participantId: credentials.participantId,
        token: credentials.token,
        clientId: credentials.clientId,
        isHydrated: true,
      });
    } else {
      set({ isHydrated: true });
    }
  },

  login: async (username: string, password: string) => {
    set({ isLoading: true, error: null });
    try {
      const response = await authApi.login(username, password);
      const credentials: StoredCredentials = {
        participantId: response.participant.id,
        token: response.accessToken,
        clientId: get().clientId ?? generateClientId(),
      };
      await saveCredentials(credentials);
      setAuthToken(credentials.token);
      set({
        participantId: credentials.participantId,
        token: credentials.token,
        clientId: credentials.clientId,
        isLoading: false,
      });
    } catch (err) {
      const problem = normalizeApiError(err);
      set({
        error:
          problem.status === 401 ? '用户名或密码错误' : problem.message || '登录失败',
        isLoading: false,
      });
    }
  },

  register: async (id: string, name?: string, password?: string) => {
    set({ isLoading: true, error: null });
    try {
      const response: RegisterParticipantResponse = await participantsApi.register(id, {
        name,
        password,
      });
      const credentials: StoredCredentials = {
        participantId: response.participantId,
        token: response.token,
        clientId: get().clientId ?? generateClientId(),
      };
      await saveCredentials(credentials);
      setAuthToken(credentials.token);
      set({
        participantId: credentials.participantId,
        token: credentials.token,
        clientId: credentials.clientId,
        isLoading: false,
      });
    } catch (err) {
      const problem = normalizeApiError(err);
      set({
        // #122 之后，已有 owner 的 server 拒绝匿名注册（401）——提示改用密码登录
        error:
          problem.status === 401
            ? '服务器已完成初始化，请使用账号密码登录'
            : problem.message || '注册失败',
        isLoading: false,
      });
    }
  },

  logout: async () => {
    await clearCredentials();
    setAuthToken(null);
    set({
      participantId: null,
      token: null,
      clientId: null,
      error: null,
    });
  },

  clearError: () => set({ error: null }),
}));
