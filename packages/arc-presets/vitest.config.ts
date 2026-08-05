import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    // e2e specs shell out to sheriff/eslint on a real scaffolded workspace
    testTimeout: 240_000,
    hookTimeout: 240_000,
  },
});
