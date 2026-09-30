import { defineConfig } from 'vitest/config';

/** Node tests for plugin, generators and sync generator (Tree-based, no browser). */
export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ['src/**/*.spec.ts'],
    environment: 'node',
  },
});
