import { create } from 'zustand';
import type { RegisterParticipantResponse } from '@opc/api-client';
import { participantsApi, setAuthToken } from '../api/http';
import { loadCredentials, saveCredentials, clearCredentials, type StoredCredentials } from '../services/authStorage';
import { ENV } from '../config/env';

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

  register: async (id: string, name?: string) => {
    set({ isLoading: true, error: null });
    try {
      const testUrl = ENV.serverBaseUrl + '/api/v1/participants';
      console.log('[auth] register via fetch to', testUrl);
      const fetchRes = await fetch(testUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name }),
      });
      console.log('[auth] fetch status:', fetchRes.status, 'headers:', Object.fromEntries(fetchRes.headers.entries()));
      const fetchText = await fetchRes.text();
      console.log('[auth] fetch body:', fetchText);

      if (!fetchRes.ok) {
        throw new Error(`Server error ${fetchRes.status}: ${fetchText}`);
      }

      const response: RegisterParticipantResponse = JSON.parse(fetchText);
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
    } catch (err: any) {
      console.error('[auth] register failed', {
        message: err?.message,
        code: err?.code,
        status: err?.response?.status,
        data: err?.response?.data,
      });
      const detail = err?.response?.data?.error
        ?? (typeof err?.response?.data === 'string' && err.response.data.length > 0 ? err.response.data : null)
        ?? err?.message
        ?? '注册失败';
      set({
        error: detail,
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
