import { defineConfig } from 'vitest/config';

/** Node tests of the coupling analysis (pure metrics + end-to-end against a temporary git repo). */
export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ['src/**/*.spec.ts'],
    environment: 'node',
    testTimeout: 30_000,
  },
});
