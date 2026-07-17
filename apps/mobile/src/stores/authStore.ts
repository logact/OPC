import { create } from 'zustand';
import {
  createHttpClient,
  createParticipantsApi,
  type RegisterParticipantResponse,
} from '@opc/api-client';
import { ENV } from '../config/env';
import { loadCredentials, saveCredentials, clearCredentials, type StoredCredentials } from '../services/authStorage';

export interface AuthState {
  participantId: string | null;
  token: string | null;
  clientId: string | null;
  isLoading: boolean;
  error: string | null;
  isHydrated: boolean;

  register: (id: string, name?: string) => Promise<void>;
  logout: () => Promise<void>;
  hydrate: () => Promise<void>;
  clearError: () => void;
}

function generateClientId(): string {
  return `opc-mobile-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const participantsApi = createParticipantsApi(
  createHttpClient({
    baseURL: ENV.serverBaseUrl,
    apiVersion: ENV.apiVersion,
  }),
);

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

  register: async (id: string, name?: string) => {
    set({ isLoading: true, error: null });
    try {
      const response: RegisterParticipantResponse = await participantsApi.register(id, name);
      const credentials: StoredCredentials = {
        participantId: response.participantId,
        token: response.token,
        clientId: get().clientId ?? generateClientId(),
      };
      await saveCredentials(credentials);
      set({
        participantId: credentials.participantId,
        token: credentials.token,
        clientId: credentials.clientId,
        isLoading: false,
      });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : '注册失败',
        isLoading: false,
      });
    }
  },

  logout: async () => {
    await clearCredentials();
    set({
      participantId: null,
      token: null,
      clientId: null,
      error: null,
    });
  },

  clearError: () => set({ error: null }),
}));
