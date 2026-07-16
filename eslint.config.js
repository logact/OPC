// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['apps/server/e2e/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: './apps/server/tsconfig.e2e.json',
      },
    },
  },
  {
    ignores: ['**/dist/', '**/node_modules/', '**/*.js', '**/*.mjs', '**/*.cjs', '**/.worktrees/', 'worktree/'],
  },
);
