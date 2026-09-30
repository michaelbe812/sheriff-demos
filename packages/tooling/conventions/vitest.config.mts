import { defineConfig } from 'vitest/config';

/** Node tests of the conventions (path → tags, lib config files, Tree helpers). */
export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ['src/**/*.spec.ts'],
    environment: 'node',
  },
});
