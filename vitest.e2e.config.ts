import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['apps/server/e2e/**/*.test.ts'],
    fileParallelism: false,
    pool: 'forks',
    coverage: {
      enabled: false,
    },
  },
});
