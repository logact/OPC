import { useEffect, useMemo } from 'react';
import { normalizeApiError } from '../api/errors';
import { useAuth } from './useAuth';
import { useCapabilityStore } from '../stores/capabilityStore';

export function useRecoverableApiError(error: unknown) {
  const problem = useMemo(
    () => (error ? normalizeApiError(error) : null),
    [error],
  );
  const { participantId, logout } = useAuth();
  const hydrate = useCapabilityStore(state => state.hydrate);

  useEffect(() => {
    if (!problem) return;
    if (problem.status === 401 || problem.code === 'unauthorized') {
      void logout();
    } else if (
      (problem.status === 403 || problem.code === 'forbidden') &&
      participantId
    ) {
      void hydrate(participantId, true);
    }
  }, [problem, participantId, logout, hydrate]);

  return problem;
}
