import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['apps/server/e2e/**/*.test.ts'],
    fileParallelism: false,
    pool: 'forks',
    // broker 回调链路（go-auth → server → PostgreSQL）有额外延迟，放宽超时
    testTimeout: 15000,
    coverage: {
      enabled: false,
    },
  },
});
