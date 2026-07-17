import { describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { createHttpClient } from '../http.js';

vi.mock('axios');

describe('createHttpClient', () => {
  it('builds baseURL from config', () => {
    const mockedAxios = axios as typeof axios & {
      create: ReturnType<typeof vi.fn>;
    };
    mockedAxios.create.mockReturnValueOnce({
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
    });

    createHttpClient({ baseURL: 'https://opc.example.com/', apiVersion: 'v1' });

    expect(mockedAxios.create).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: 'https://opc.example.com/api/v1',
        timeout: 10000,
      }),
    );
  });
});
