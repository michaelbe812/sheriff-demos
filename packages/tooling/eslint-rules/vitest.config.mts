import { defineConfig } from 'vitest/config';

/** RuleTester specs of the blueprint ESLint rules (Node). */
export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ['src/**/*.spec.ts'],
    environment: 'node',
  },
});
