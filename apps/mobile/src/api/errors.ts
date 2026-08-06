import {
  AuthorizationErrorResponseSchema,
  OrganizationErrorResponseSchema,
  TaskErrorResponseSchema,
} from '@logact-pub/opc-protocol';

export interface ApiProblem {
  status?: number;
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

interface AxiosLikeError {
  message?: string;
  response?: { status?: number; data?: unknown };
}

export function normalizeApiError(error: unknown): ApiProblem {
  const candidate = error as AxiosLikeError;
  const status = candidate?.response?.status;
  const payload = candidate?.response?.data;

  const authorization = AuthorizationErrorResponseSchema.safeParse(payload);
  if (authorization.success) {
    return { status, ...authorization.data.error };
  }
  const organization = OrganizationErrorResponseSchema.safeParse(payload);
  if (organization.success) {
    return { status, ...organization.data.error };
  }
  const task = TaskErrorResponseSchema.safeParse(payload);
  if (task.success) {
    return { status, ...task.data.error };
  }

  if (payload && typeof payload === 'object' && 'error' in payload) {
    const value = (payload as { error: unknown }).error;
    if (typeof value === 'string')
      return { status, code: 'request_failed', message: value };
  }
  return {
    status,
    code: status ? `http_${status}` : 'network_error',
    message: candidate?.message ?? 'Request failed',
  };
}

export function isConflictProblem(problem: ApiProblem): boolean {
  return (
    problem.status === 409 ||
    problem.code === 'task_concurrent_update' ||
    problem.code === 'stale_task_assignment'
  );
}
