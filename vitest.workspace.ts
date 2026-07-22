import { defineWorkspace } from 'vitest/config';

// eslint-disable-next-line @typescript-eslint/no-unsafe-call
export default defineWorkspace([
  'apps/*/src',
  'packages/*',
  'tests',
]);
