import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Vitest 4 no longer skips build output by default; dist/ holds stale compiled copies of the tests.
    exclude: [...configDefaults.exclude, 'dist/**'],
    setupFiles: ['./src/__tests__/setup.ts'],
    testTimeout: 15000,
  },
});
