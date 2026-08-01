import { describe, expect, it, vi } from 'vitest';
import type { OpcHttpClient } from '../http.js';
import { createOrganizationApi } from '../organization.js';

function createMockClient(): OpcHttpClient {
  return {
    axios: {} as unknown as OpcHttpClient['axios'],
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  };
}

const timestamp = '2026-08-01T00:00:00.000Z';

describe('createOrganizationApi', () => {
  it('fetches and validates the organization singleton', async () => {
    const client = createMockClient();
    vi.mocked(client.get).mockResolvedValue({
      organization: {
        id: 'default',
        name: 'OPC',
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    });

    const result = await createOrganizationApi(client).get();

    expect(client.get).toHaveBeenCalledWith('/organization');
    expect(result.organization.name).toBe('OPC');
  });

  it('rejects a malformed organization response', async () => {
    const client = createMockClient();
    vi.mocked(client.get).mockResolvedValue({ organization: { id: 'default' } });

    await expect(createOrganizationApi(client).get()).rejects.toThrow();
  });

  it('uses encoded organization resource routes and validates delete responses', async () => {
    const client = createMockClient();
    vi.mocked(client.delete).mockResolvedValue({ departmentId: 'department/id' });

    const result = await createOrganizationApi(client).deleteDepartment('department/id');

    expect(client.delete).toHaveBeenCalledWith('/organization/departments/department%2Fid');
    expect(result).toEqual({ departmentId: 'department/id' });
  });

  it('adds the department filter when listing positions', async () => {
    const client = createMockClient();
    vi.mocked(client.get).mockResolvedValue({ positions: [] });

    await createOrganizationApi(client).listPositions({ departmentId: 'department/id' });

    expect(client.get).toHaveBeenCalledWith(
      '/organization/positions?departmentId=department%2Fid'
    );
  });
});
