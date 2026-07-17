import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    // e2e specs shell out to sheriff/eslint on the real workspace
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
