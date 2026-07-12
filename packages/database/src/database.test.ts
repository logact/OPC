import { describe, expect, it } from 'vitest';

describe('database package', () => {
  it('exports a createDbClient factory', async () => {
    // Avoid starting a real PostgreSQL connection in unit tests.
    const { createDbClient } = await import('./client/index.js');
    expect(typeof createDbClient).toBe('function');
  });

  it('exports schema modules', async () => {
    const schema = await import('./schema/index.js');
    expect(Object.keys(schema).length).toBeGreaterThan(0);
  });
});
