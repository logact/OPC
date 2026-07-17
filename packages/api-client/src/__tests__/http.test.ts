import { describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { createHttpClient } from '../http.js';

vi.mock('axios');

describe('createHttpClient', () => {
  it('builds baseURL from config', () => {
    const create = vi.mocked(axios.create);
    create.mockReturnValue({
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
    } as unknown as ReturnType<typeof axios.create>);

    createHttpClient({ baseURL: 'https://opc.example.com/', apiVersion: 'v1' });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: 'https://opc.example.com/api/v1',
        timeout: 10000,
      }),
    );
  });
});
