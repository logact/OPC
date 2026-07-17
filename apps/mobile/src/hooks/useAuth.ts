import { useCallback, useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';

export function useAuth() {
  const store = useAuthStore();

  useEffect(() => {
    if (!store.isHydrated) {
      store.hydrate();
    }
  }, [store]);

  const register = useCallback(
    async (id: string, name?: string) => {
      await store.register(id, name);
    },
    [store],
  );

  const logout = useCallback(async () => {
    await store.logout();
  }, [store]);

  return {
    participantId: store.participantId,
    token: store.token,
    clientId: store.clientId,
    isLoading: store.isLoading,
    error: store.error,
    isHydrated: store.isHydrated,
    isLoggedIn: store.participantId !== null && store.token !== null,
    register,
    logout,
    clearError: store.clearError,
  };
}
