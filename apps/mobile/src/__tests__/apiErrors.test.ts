import { isConflictProblem, normalizeApiError } from '../api/errors';

describe('normalizeApiError', () => {
  it('parses authorization and domain errors through protocol schemas', () => {
    expect(
      normalizeApiError({
        response: {
          status: 403,
          data: { error: { code: 'forbidden', message: 'No grant' } },
        },
      }),
    ).toEqual({ status: 403, code: 'forbidden', message: 'No grant' });
    const conflict = normalizeApiError({
      response: {
        status: 409,
        data: {
          error: {
            code: 'task_concurrent_update',
            message: 'Refresh',
            details: { version: 2 },
          },
        },
      },
    });
    expect(conflict.code).toBe('task_concurrent_update');
    expect(isConflictProblem(conflict)).toBe(true);
  });

  it('keeps network failures recoverable', () => {
    expect(normalizeApiError(new Error('offline'))).toEqual({
      status: undefined,
      code: 'network_error',
      message: 'offline',
    });
  });
});
